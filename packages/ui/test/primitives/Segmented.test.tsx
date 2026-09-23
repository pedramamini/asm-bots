import { describe, expect, it } from 'bun:test'
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { Segmented, type SegmentedProps, Toolbar } from '../../src/index'
import { html, useDom } from '../dom'

useDom()

type Range = 'week' | 'month' | 'quarter' | 'year'
const RANGES: readonly Range[] = ['week', 'month', 'quarter', 'year']

function renderRange(props: Partial<SegmentedProps<Range>> = {}) {
  return render(<Segmented label="range" options={RANGES} defaultValue="week" {...props} />)
}

const pill = (name: string) => screen.getByRole('radio', { name })
const checked = () => screen.getAllByRole('radio').filter((radio) => radio.ariaChecked === 'true')
const stops = () => screen.getAllByRole('radio').filter((radio) => radio.tabIndex === 0)

/** Presses `key` on whatever has focus and says whether the control took it. */
function press(key: string, init: KeyboardEventInit = {}): boolean {
  return !fireEvent.keyDown(document.activeElement as HTMLElement, { key, ...init })
}

describe('Segmented', () => {
  it('draws the pills, the chosen one accent', () => {
    const { container } = renderRange()
    expect(html(container)).toMatchSnapshot()
  })

  it('is a radio group named by its label; the chosen pill is checked', () => {
    renderRange()
    expect(screen.getByRole('radiogroup', { name: 'range' })).not.toBeNull()
    expect(screen.getAllByRole('radio').map((radio) => radio.textContent)).toEqual([...RANGES])
    expect(checked()).toEqual([pill('week')])
  })

  it('has one tab stop: the chosen pill', () => {
    renderRange({ defaultValue: 'quarter' })
    expect(stops()).toEqual([pill('quarter')])
  })

  it('makes the first enabled pill the tab stop while nothing is chosen', () => {
    render(
      <Segmented label="range" options={[{ value: 'week', disabled: true }, 'month', 'year']} />,
    )
    expect(checked()).toEqual([])
    expect(stops()).toEqual([pill('month')])
  })

  it('moves the choice and the focus with the arrow keys, and wraps', () => {
    const changes: Range[] = []
    renderRange({ onValueChange: (value) => changes.push(value) })
    pill('week').focus()
    expect(press('ArrowRight')).toBe(true)
    expect(document.activeElement).toBe(pill('month'))
    expect(checked()).toEqual([pill('month')])
    expect(stops()).toEqual([pill('month')])
    press('ArrowDown')
    expect(document.activeElement).toBe(pill('quarter'))
    press('ArrowLeft')
    press('ArrowUp')
    expect(document.activeElement).toBe(pill('week'))
    press('ArrowLeft')
    expect(document.activeElement).toBe(pill('year'))
    press('ArrowRight')
    expect(document.activeElement).toBe(pill('week'))
    expect(changes).toEqual(['month', 'quarter', 'month', 'week', 'year', 'week'])
  })

  it('goes to the first and last pill with Home and End', () => {
    renderRange({ defaultValue: 'month' })
    pill('month').focus()
    expect(press('End')).toBe(true)
    expect(document.activeElement).toBe(pill('year'))
    expect(press('Home')).toBe(true)
    expect(document.activeElement).toBe(pill('week'))
    expect(checked()).toEqual([pill('week')])
  })

  it('skips disabled pills', () => {
    render(
      <Segmented
        label="range"
        options={[
          'week',
          { value: 'month', disabled: true },
          'quarter',
          { value: 'year', disabled: true },
        ]}
        defaultValue="week"
      />,
    )
    pill('week').focus()
    press('ArrowRight')
    expect(document.activeElement).toBe(pill('quarter'))
    press('ArrowRight')
    expect(document.activeElement).toBe(pill('week'))
    press('End')
    expect(document.activeElement).toBe(pill('quarter'))
    expect((pill('month') as HTMLButtonElement).disabled).toBe(true)
  })

  it('leaves other keys and modified presses alone', () => {
    renderRange()
    pill('week').focus()
    expect(press('Enter')).toBe(false)
    expect(press('a')).toBe(false)
    expect(press('ArrowRight', { altKey: true })).toBe(false)
    expect(press('ArrowRight', { metaKey: true })).toBe(false)
    expect(checked()).toEqual([pill('week')])
  })

  it('chooses on a click, and a click on the chosen pill changes nothing', () => {
    const changes: Range[] = []
    renderRange({ onValueChange: (value) => changes.push(value) })
    fireEvent.click(pill('year'))
    expect(checked()).toEqual([pill('year')])
    fireEvent.click(pill('year'))
    expect(changes).toEqual(['year'])
  })

  it('follows a controlled value and reports the user’s choice', () => {
    const changes: Range[] = []
    function Controlled() {
      const [value, setValue] = useState<Range>('month')
      return (
        <Segmented
          label="range"
          options={RANGES}
          value={value}
          onValueChange={(next) => {
            changes.push(next)
            setValue(next)
          }}
        />
      )
    }
    render(<Controlled />)
    expect(checked()).toEqual([pill('month')])
    pill('month').focus()
    press('ArrowRight')
    expect(checked()).toEqual([pill('quarter')])
    expect(changes).toEqual(['quarter'])
  })

  it('stays put when the caller does not take a controlled change', () => {
    render(<Segmented label="range" options={RANGES} value="month" />)
    fireEvent.click(pill('year'))
    expect(checked()).toEqual([pill('month')])
  })

  it('takes labels apart from values', () => {
    render(
      <Segmented
        label="speed"
        options={[
          { value: '1', label: '1x' },
          { value: '4', label: '4x' },
        ]}
        defaultValue="4"
      />,
    )
    expect(checked()).toEqual([pill('4x')])
  })

  it('draws bordered UPPER pills 2 px apart; the chosen one accent-bordered (DESIGN_SYSTEM §4)', () => {
    renderRange()
    const group = screen.getByRole('radiogroup')
    expect(group.className.split(' ')).toEqual(expect.arrayContaining(['inline-flex', 'gap-0.5']))
    expect(pill('week').className.split(' ')).toEqual(
      expect.arrayContaining([
        'h-6',
        'rounded-sm',
        'border',
        'text-nav',
        'border-accent',
        'text-accent',
      ]),
    )
    expect(pill('month').className.split(' ')).toEqual(
      expect.arrayContaining([
        'border-border',
        'text-muted',
        'not-disabled:hover:border-border-strong',
      ]),
    )
    // Accent only in the focus ring.
    const idle = pill('month')
      .className.split(' ')
      .filter((name) => !name.includes(':'))
    expect(idle.filter((name) => name.includes('accent'))).toEqual([])
  })

  it('keeps its arrow keys inside a toolbar, and the toolbar’s keys land on the chosen pill', () => {
    render(
      <Toolbar aria-label="stats">
        <button type="button">refresh</button>
        <Segmented label="range" options={RANGES} defaultValue="quarter" />
        <button type="button">export</button>
      </Toolbar>,
    )
    screen.getByRole('button', { name: 'refresh' }).focus()
    press('ArrowRight')
    expect(document.activeElement).toBe(pill('quarter'))
    press('ArrowRight')
    expect(document.activeElement).toBe(pill('year'))
    expect(checked()).toEqual([pill('year')])
    screen.getByRole('button', { name: 'export' }).focus()
    press('ArrowLeft')
    expect(document.activeElement).toBe(pill('year'))
    press('End')
    expect(document.activeElement).toBe(pill('year'))
  })

  it('calls its own onKeyDown first, and a handled key stays handled', () => {
    const keys: string[] = []
    renderRange({
      onKeyDown: (event) => {
        keys.push(event.key)
        if (event.key === 'ArrowRight') event.preventDefault()
      },
    })
    pill('week').focus()
    press('ArrowRight')
    expect(checked()).toEqual([pill('week')])
    press('End')
    expect(checked()).toEqual([pill('year')])
    expect(keys).toEqual(['ArrowRight', 'End'])
  })

  it('passes className and attributes through to the group', () => {
    renderRange({ className: 'ml-auto', id: 'range' })
    const group = screen.getByRole('radiogroup')
    expect(group.className.endsWith(' ml-auto')).toBe(true)
    expect(group.id).toBe('range')
  })
})
