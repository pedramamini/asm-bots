import { describe, expect, it } from 'bun:test'
import { fireEvent, render, screen } from '@testing-library/react'
import { Toolbar } from '../../src/index'
import { html, useDom } from '../dom'

useDom()

function Filters() {
  return (
    <Toolbar aria-label="bot filters">
      <input type="search" aria-label="search bots" placeholder="search bots..." />
      <select aria-label="hill">
        <option>all hills</option>
      </select>
      <button type="button">public</button>
      <button type="button" disabled>
        mine
      </button>
      <button type="button">verified</button>
      <a href="#clear">clear</a>
    </Toolbar>
  )
}

/** Presses `key` on whatever has focus and says whether the toolbar took it. */
function press(key: string, init: KeyboardEventInit = {}): boolean {
  const target = document.activeElement as HTMLElement
  return !fireEvent.keyDown(target, { key, ...init })
}

describe('Toolbar', () => {
  it('draws its controls in a row', () => {
    const { container } = render(<Filters />)
    expect(html(container)).toMatchSnapshot()
  })

  it('is a horizontal toolbar, 36 px with a hairline bottom (DESIGN_SYSTEM §4)', () => {
    render(<Filters />)
    const toolbar = screen.getByRole('toolbar', { name: 'bot filters' })
    expect(toolbar.getAttribute('aria-orientation')).toBe('horizontal')
    expect(toolbar.className.split(' ')).toEqual(
      expect.arrayContaining(['h-9', 'gap-2', 'border-b', 'border-border', 'px-3']),
    )
  })

  it('moves focus between controls with Left and Right, skipping disabled ones, and wraps', () => {
    render(<Filters />)
    const publicButton = screen.getByRole('button', { name: 'public' })
    publicButton.focus()
    expect(press('ArrowRight')).toBe(true)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'verified' }))
    press('ArrowRight')
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'clear' }))
    press('ArrowRight')
    expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: 'search bots' }))
    screen.getByRole('button', { name: 'verified' }).focus()
    press('ArrowLeft')
    expect(document.activeElement).toBe(publicButton)
  })

  it('goes to the first and last control with Home and End', () => {
    render(<Filters />)
    screen.getByRole('button', { name: 'public' }).focus()
    press('End')
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'clear' }))
    press('Home')
    expect(document.activeElement).toBe(screen.getByRole('searchbox'))
  })

  it('leaves the arrow keys to text fields and selects', () => {
    render(<Filters />)
    const search = screen.getByRole('searchbox')
    search.focus()
    expect(press('ArrowRight')).toBe(false)
    expect(press('End')).toBe(false)
    expect(document.activeElement).toBe(search)
    const select = screen.getByRole('combobox', { name: 'hill' })
    select.focus()
    expect(press('ArrowLeft')).toBe(false)
    expect(document.activeElement).toBe(select)
  })

  it('leaves an arrow key to a control that handles it and to modified presses', () => {
    render(
      <Toolbar>
        <button type="button" onKeyDown={(event) => event.preventDefault()}>
          steps
        </button>
        <button type="button">run</button>
      </Toolbar>,
    )
    const steps = screen.getByRole('button', { name: 'steps' })
    steps.focus()
    press('ArrowRight')
    expect(document.activeElement).toBe(steps)
    const run = screen.getByRole('button', { name: 'run' })
    run.focus()
    expect(press('ArrowLeft', { metaKey: true })).toBe(false)
    expect(document.activeElement).toBe(run)
  })

  it('ignores other keys', () => {
    render(<Filters />)
    screen.getByRole('button', { name: 'public' }).focus()
    expect(press('ArrowDown')).toBe(false)
    expect(press('a')).toBe(false)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'public' }))
  })

  it('calls its own onKeyDown first, and a handled key stays handled', () => {
    const keys: string[] = []
    render(
      <Toolbar
        onKeyDown={(event) => {
          keys.push(event.key)
          if (event.key === 'ArrowRight') event.preventDefault()
        }}
      >
        <button type="button">a</button>
        <button type="button">b</button>
      </Toolbar>,
    )
    const a = screen.getByRole('button', { name: 'a' })
    a.focus()
    press('ArrowRight')
    expect(document.activeElement).toBe(a)
    press('End')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'b' }))
    expect(keys).toEqual(['ArrowRight', 'End'])
  })

  it('moves between Tab stops only: a roving group’s other members (tabindex -1) are skipped', () => {
    render(
      <Toolbar>
        <button type="button">run</button>
        <button type="button" tabIndex={-1}>
          week
        </button>
        <button type="button">month</button>
        <button type="button" tabIndex={-1}>
          year
        </button>
      </Toolbar>,
    )
    screen.getByRole('button', { name: 'run' }).focus()
    press('ArrowRight')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'month' }))
    press('ArrowRight')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'run' }))
    press('End')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'month' }))
  })

  it('keeps every control in the Tab order', () => {
    render(<Filters />)
    for (const control of screen
      .getByRole('toolbar')
      .querySelectorAll('input, select, button, a')) {
      expect(control.getAttribute('tabindex')).toBeNull()
    }
  })

  it('passes className and attributes through', () => {
    render(<Toolbar className="justify-between" id="filters" />)
    const toolbar = screen.getByRole('toolbar')
    expect(toolbar.className.endsWith(' justify-between')).toBe(true)
    expect(toolbar.id).toBe('filters')
  })
})
