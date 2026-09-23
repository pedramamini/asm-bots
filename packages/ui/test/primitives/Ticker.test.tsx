import { afterEach, describe, expect, it } from 'bun:test'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { Ticker } from '../../src/index'
import { html, stubLayout, useDom } from '../dom'

useDom()

const items = [<b key="live">▍LIVE</b>, 'HILL "MAIN"', 'dwarf-v3 took #1', '12,480 cycles']
const link = { href: '/hills/main', label: 'open the main hill' }

const undo: (() => void)[] = []
afterEach(() => {
  for (const restore of undo.splice(0)) restore()
})

/** Lays the line out `line()` px wide in a bar `bar()` px wide. */
function widths(line: () => number, bar: () => number): void {
  undo.push(stubLayout('scrollWidth', line), stubLayout('clientWidth', bar))
}

/** Sets a global for this test only. */
function stubGlobal(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
  undo.push(() => {
    delete (globalThis as Record<string, unknown>)[name]
  })
}

function prefersReducedMotion(): void {
  stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(prefers-reduced-motion: reduce)',
    addEventListener() {},
    removeEventListener() {},
  }))
}

class FakeResizeObserver {
  static last: FakeResizeObserver | null = null
  readonly observed: Element[] = []
  disconnected = false
  constructor(readonly resized: () => void) {
    FakeResizeObserver.last = this
  }
  observe(element: Element) {
    this.observed.push(element)
  }
  disconnect() {
    this.disconnected = true
  }
}

const marquee = () => screen.getByRole('marquee')
/** The element that scrolls in marquee mode. */
const track = () => marquee().firstElementChild?.firstElementChild as HTMLElement
/** The copy of the line that only the marquee draws. */
const copy = () => marquee().querySelector('[inert]')

describe('Ticker', () => {
  it('draws the line with a · between items and the → link after it', () => {
    const { container } = render(<Ticker items={items} link={link} />)
    expect(html(container)).toMatchSnapshot()
  })

  it('is a marquee region that does not announce its changes', () => {
    render(<Ticker items={items} />)
    expect(marquee().getAttribute('aria-live')).toBe('off')
  })

  it('hides the dots from assistive tech and keeps the spaces between items', () => {
    render(<Ticker items={items} />)
    expect(marquee().textContent).toBe('▍LIVE · HILL "MAIN" · dwarf-v3 took #1 · 12,480 cycles')
    const hidden = [...marquee().querySelectorAll('[aria-hidden="true"]')]
    expect(hidden.map((node) => node.textContent)).toEqual(['·', '·', '·'])
  })

  it('skips empty items', () => {
    render(<Ticker items={['cycle 12', null, false, '', 'paused', undefined]} />)
    expect(marquee().textContent).toBe('cycle 12 · paused')
  })

  it('names the → link, and passes its anchor props through (a router takes the click)', () => {
    const clicks: string[] = []
    render(
      <Ticker
        items={items}
        link={{
          ...link,
          onClick: (event) => {
            event.preventDefault()
            clicks.push(event.currentTarget.href)
          },
        }}
      />,
    )
    const arrow = screen.getByRole('link', { name: 'open the main hill' })
    expect(arrow.textContent).toBe('→')
    expect(arrow.getAttribute('href')).toBe('/hills/main')
    fireEvent.click(arrow)
    expect(clicks).toEqual(['http://localhost/hills/main'])
  })

  it('is 24 px of panel fill with a hairline bottom, in ticker type (DESIGN_SYSTEM §3, §4)', () => {
    render(<Ticker items={items} />)
    expect(marquee().className.split(' ')).toEqual(
      expect.arrayContaining([
        'h-6',
        'bg-panel',
        'border-b',
        'border-border',
        'px-3',
        'text-ticker',
        'text-text',
        'z-ticker',
        'justify-center',
      ]),
    )
  })

  it('stays still while the line fits', () => {
    widths(
      () => 400,
      () => 600,
    )
    render(<Ticker items={items} link={link} />)
    expect(track().className).toBe('flex')
    expect(copy()).toBeNull()
    expect(marquee().getAttribute('style')).toBeNull()
  })

  it('stays still when the line is at most a pixel wider (rounding)', () => {
    widths(
      () => 601,
      () => 600,
    )
    render(<Ticker items={items} />)
    expect(copy()).toBeNull()
  })

  it('scrolls a line wider than the bar as a marquee, at 50 px/s with a 48 px gap', () => {
    widths(
      () => 900,
      () => 300,
    )
    const { container } = render(<Ticker items={items} link={link} />)
    expect(html(container)).toMatchSnapshot()
    expect(track().className.split(' ')).toEqual(
      expect.arrayContaining([
        'w-max',
        'animate-marquee',
        'group-hover/ticker:[animation-play-state:paused]',
        'group-focus-within/ticker:[animation-play-state:paused]',
      ]),
    )
    // One pass is the line and its gap: (900 + 48) / 50 s.
    expect(marquee().style.getPropertyValue('--marquee-duration')).toBe('18.96s')
    expect(copy()?.getAttribute('aria-hidden')).toBe('true')
    expect(copy()?.textContent).toBe(track().firstElementChild?.textContent)
    // The arrow stays put outside the scrolling track, and there is one of it.
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(track().contains(screen.getByRole('link'))).toBe(false)
  })

  it('stays still under reduced motion and cuts the line with an ellipsis', () => {
    prefersReducedMotion()
    widths(
      () => 900,
      () => 300,
    )
    render(<Ticker items={items} link={link} />)
    expect(track().className).toBe('flex')
    expect(copy()).toBeNull()
    expect(track().querySelector('.truncate')?.textContent).toContain('12,480 cycles')
  })

  it('starts and stops the marquee as the bar resizes', () => {
    stubGlobal('ResizeObserver', FakeResizeObserver)
    let bar = 600
    widths(
      () => 500,
      () => bar,
    )
    const { unmount } = render(<Ticker items={items} />)
    const observer = FakeResizeObserver.last as FakeResizeObserver
    expect(observer.observed).toHaveLength(2)
    expect(copy()).toBeNull()
    bar = 400
    act(() => observer.resized())
    expect(copy()).not.toBeNull()
    bar = 700
    act(() => observer.resized())
    expect(copy()).toBeNull()
    unmount()
    expect(observer.disconnected).toBe(true)
  })

  it('passes className, style, and attributes through', () => {
    render(
      <Ticker
        items={items}
        className="sticky top-0"
        style={{ opacity: 0.5 }}
        aria-label="hill news"
      />,
    )
    const ticker = screen.getByRole('marquee', { name: 'hill news' })
    expect(ticker.className.endsWith(' sticky top-0')).toBe(true)
    expect(ticker.style.opacity).toBe('0.5')
  })
})
