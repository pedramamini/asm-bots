import { describe, expect, it } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { ShieldCheck } from 'lucide-react'
import { Chip, type ChipVariant } from '../../src/index'
import { html, useDom } from '../dom'

useDom()

const VARIANTS: readonly (readonly [ChipVariant, string])[] = [
  ['neutral', 'text-muted'],
  ['accent', 'text-accent'],
  ['warn', 'text-warn'],
  ['danger', 'text-danger'],
  ['info', 'text-info'],
]

describe('Chip', () => {
  it('draws a chip in each variant', () => {
    const { container } = render(
      <>
        {VARIANTS.map(([variant]) => (
          <Chip key={variant} variant={variant}>
            {variant}
          </Chip>
        ))}
        <Chip variant="accent" icon={ShieldCheck}>
          verified
        </Chip>
      </>,
    )
    expect(html(container)).toMatchSnapshot()
  })

  it('is 10 px UPPER type on --panel with a hairline, radius 3, padding 2 8 (DESIGN_SYSTEM §4)', () => {
    render(<Chip>3 active</Chip>)
    expect(screen.getByText('3 active').className.split(' ')).toEqual(
      expect.arrayContaining([
        'text-panel-status',
        'bg-panel',
        'border',
        'border-border',
        'rounded-sm',
        'px-2',
        'py-0.5',
      ]),
    )
  })

  it('tints only the text for a variant: the fill and the hairline stay', () => {
    render(
      VARIANTS.map(([variant]) => (
        <Chip key={variant} variant={variant}>
          {variant}
        </Chip>
      )),
    )
    for (const [variant, text] of VARIANTS) {
      const names = screen.getByText(variant).className.split(' ')
      expect({
        variant,
        text: names.filter((name) => name.startsWith('text-') && name !== 'text-panel-status'),
      }).toEqual({
        variant,
        text: [text],
      })
      expect(names).toEqual(expect.arrayContaining(['bg-panel', 'border-border']))
    }
  })

  it('draws a 12 px icon, hidden from assistive tech', () => {
    render(<Chip icon={ShieldCheck}>verified</Chip>)
    const icon = screen.getByText('verified').querySelector('svg') as SVGElement
    expect(icon.getAttribute('width')).toBe('12')
    expect(icon.getAttribute('aria-hidden')).toBe('true')
  })

  it('passes className and attributes through', () => {
    render(
      <Chip className="ml-auto" title="frames per second">
        60 fps
      </Chip>,
    )
    const chip = screen.getByText('60 fps')
    expect(chip.className.endsWith(' ml-auto')).toBe(true)
    expect(chip.title).toBe('frames per second')
  })
})
