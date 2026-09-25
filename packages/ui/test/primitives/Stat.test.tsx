import { describe, expect, it } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { Sparkline, Stat } from '../../src/index'
import { html, useDom } from '../dom'

useDom()

/** The delta's visible text, the arrow's spoken word aside. */
const shownDelta = (tile: HTMLElement) =>
  [...(tile.querySelector('.text-data > span')?.childNodes ?? [])]
    .filter((node) => !(node as HTMLElement).classList?.contains('sr-only'))
    .map((node) => node.textContent)
    .join('')

describe('Stat', () => {
  it('draws the label, the number, and the delta, and the loading tile', () => {
    const { container } = render(
      <>
        <Stat label="cycles" value="12,480" delta={1204} note="vs last round" />
        <Stat label="footprint" loading />
      </>,
    )
    expect(html(container)).toMatchSnapshot()
  })

  it('is a --panel tile with a hairline, a 4 px left stripe, radius 4, padding 12', () => {
    render(<Stat label="cycles" value="12,480" data-testid="tile" />)
    expect(screen.getByTestId('tile').className.split(' ')).toEqual(
      expect.arrayContaining([
        'bg-panel',
        'border',
        'border-l-4',
        'border-border',
        'rounded-md',
        'p-3',
      ]),
    )
  })

  it('sets the label in muted panel status type and the number in the stat type, bright', () => {
    render(<Stat label="cycles" value="12,480" />)
    expect(screen.getByText('cycles').className).toContain('text-panel-status text-muted')
    expect(screen.getByText('12,480').className).toContain('text-stat text-bright')
  })

  it('shows a rise as ▲ in accent and a fall as ▼ in danger, and says up or down', () => {
    render(
      <>
        <Stat label="cycles" value="12,480" delta={1204} data-testid="rise" />
        <Stat label="bots" value="8" delta={-2} data-testid="fall" />
      </>,
    )
    const rise = screen.getByTestId('rise')
    const fall = screen.getByTestId('fall')
    expect(shownDelta(rise)).toBe('▲ 1,204')
    expect(shownDelta(fall)).toBe('▼ 2')
    expect(rise.querySelector('.text-accent-fg')?.textContent).toBe('▲up 1,204')
    expect(fall.querySelector('.text-danger')?.textContent).toBe('▼down 2')
    expect(rise.querySelector('[aria-hidden]')?.textContent).toBe('▲')
    expect(rise.querySelector('.sr-only')?.textContent).toBe('up')
  })

  it('reads a fall as good news with invert: a rank, a size', () => {
    render(
      <>
        <Stat label="rank" value="#3" delta={-2} invert data-testid="better" />
        <Stat label="rank" value="#9" delta={4} invert data-testid="worse" />
      </>,
    )
    expect(screen.getByTestId('better').querySelector('.text-accent-fg')?.textContent).toBe(
      '▼down 2',
    )
    expect(screen.getByTestId('worse').querySelector('.text-danger')?.textContent).toBe('▲up 4')
  })

  it('shows no change as a muted 0 with no arrow', () => {
    render(<Stat label="procs" value="41" delta={0} data-testid="flat" />)
    const tile = screen.getByTestId('flat')
    expect(tile.querySelector('.text-data > span')?.textContent).toBe('0')
    expect(tile.querySelector('.text-data > span')?.className).toContain('text-muted')
  })

  it('formats the delta with formatDelta, and shows the note after it', () => {
    render(
      <Stat
        label="rating"
        value="1,612"
        delta={-24.5}
        formatDelta={(n) => n.toFixed(1)}
        note="this week"
        data-testid="tile"
      />,
    )
    const line = screen.getByTestId('tile').querySelector('.text-data') as HTMLElement
    expect(line.textContent).toBe('▼down 24.5this week')
    expect(screen.getByText('this week').className).toContain('text-muted')
  })

  it('has no delta line without a delta or a note, and ignores a delta that is not a number', () => {
    render(
      <>
        <Stat label="cycles" value="12,480" data-testid="bare" />
        <Stat label="cycles" value="12,480" delta={Number.NaN} data-testid="nan" />
      </>,
    )
    expect(screen.getByTestId('bare').querySelector('.text-data')).toBeNull()
    expect(screen.getByTestId('nan').querySelector('.text-data')).toBeNull()
  })

  it('keeps its label while loading, with skeletons the height of the number and the delta', () => {
    render(<Stat label="footprint" value="3,471 B" delta={12} loading data-testid="tile" />)
    const tile = screen.getByTestId('tile')
    expect(tile.getAttribute('aria-busy')).toBe('true')
    expect(screen.getByText('footprint')).toBeTruthy()
    expect(screen.queryByText('3,471 B')).toBeNull()
    const blocks = [...tile.querySelectorAll('[aria-hidden="true"]')]
    expect(blocks.map((b) => b.className.includes('bg-panel-2'))).toEqual([true, true])
    // Each skeleton sits in a line as tall as the text it stands for: 28 and 18 px.
    expect(blocks.map((b) => (b.parentElement as HTMLElement).className)).toEqual([
      'flex h-7 items-center',
      'flex h-4.5 items-center',
    ])
  })

  it('is not busy when loaded', () => {
    render(<Stat label="cycles" value="1" data-testid="tile" />)
    expect(screen.getByTestId('tile').getAttribute('aria-busy')).toBeNull()
  })

  it('puts its children at the right, level with the delta', () => {
    render(
      <Stat label="cycles" value="12,480" data-testid="tile">
        <Sparkline values={[1, 3, 2]} aria-label="cycles per frame" />
      </Stat>,
    )
    const tile = screen.getByTestId('tile')
    const spark = screen.getByRole('img', { name: 'cycles per frame' })
    expect(spark.parentElement?.parentElement).toBe(tile)
    expect(tile.lastElementChild).toBe(spark.parentElement)
    expect(tile.className).toContain('items-end')
  })

  it('passes className, attributes, and ref through', () => {
    const ref = createRef<HTMLDivElement>()
    render(<Stat ref={ref} label="cycles" value="1" className="col-span-3" id="cycles" />)
    const tile = document.getElementById('cycles') as HTMLElement
    expect(ref.current).toBe(tile)
    expect(tile.className.endsWith(' col-span-3')).toBe(true)
  })
})
