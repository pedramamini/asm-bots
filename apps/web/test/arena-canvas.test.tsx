/**
 * `ArenaCanvas` in jsdom, which has no WebGL2: the 2D fallback and its chip, the client's frames
 * reaching the scene, the camera's keys, wheel, and drag, and the settings reaching the renderer.
 * The canvas contexts are fakes; `e2e/arena-render.spec.ts` checks the pixels in Chromium.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { createRef } from 'react'
import { createStore } from 'zustand'
import { stubLayout, useDom, window } from '../../../packages/ui/test/dom'
import {
  ArenaCanvas,
  type ArenaCanvasHandle,
  type FrameSource,
} from '../src/features/arena/ArenaCanvas'
import { type ArenaState, INITIAL_ARENA_STATE } from '../src/features/arena/worker/client'
import type { FrameMessage } from '../src/features/arena/worker/protocol'
import { DEFAULT_SETTINGS, useSettings } from '../src/store/settings'

useDom()

/** A 2D context that draws nothing. */
function fakeContext(): CanvasRenderingContext2D {
  const state: Record<string | symbol, unknown> = {}
  return new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key]
      if (key === 'createImageData') {
        return (w: number, h: number) => ({
          width: w,
          height: h,
          data: new Uint8ClampedArray(w * h * 4),
        })
      }
      return () => {}
    },
    set(target, key, value) {
      target[key] = value
      return true
    },
  }) as unknown as CanvasRenderingContext2D
}

let restore: (() => void)[] = []

beforeAll(() => {
  const proto = window.HTMLCanvasElement.prototype
  const getContext = proto.getContext
  // No WebGL2 here, and a 2D context that records nothing.
  proto.getContext = function (this: HTMLCanvasElement, type: string) {
    return type === '2d' ? fakeContext() : null
  } as typeof proto.getContext
  restore = [
    () => {
      proto.getContext = getContext
    },
    stubLayout('clientWidth', () => 600),
    stubLayout('clientHeight', () => 400),
  ]
})

afterAll(() => {
  for (const undo of restore) undo()
})

beforeEach(() => {
  useSettings.setState({ ...structuredClone(DEFAULT_SETTINGS), theme: 'sentinel' })
})

/** A client that sends the frames a test gives it. */
function source(state: Partial<ArenaState> = {}) {
  const listeners = new Set<(frame: FrameMessage) => void>()
  const store = createStore<ArenaState>()(() => ({ ...INITIAL_ARENA_STATE, ...state }))
  const seek = mock((_cycle: number) => {})
  const on = ((type: string, listener: (frame: FrameMessage) => void) => {
    if (type === 'frame') listeners.add(listener)
    return () => listeners.delete(listener)
  }) as FrameSource['on']
  return {
    client: { on, store, seek } as FrameSource,
    seek,
    emit: (frame: FrameMessage) => {
      for (const listener of listeners) listener(frame)
    },
  }
}

function fullFrame(owner: [number, number][]): FrameMessage {
  const ownerDirty = new Uint8Array(0x10000)
  for (const [a, tag] of owner) ownerDirty[a] = tag
  return {
    type: 'frame',
    cycle: 42,
    alive: 1,
    over: false,
    writes: new Uint16Array(0),
    execs: new Uint16Array(0),
    ips: Uint16Array.of(0x10, 0x100),
    spawns: new Uint32Array(0),
    deaths: new Uint32Array(0),
    botDeaths: new Uint32Array(0),
    stats: new Float32Array(0),
    ownerDirty,
    bytesDirty: new Uint8Array(0x10000),
  }
}

function mount(state: Partial<ArenaState> = {}, props: { minimap?: boolean } = {}) {
  const s = source(state)
  const ref = createRef<ArenaCanvasHandle>()
  const view = render(<ArenaCanvas ref={ref} client={s.client} {...props} />)
  const handle = () => ref.current as ArenaCanvasHandle
  return {
    ...s,
    ...view,
    handle,
    app: within(view.container).getByRole('application', { name: 'arena' }),
  }
}

describe('ArenaCanvas', () => {
  it('draws in 2D where WebGL2 is missing, and says so with a 2D chip', () => {
    const { handle, app } = mount()
    expect(handle().renderer?.kind).toBe('2d')
    expect(app.dataset.renderer).toBe('2d')
    expect(screen.getByText('2D').title).toContain('no WebGL2')
    expect(app.getAttribute('aria-roledescription')).toBe('arena map')
    expect(handle().camera.width).toBe(600)
  })

  it("hands the client's frames to the scene, which the next image takes", () => {
    const { handle, emit } = mount()
    emit(fullFrame([[0x1234, 3]]))
    expect(handle().scene.owner[0x1234]).toBe(0)
    handle().renderer?.render(performance.now(), true)
    expect(handle().scene.owner[0x1234]).toBe(3)
    expect(Array.from(handle().scene.ips)).toEqual([0x10, 0x100])
  })

  it('asks for the whole core when it mounts after a battle loaded, and not before', () => {
    expect(mount({ status: 'paused', cycle: 500 }).seek).toHaveBeenCalledWith(500)
    expect(mount().seek).not.toHaveBeenCalled()
    expect(mount({ status: 'loading' }).seek).not.toHaveBeenCalled()
  })

  it('zooms with + and -, pans with the arrows, and resets with 0', () => {
    const { handle, app } = mount()
    const camera = handle().camera
    fireEvent.keyDown(app, { key: '+' })
    expect(camera.zoom).toBe(2)
    const x = camera.originX
    const y = camera.originY
    expect(fireEvent.keyDown(app, { key: 'ArrowRight' })).toBe(false)
    expect(camera.originX).toBeLessThan(x)
    fireEvent.keyDown(app, { key: 'ArrowUp' })
    expect(camera.originY).toBeGreaterThan(y)
    fireEvent.keyDown(app, { key: '0' })
    expect(camera.zoom).toBe(1)
    fireEvent.keyDown(app, { key: '=' })
    fireEvent.keyDown(app, { key: '-' })
    expect(camera.zoom).toBe(1)
    // Other keys, and keys with a modifier, are not the arena's.
    expect(fireEvent.keyDown(app, { key: 'x' })).toBe(true)
    expect(fireEvent.keyDown(app, { key: '0', metaKey: true })).toBe(true)
  })

  it('zooms at the cursor with the wheel, and keeps the page from scrolling', () => {
    const { handle, app } = mount()
    const camera = handle().camera
    const under = camera.addressAt(300, 200)
    // Four notches in: the core outgrows the view both ways, so the byte stays put.
    expect(fireEvent.wheel(app, { deltaY: -400, clientX: 300, clientY: 200 })).toBe(false)
    expect(camera.zoom).toBeCloseTo(Math.exp(0.8), 9)
    expect(camera.addressAt(300, 200)).toBe(under)
    // Three lines out.
    fireEvent.wheel(app, { deltaY: 3, deltaMode: 1, clientX: 300, clientY: 200 })
    expect(camera.zoom).toBeCloseTo(Math.exp(0.8 - 0.096), 9)
    expect(app.dataset.zoomed).toBe('true')
  })

  it('pans with a drag once zoomed in, and a press on the minimap moves the view there', () => {
    const { handle, app } = mount()
    const camera = handle().camera
    camera.zoomBy(4)
    const x = camera.originX
    fireEvent.pointerDown(app, { pointerId: 1, button: 0, clientX: 200, clientY: 200 })
    expect(app.dataset.dragging).toBe('true')
    fireEvent.pointerMove(app, { pointerId: 1, clientX: 230, clientY: 200 })
    expect(camera.originX).toBeCloseTo(x + 30, 9)
    fireEvent.pointerUp(app, { pointerId: 1 })
    expect(app.dataset.dragging).toBeUndefined()

    const box = camera.minimap() as NonNullable<ReturnType<typeof camera.minimap>>
    fireEvent.pointerDown(app, {
      pointerId: 2,
      button: 0,
      clientX: box.x + box.width / 2,
      clientY: box.y + box.height / 2,
    })
    const seen = camera.visible()
    expect((seen.left + seen.right) / 2).toBeCloseTo(128, 6)
    fireEvent.pointerUp(app, { pointerId: 2 })
  })

  it('draws in the theme, effects, and motion of the settings', () => {
    const { handle, rerender, client } = mount()
    const renderer = handle().renderer
    if (renderer === null) throw new Error('no renderer')
    const setTheme = mock(renderer.setTheme.bind(renderer))
    const setMinimap = mock(renderer.setMinimap.bind(renderer))
    renderer.setTheme = setTheme
    renderer.setMinimap = setMinimap
    act(() => useSettings.getState().setTheme('amber'))
    expect(setTheme).toHaveBeenLastCalledWith('amber')
    act(() => useSettings.getState().setMotion('reduce'))
    expect(handle().scene.reducedMotion).toBe(true)
    act(() => useSettings.getState().setMotion('full'))
    expect(handle().scene.reducedMotion).toBe(false)
    rerender(<ArenaCanvas client={client} minimap={false} />)
    expect(setMinimap).toHaveBeenLastCalledWith(false)
  })
})
