import { describe, expect, it } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { Button, RadarLoader } from '../../src/index'
import { html, useDom } from '../dom'

useDom()

describe('RadarLoader', () => {
  it('draws the scope, the label, and the detail', () => {
    const { container } = render(
      <RadarLoader framed label="loading dashboard" detail="6 sections remaining" />,
    )
    expect(html(container)).toMatchSnapshot()
  })

  it('is a status region that reads the label and the detail; the scope is hidden', () => {
    render(<RadarLoader label="loading dashboard" detail="6 sections remaining" />)
    const status = screen.getByRole('status')
    expect(status.textContent).toBe('loading dashboard6 sections remaining')
    expect(status.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('says loading to assistive tech when it has no label', () => {
    render(<RadarLoader />)
    const said = screen.getByRole('status').querySelector('.sr-only')
    expect(said?.textContent).toBe('loading')
  })

  it('sets the label in accent panel title type and the detail muted, lowercase', () => {
    render(<RadarLoader label="loading demo" detail="4 bots" />)
    expect(screen.getByText('loading demo').className).toContain('text-panel-title text-accent')
    expect(screen.getByText('4 bots').className.split(' ')).toEqual(
      expect.arrayContaining(['text-panel-status', 'text-muted', 'normal-case']),
    )
  })

  it('turns the beam once every 2 s, and holds it still for reduced motion (DESIGN_SYSTEM §4, §8)', () => {
    const { container } = render(<RadarLoader />)
    const beam = container.querySelector('.animate-radar-sweep') as SVGGElement
    expect(beam.getAttribute('class')).toBe('animate-radar-sweep motion-reduce:animate-none')
    // The afterglow: 30 sectors that all end at the beam, and the beam itself.
    expect(beam.querySelectorAll('path')).toHaveLength(31)
    const ends = [...beam.querySelectorAll('path')]
      .slice(0, 30)
      .map((p) => p.getAttribute('d')?.split('A')[1])
    expect(new Set(ends).size).toBe(1)
  })

  it('flares each contact as the beam passes it: a negative delay into the turn', () => {
    const { container } = render(<RadarLoader />)
    const blips = [...container.querySelectorAll<SVGGElement>('.animate-radar-blip')]
    expect(blips.map((b) => b.style.getPropertyValue('--blip-delay'))).toEqual([
      '-1.8s',
      '-1.26s',
      '-0.63s',
    ])
    for (const blip of blips)
      expect(blip.getAttribute('class')).toContain('motion-reduce:animate-none')
  })

  it('draws the scope at `size` px, 112 by default', () => {
    const { container } = render(
      <>
        <RadarLoader />
        <RadarLoader size={64} />
      </>,
    )
    const [normal, small] = [...container.querySelectorAll('svg')]
    expect(normal?.getAttribute('width')).toBe('112')
    expect(small?.getAttribute('height')).toBe('64')
    expect(small?.getAttribute('viewBox')).toBe('0 0 100 100')
  })

  it('gives each scope its own pattern and gradient ids', () => {
    const { container } = render(
      <>
        <RadarLoader />
        <RadarLoader />
      </>,
    )
    const ids = [...container.querySelectorAll('pattern, radialGradient')].map((d) => d.id)
    expect(new Set(ids).size).toBe(4)
    const fills = [...container.querySelectorAll('circle[fill^="url("]')].map((c) =>
      c.getAttribute('fill'),
    )
    expect(fills.map((f) => f?.slice(5, -1)).sort()).toEqual([...ids].sort())
  })

  it('draws the reference’s card when framed: --bg, an accent hairline, radius 6', () => {
    render(
      <>
        <RadarLoader framed label="a" />
        <RadarLoader label="b" />
      </>,
    )
    const [framed, bare] = screen.getAllByRole('status')
    expect(framed?.className.split(' ')).toEqual(
      expect.arrayContaining(['rounded-lg', 'border', 'border-accent-25', 'bg-bg']),
    )
    expect(bare?.className).not.toContain('border')
  })

  it('draws its children under the detail, and passes className through', () => {
    render(
      <RadarLoader detail="2 of 3" className="mx-auto">
        <Button>cancel</Button>
      </RadarLoader>,
    )
    const status = screen.getByRole('status')
    expect(status.lastElementChild).toBe(screen.getByRole('button', { name: 'cancel' }))
    expect(status.className.endsWith(' mx-auto')).toBe(true)
  })
})
