import { describe, expect, it } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { Sparkline, sparkBars, sparkPoints } from '../../src/index'
import { html, useDom } from '../dom'

useDom()

/** The points of a polyline as [x, y] pairs. */
const pairs = (points: string) => points.split(' ').map((p) => p.split(',').map(Number))

describe('sparkPoints', () => {
  it('spaces the values evenly, max at the top and min at the bottom, 1 px in from each edge', () => {
    expect(sparkPoints([0, 10, 5], 64, 16)).toBe('0,15 32,1 64,8')
  })

  it('maps between min and max when given, and holds a value outside them to the edge', () => {
    expect(pairs(sparkPoints([5, 10, 20], 10, 12, 0, 10))).toEqual([
      [0, 6],
      [5, 1],
      [10, 1],
    ])
    expect(pairs(sparkPoints([-5, 5], 10, 12, 0, 10))).toEqual([
      [0, 11],
      [10, 6],
    ])
  })

  it('draws a flat series through the middle, and one value as a line across', () => {
    expect(sparkPoints([7, 7, 7], 30, 16)).toBe('0,8 15,8 30,8')
    expect(sparkPoints([7], 30, 16)).toBe('0,8 30,8')
  })

  it('draws nothing for no values, or none that are numbers', () => {
    expect(sparkPoints([], 64, 16)).toBe('')
    expect(sparkPoints([Number.NaN, Number.POSITIVE_INFINITY], 64, 16)).toBe('')
    expect(sparkPoints([], 64, 16, 0, 10)).toBe('')
  })

  it('draws a value that is not a number at the bottom, and ranges over the others', () => {
    expect(sparkPoints([0, Number.NaN, 10], 20, 12)).toBe('0,11 10,11 20,1')
  })
})

describe('sparkBars', () => {
  it('gives each value an equal slot, 1 px apart, up from the bottom to its share of the max', () => {
    expect(sparkBars([2, 4, 1], 12, 8)).toEqual([
      { x: 0, y: 4, width: 3, height: 4 },
      { x: 4, y: 0, width: 3, height: 8 },
      { x: 8, y: 6, width: 3, height: 2 },
    ])
  })

  it('draws no bar for 0 or a value that is not a number, and holds one above max to the top', () => {
    expect(sparkBars([0, Number.NaN, 3], 30, 10).map((b) => b.x)).toEqual([20])
    expect(sparkBars([5, 20], 4, 10, 10)).toEqual([
      { x: 0, y: 5, width: 2, height: 5 },
      { x: 2, y: 0, width: 2, height: 10 },
    ])
  })

  it('draws nothing for no values or none above 0', () => {
    expect(sparkBars([], 64, 16)).toEqual([])
    expect(sparkBars([0, 0], 64, 16)).toEqual([])
  })
})

describe('Sparkline', () => {
  it('draws bars, not a line, with `bars`', () => {
    const { container } = render(<Sparkline bars values={[1, 0, 2]} width={30} height={10} />)
    expect(container.querySelector('polyline')).toBeNull()
    const rects = [...container.querySelectorAll('rect')]
    expect(rects.map((r) => r.getAttribute('height'))).toEqual(['5', '10'])
    expect(rects[0]?.getAttribute('fill')).toBe('currentColor')
  })

  it('draws the series as one line', () => {
    const { container } = render(<Sparkline values={[3, 8, 5, 12]} />)
    expect(html(container)).toMatchSnapshot()
  })

  it('is a 1 px accent stroke that stays 1 px when stretched (DESIGN_SYSTEM §4)', () => {
    const { container } = render(<Sparkline values={[1, 2]} className="w-full" />)
    const svg = container.querySelector('svg') as SVGSVGElement
    const line = svg.querySelector('polyline') as SVGPolylineElement
    expect(line.getAttribute('stroke')).toBe('currentColor')
    expect(line.getAttribute('stroke-width')).toBe('1')
    expect(line.getAttribute('vector-effect')).toBe('non-scaling-stroke')
    expect(line.getAttribute('fill')).toBe('none')
    expect(svg.getAttribute('preserveAspectRatio')).toBe('none')
    expect(svg.style.getPropertyValue('--hue')).toBe('var(--accent)')
    expect(svg.getAttribute('class')).toContain('text-(--hue)')
  })

  it('is 64 × 16 px unless told otherwise, its view box the same size', () => {
    const { container } = render(
      <>
        <Sparkline values={[1, 2]} />
        <Sparkline values={[1, 2]} width={120} height={24} />
      </>,
    )
    const [small, large] = [...container.querySelectorAll('svg')]
    expect([small?.getAttribute('width'), small?.getAttribute('height')]).toEqual(['64', '16'])
    expect(large?.getAttribute('viewBox')).toBe('0 0 120 24')
    expect(large?.querySelector('polyline')?.getAttribute('points')).toBe('0,23 120,1')
  })

  it('takes a bot’s hue by index, wrapping at 12, or any CSS color', () => {
    const { container } = render(
      <>
        <Sparkline values={[1, 2]} hue={5} />
        <Sparkline values={[1, 2]} hue={17} />
        <Sparkline values={[1, 2]} hue="#FFAA00" />
      </>,
    )
    expect(
      [...container.querySelectorAll('svg')].map((s) => s.style.getPropertyValue('--hue')),
    ).toEqual(['var(--bot-5)', 'var(--bot-5)', '#FFAA00'])
  })

  it('draws no line for no values', () => {
    const { container } = render(<Sparkline values={[]} />)
    expect(container.querySelector('polyline')).toBeNull()
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('is hidden from assistive tech, or an image when aria-label says what it shows', () => {
    const { container } = render(
      <>
        <Sparkline values={[1, 2]} />
        <Sparkline values={[1, 2]} aria-label="procs over 120 frames: 12 to 41" />
      </>,
    )
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    expect(screen.getByRole('img', { name: 'procs over 120 frames: 12 to 41' })).toBeTruthy()
  })
})
