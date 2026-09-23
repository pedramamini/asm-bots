import { describe, expect, it } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { HueSwatch } from '../../src/index'
import { html, useDom } from '../dom'

useDom()

const svgs = (container: HTMLElement) => [...container.querySelectorAll('svg')]
const hueOf = (svg: SVGElement) => svg.style.getPropertyValue('--hue')

describe('HueSwatch', () => {
  it('draws a plain swatch and a hatched one', () => {
    const { container } = render(
      <>
        <HueSwatch hue={2} />
        <HueSwatch hue={14} />
      </>,
    )
    expect(html(container)).toMatchSnapshot()
  })

  it('shows a bot’s theme hue by index, and any CSS color', () => {
    const { container } = render(
      <>
        <HueSwatch hue={0} />
        <HueSwatch hue={11} />
        <HueSwatch hue="#123456" />
      </>,
    )
    expect(svgs(container).map(hueOf)).toEqual(['var(--bot-0)', 'var(--bot-11)', '#123456'])
    for (const svg of svgs(container)) expect(svg.getAttribute('class')).toContain('text-(--hue)')
  })

  it('wraps bot 12 and up to the hue of the bot 12 below, and hatches it (DESIGN_SYSTEM §2)', () => {
    const { container } = render(
      <>
        <HueSwatch hue={11} />
        <HueSwatch hue={12} />
        <HueSwatch hue={15} />
        <HueSwatch hue="var(--bot-3)" />
      </>,
    )
    const [eleven, twelve, fifteen, color] = svgs(container) as SVGElement[]
    expect([hueOf(twelve as SVGElement), hueOf(fifteen as SVGElement)]).toEqual([
      'var(--bot-0)',
      'var(--bot-3)',
    ])
    const hatched = (svg: SVGElement | undefined) => svg?.querySelector('path') !== null
    expect([eleven, twelve, fifteen, color].map(hatched)).toEqual([false, true, true, false])
    expect(twelve?.getAttribute('data-hatched')).toBe('true')
    expect(eleven?.getAttribute('data-hatched')).toBeNull()
    expect(twelve?.querySelector('path')?.getAttribute('class')).toBe('stroke-arena-bg')
  })

  it('is the hue inside a 1 px black bezel, 10 px unless told otherwise', () => {
    const { container } = render(
      <>
        <HueSwatch hue={4} />
        <HueSwatch hue={4} size={8} />
      </>,
    )
    const [ten, eight] = svgs(container)
    expect(ten?.getAttribute('width')).toBe('10')
    expect(ten?.getAttribute('viewBox')).toBe('0 0 10 10')
    const [bezel, hue] = [...(ten?.querySelectorAll('rect') ?? [])]
    expect(bezel?.getAttribute('class')).toBe('fill-arena-bg')
    expect([hue?.getAttribute('x'), hue?.getAttribute('width'), hue?.getAttribute('fill')]).toEqual(
      ['1', '8', 'currentColor'],
    )
    expect(eight?.getAttribute('height')).toBe('8')
    expect(eight?.querySelectorAll('rect')[1]?.getAttribute('width')).toBe('6')
  })

  it('is hidden from assistive tech, or an image when aria-label names it', () => {
    const { container } = render(
      <>
        <HueSwatch hue={1} />
        <HueSwatch hue={1} aria-label="bot 2 color" />
      </>,
    )
    expect(svgs(container)[0]?.getAttribute('aria-hidden')).toBe('true')
    expect(screen.getByRole('img', { name: 'bot 2 color' })).toBe(
      svgs(container)[1] as SVGSVGElement,
    )
  })

  it('passes className and attributes through', () => {
    const { container } = render(<HueSwatch hue={1} className="ml-1" data-bot="2" />)
    const svg = svgs(container)[0] as SVGElement
    expect(svg.getAttribute('class')?.endsWith(' ml-1')).toBe(true)
    expect(svg.dataset.bot).toBe('2')
  })
})
