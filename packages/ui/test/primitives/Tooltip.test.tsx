import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { Kbd, TOOLTIP_DELAY, Tooltip } from '../../src/index'
import { html, useDom, window } from '../dom'

useDom()

const undo: (() => void)[] = []
beforeEach(() => {
  jest.useFakeTimers()
})
afterEach(() => {
  // Real timers again before useDom's clean-up, which waits on a real task.
  jest.useRealTimers()
  for (const restore of undo.splice(0)) restore()
})

function renderTip(delay?: number) {
  return render(
    <Tooltip content="step" {...(delay === undefined ? {} : { delay })}>
      <button type="button">next</button>
    </Tooltip>,
  )
}

const trigger = () => screen.getByRole('button', { name: 'next' })
const tip = () => screen.queryByRole('tooltip', { hidden: true })
const wait = (ms: number) =>
  act(() => {
    jest.advanceTimersByTime(ms)
  })
const hover = (element: Element = trigger()) =>
  fireEvent.pointerEnter(element, { pointerType: 'mouse' })

/**
 * Decides `:focus-visible` for this test. jsdom guesses it from the events it has seen in every
 * test file of the run, so a test that depends on it says which it is.
 */
function focusVisible(visible: boolean): void {
  const proto = window.Element.prototype
  const matches = proto.matches
  proto.matches = function (this: Element, selector: string) {
    return selector === ':focus-visible' ? visible : matches.call(this, selector)
  }
  undo.push(() => {
    proto.matches = matches
  })
}

describe('Tooltip', () => {
  it('draws the tooltip beside its trigger', () => {
    const { container } = render(
      <Tooltip
        content={
          <>
            step <Kbd>.</Kbd>
          </>
        }
      >
        <button type="button">next</button>
      </Tooltip>,
    )
    hover()
    wait(TOOLTIP_DELAY)
    expect(html(container)).toMatchSnapshot()
  })

  it('shows 400 ms after the pointer rests on the trigger', () => {
    expect(TOOLTIP_DELAY).toBe(400)
    renderTip()
    hover()
    wait(399)
    expect(tip()).toBeNull()
    wait(1)
    expect(screen.getByRole('tooltip').textContent).toBe('step')
  })

  it('describes the trigger while it shows', () => {
    renderTip()
    expect(trigger().getAttribute('aria-describedby')).toBeNull()
    hover()
    wait(400)
    const shown = screen.getByRole('tooltip')
    expect(trigger().getAttribute('aria-describedby')).toBe(shown.id)
    expect(screen.getByRole('button', { description: 'step' })).toBe(trigger())
  })

  it('takes its own delay', () => {
    renderTip(50)
    hover()
    wait(50)
    expect(tip()).not.toBeNull()
  })

  it('hides 100 ms after the pointer leaves the trigger', () => {
    renderTip()
    hover()
    wait(400)
    fireEvent.pointerLeave(trigger())
    wait(99)
    expect(tip()).not.toBeNull()
    wait(1)
    expect(tip()).toBeNull()
    expect(trigger().getAttribute('aria-describedby')).toBeNull()
  })

  it('stays while the pointer crosses onto it, and hides when it leaves (WCAG 1.4.13)', () => {
    renderTip()
    hover()
    wait(400)
    fireEvent.pointerLeave(trigger())
    wait(50)
    hover(tip() as HTMLElement)
    wait(1000)
    expect(tip()).not.toBeNull()
    fireEvent.pointerLeave(tip() as HTMLElement)
    expect(tip()).toBeNull()
  })

  it('never shows when the pointer leaves before the delay', () => {
    renderTip()
    hover()
    wait(300)
    fireEvent.pointerLeave(trigger())
    wait(1000)
    expect(tip()).toBeNull()
  })

  it('does not show for a touch', () => {
    renderTip()
    fireEvent.pointerEnter(trigger(), { pointerType: 'touch' })
    wait(1000)
    expect(tip()).toBeNull()
  })

  it('shows on keyboard focus after the delay, and hides on blur', () => {
    focusVisible(true)
    renderTip()
    act(() => trigger().focus())
    wait(399)
    expect(tip()).toBeNull()
    wait(1)
    expect(tip()).not.toBeNull()
    act(() => trigger().blur())
    expect(tip()).toBeNull()
  })

  it('does not show on a focus without the keyboard (a click)', () => {
    focusVisible(false)
    renderTip()
    act(() => trigger().focus())
    wait(1000)
    expect(tip()).toBeNull()
  })

  it('hides on a press, and the press cancels one waiting to show', () => {
    renderTip()
    hover()
    wait(400)
    fireEvent.pointerDown(trigger())
    expect(tip()).toBeNull()
    hover()
    wait(200)
    fireEvent.pointerDown(trigger())
    wait(1000)
    expect(tip()).toBeNull()
  })

  it('hides on Escape wherever the focus is', () => {
    render(
      <>
        <Tooltip content="step">
          <button type="button">next</button>
        </Tooltip>
        <input aria-label="search" />
      </>,
    )
    act(() => screen.getByRole('textbox').focus())
    hover()
    wait(400)
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    expect(tip()).toBeNull()
  })

  it('hides on Escape from the trigger, and cancels one waiting to show', () => {
    focusVisible(true)
    renderTip()
    act(() => trigger().focus())
    wait(400)
    expect(tip()).not.toBeNull()
    fireEvent.keyDown(trigger(), { key: 'Escape' })
    expect(tip()).toBeNull()
    act(() => trigger().blur())
    act(() => trigger().focus())
    wait(200)
    fireEvent.keyDown(trigger(), { key: 'Escape' })
    wait(1000)
    expect(tip()).toBeNull()
  })

  it('keeps the trigger’s own handlers, ref, and description', () => {
    const calls: string[] = []
    const ref = createRef<HTMLButtonElement>()
    render(
      <>
        <Tooltip content="step">
          <button
            ref={ref}
            type="button"
            aria-describedby="hint"
            onPointerEnter={() => calls.push('enter')}
            onPointerLeave={() => calls.push('leave')}
            onPointerDown={() => calls.push('down')}
            onFocus={() => calls.push('focus')}
            onBlur={() => calls.push('blur')}
            onKeyDown={() => calls.push('key')}
          >
            next
          </button>
        </Tooltip>
        <p id="hint">one instruction</p>
      </>,
    )
    expect(ref.current).toBe(trigger() as HTMLButtonElement)
    hover()
    wait(400)
    expect(trigger().getAttribute('aria-describedby')).toBe(`hint ${tip()?.id}`)
    fireEvent.pointerLeave(trigger())
    fireEvent.pointerDown(trigger())
    act(() => trigger().focus())
    fireEvent.keyDown(trigger(), { key: 'a' })
    act(() => trigger().blur())
    expect(calls).toEqual(['enter', 'leave', 'down', 'focus', 'key', 'blur'])
    wait(1000)
    expect(trigger().getAttribute('aria-describedby')).toBe('hint')
  })

  it('with describe={false}, repeats a name: hidden from assistive tech, no description', () => {
    render(
      <Tooltip content="step" describe={false}>
        <button type="button" aria-label="step">
          ▶
        </button>
      </Tooltip>,
    )
    hover(screen.getByRole('button'))
    wait(400)
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(tip()?.getAttribute('aria-hidden')).toBe('true')
    expect(screen.getByRole('button').getAttribute('aria-describedby')).toBeNull()
  })

  it('is a manual popover in the top layer where the browser has the API', () => {
    const shown: Element[] = []
    const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>
    proto.showPopover = function showPopover(this: Element) {
      shown.push(this)
    }
    undo.push(() => {
      delete proto.showPopover
    })
    renderTip()
    hover()
    wait(400)
    expect(tip()?.getAttribute('popover')).toBe('manual')
    expect(shown).toEqual([tip() as HTMLElement])
  })

  it('sits at --x, --y with fixed position, over the popover defaults', () => {
    renderTip()
    hover()
    wait(400)
    const shown = tip() as HTMLElement
    expect(shown.style.getPropertyValue('--x')).toMatch(/^-?\d+px$/)
    expect(shown.style.getPropertyValue('--y')).toMatch(/^-?\d+px$/)
    expect(shown.className.split(' ')).toEqual(
      expect.arrayContaining(['fixed', 'inset-auto', 'left-(--x)', 'top-(--y)', 'm-0']),
    )
    expect(shown.className.split(' ')).toEqual(
      expect.arrayContaining(['bg-panel', 'border-border-strong', 'text-data', 'rounded-sm']),
    )
  })

  it('stops its timer when it goes away', () => {
    const { unmount } = renderTip()
    hover()
    unmount()
    wait(1000)
    expect(tip()).toBeNull()
  })
})
