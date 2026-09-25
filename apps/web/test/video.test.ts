/**
 * The arena's video (`battle/video.ts`): the format it records in, the frame's size, and a
 * recording from the arena's draws to the file, on a fake `MediaRecorder` (jsdom has none).
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { useDom, window } from '../../../packages/ui/test/dom'
import type { ArenaCanvasHandle, DrawListener } from '../src/features/arena/ArenaCanvas'
import { videoName } from '../src/features/arena/battle/files'
import {
  footerStamp,
  type ScreenshotText,
  shotLayout,
} from '../src/features/arena/battle/screenshot'
import {
  canRecordVideo,
  MAX_WIDTH,
  recordArena,
  recordingLabel,
  videoFormat,
} from '../src/features/arena/battle/video'
import { fakeContext } from './fake-canvas'
import { FakeRecorder, stubRecorder, tracks } from './fake-recorder'

useDom()

describe('videoFormat', () => {
  it('takes an MP4 first, a WebM where there is none, and nothing where neither records', () => {
    expect(videoFormat(() => true)).toEqual({
      mime: 'video/mp4;codecs=avc1.640033',
      type: 'video/mp4',
      extension: 'mp4',
    })
    expect(videoFormat((mime) => mime === 'video/mp4')?.mime).toBe('video/mp4')
    expect(videoFormat((mime) => mime.startsWith('video/webm'))).toEqual({
      mime: 'video/webm;codecs=vp9',
      type: 'video/webm',
      extension: 'webm',
    })
    expect(videoFormat(() => false)).toBeNull()
  })

  it('finds no format where the browser has no MediaRecorder', () => {
    expect(videoFormat()).toBeNull()
    expect(canRecordVideo()).toBe(false)
  })
})

describe('the file and the chip', () => {
  it('names the video as the replay is named, by the extension it records', () => {
    expect(videoName(['Dwarf', 'Imp'], 1, 'mp4')).toBe('asmbots-dwarf-imp-1.mp4')
    expect(videoName(['a', 'b', 'c', 'd'], 7, 'webm')).toBe('asmbots-4-bots-7.webm')
  })

  it('counts minutes and seconds', () => {
    expect(recordingLabel(0)).toBe('0:00')
    expect(recordingLabel(7_900)).toBe('0:07')
    expect(recordingLabel(92_000)).toBe('1:32')
    expect(recordingLabel(-5)).toBe('0:00')
  })
})

describe('shotLayout', () => {
  const ctx = fakeContext()

  it('lays a screenshot out at the canvas’s resolution', () => {
    const layout = shotLayout(ctx, { width: 1600, height: 1200, clientWidth: 800 }, ['Dwarf'])
    expect([layout.width, layout.height, layout.ratio]).toEqual([800, 600, 2])
    // The arena, one legend row (18 + 4), the inset (8), the footer (22).
    expect([layout.pixelWidth, layout.pixelHeight]).toEqual([1600, 1304])
  })

  it('scales a video down to the widest it may be, and keeps its sides even', () => {
    const canvas = { width: 3000, height: 1801, clientWidth: 1500 }
    const layout = shotLayout(ctx, canvas, ['Dwarf'], { maxWidth: MAX_WIDTH, even: true })
    expect(layout.ratio).toBeCloseTo(2 * (MAX_WIDTH / 3000))
    expect(layout.pixelWidth).toBe(MAX_WIDTH)
    expect(layout.pixelHeight % 2).toBe(0)
    expect(layout.pixelHeight).toBeGreaterThanOrEqual(Math.round((900.5 + 52) * layout.ratio))
  })
})

describe('recordArena', () => {
  let restore: () => void = () => {}
  const proto = window.HTMLCanvasElement.prototype
  const { getContext } = proto
  beforeEach(() => {
    restore = stubRecorder(window)
    proto.getContext = function (this: HTMLCanvasElement, type: string) {
      return type === '2d' ? fakeContext() : null
    } as typeof proto.getContext
  })
  afterEach(() => {
    restore()
    proto.getContext = getContext
  })

  /** An arena 800 x 600 CSS px at ratio 2, whose draws the test calls. */
  function arena() {
    const listeners = new Set<DrawListener>()
    const canvas = Object.assign(window.document.createElement('canvas'), {
      width: 1600,
      height: 1200,
    })
    Object.defineProperty(canvas, 'clientWidth', { value: 800 })
    const handle = {
      canvas,
      overlay: null,
      renderer: { render: () => true },
      onDraw: (listener: DrawListener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    } as unknown as ArenaCanvasHandle
    return { handle, canvas, listeners }
  }

  let cycle = 0
  const text = (): ScreenshotText => ({
    chips: [`cycle ${cycle}`],
    title: 'asm bots · seed 1',
    bots: ['Dwarf', 'Imp'],
    stamp: footerStamp(['Dwarf', 'Imp'], 1, cycle),
    site: 'asmbots.io',
  })

  it('records each draw of the arena, and saves an MP4 when it stops', async () => {
    const { handle, canvas, listeners } = arena()
    let texts = 0
    const recording = recordArena(handle, () => {
      texts++
      return text()
    })
    expect(recording?.format.extension).toBe('mp4')
    const recorder = FakeRecorder.made[0] as FakeRecorder
    expect(recorder.state).toBe('recording')
    expect(recorder.options).toEqual({
      mimeType: 'video/mp4;codecs=avc1.640033',
      videoBitsPerSecond: 8_000_000,
    })
    expect(recorder.timeslice).toBe(1000)
    expect(listeners.size).toBe(1)
    for (cycle = 1; cycle <= 3; cycle++) for (const draw of listeners) draw(canvas, null)
    // One read laid the legend out; then each draw wrote the battle as it stood.
    expect(texts).toBe(1 + 3)

    const video = await recording?.stop()
    expect(video?.type).toBe('video/mp4')
    expect(listeners.size).toBe(0)
    expect(tracks.map((track) => track.stopped)).toEqual([true])
  })

  it('is null where the browser records no format, or the arena has no canvas', () => {
    FakeRecorder.supported = () => false
    try {
      expect(recordArena(arena().handle, text)).toBeNull()
    } finally {
      FakeRecorder.supported = (mime) => mime.startsWith('video/mp4')
    }
    const handle = { ...arena().handle, canvas: null }
    expect(recordArena(handle, text)).toBeNull()
    expect(canRecordVideo()).toBe(true)
  })
})
