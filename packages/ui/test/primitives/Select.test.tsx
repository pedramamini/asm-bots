import { describe, expect, it } from 'bun:test'
import { fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { Select } from '../../src/index'
import { html, useDom } from '../dom'

useDom()

const select = () => screen.getByRole('combobox') as HTMLSelectElement
const box = () => select().parentElement as HTMLElement
const classes = (element: Element) => (element.getAttribute('class') ?? '').split(' ')

function Hills(props: Parameters<typeof Select>[0]) {
  return (
    <Select aria-label="hill" {...props}>
      <option value="">all hills</option>
      <option value="main">main</option>
      <option value="tiny">tiny</option>
    </Select>
  )
}

describe('Select', () => {
  it('draws the native select with its chevron', () => {
    const { container } = render(<Hills className="w-40" />)
    expect(html(container)).toMatchSnapshot()
  })

  it('is the native select, with its options and its change events', () => {
    const picks: string[] = []
    render(<Hills onChange={(event) => picks.push(event.target.value)} />)
    expect(screen.getByRole('combobox', { name: 'hill' })).toBe(select())
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'all hills',
      'main',
      'tiny',
    ])
    fireEvent.change(select(), { target: { value: 'tiny' } })
    expect(picks).toEqual(['tiny'])
  })

  it('is a 24 px lowercase field: --panel-2 fill, a hairline, focus in accent (DESIGN_SYSTEM §4)', () => {
    render(<Hills />)
    expect(classes(select())).toEqual(
      expect.arrayContaining([
        'appearance-none',
        'bg-panel-2',
        'border',
        'border-border',
        'rounded-sm',
        'text-data',
        'lowercase',
        'outline-hidden',
        'focus:border-accent',
        'not-disabled:hover:border-border-strong',
      ]),
    )
    expect(classes(box())).toContain('h-6')
  })

  it('draws a 12 px chevron over the right end, out of the pointer’s and assistive tech’s way', () => {
    render(<Hills />)
    const chevron = box().querySelector('svg') as SVGElement
    expect(chevron.getAttribute('width')).toBe('12')
    expect(chevron.getAttribute('aria-hidden')).toBe('true')
    expect(classes(chevron)).toEqual(
      expect.arrayContaining(['pointer-events-none', 'absolute', 'right-2']),
    )
    expect(classes(select())).toContain('pr-6')
  })

  it('passes className to the box, and the other props and the ref to the <select>', () => {
    const ref = createRef<HTMLSelectElement>()
    render(<Hills ref={ref} className="w-40" name="hill" defaultValue="main" disabled />)
    expect(ref.current).toBe(select())
    expect(box().className.endsWith(' w-40')).toBe(true)
    expect(select().name).toBe('hill')
    expect(select().value).toBe('main')
    expect(select().disabled).toBe(true)
    expect(classes(box())).toContain('has-disabled:opacity-40')
  })
})
