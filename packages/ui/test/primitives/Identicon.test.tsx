import { describe, expect, it } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { HUE_COUNT, Identicon, identiconHue, identiconRows } from '../../src/index'
import { html, useDom } from '../dom'

useDom()

const ROSTER = [
  'imp',
  'dwarf',
  'dwarf-v3',
  'stone',
  'paper',
  'silk',
  'scanner',
  'vampire',
  'gate',
  'decoy',
  'hybrid',
  'bomber',
  'wisp',
  'imp-gate',
  'paper-v2',
  'dwarf-v10',
]

/** The cells of an identicon's rows as a picture: `#` on, `.` off. */
const picture = (rows: Uint8Array) =>
  [...rows].map((bits) =>
    bits.toString(2).padStart(8, '0').replaceAll('1', '#').replaceAll('0', '.'),
  )

/** Each byte's bits in reverse: a row reads the same both ways when it mirrors. */
const reversed = (bits: number) =>
  Number.parseInt(bits.toString(2).padStart(8, '0').split('').reverse().join(''), 2)

describe('Identicon', () => {
  it('draws a bot’s avatar as a patch of the arena', () => {
    const { container } = render(<Identicon value="dwarf-v3" hue={3} />)
    expect(html(container)).toMatchSnapshot()
  })

  it('draws the same pattern for equal input, as markup and as rows', () => {
    const a = render(<Identicon value="dwarf-v3" />).container.innerHTML
    const b = render(<Identicon value="dwarf-v3" />).container.innerHTML
    expect(a).toBe(b)
    expect(identiconRows('dwarf-v3')).toEqual(identiconRows('dwarf-v3'))
    // A string is its UTF-8 bytes: the bytes draw the same identicon.
    expect(identiconRows(new TextEncoder().encode('dwarf-v3'))).toEqual(identiconRows('dwarf-v3'))
    expect(identiconHue(new TextEncoder().encode('dwarf-v3'))).toBe(identiconHue('dwarf-v3'))
  })

  it('draws a different pattern for each different input', () => {
    const pictures = ROSTER.map((name) => picture(identiconRows(name)).join('\n'))
    expect(new Set(pictures).size).toBe(ROSTER.length)
    // One byte apart still differs, and by more than a cell or two.
    const a = identiconRows(Uint8Array.of(0xb8, 0x00, 0x01, 0xc3))
    const b = identiconRows(Uint8Array.of(0xb8, 0x00, 0x02, 0xc3))
    const changed = [...a].reduce((n, bits, i) => n + popcount(bits ^ (b[i] as number)), 0)
    expect(changed).toBeGreaterThan(8)
    // The empty input has a pattern too.
    expect(identiconRows(new Uint8Array(0))).toHaveLength(8)
  })

  it('mirrors each row left to right', () => {
    for (const name of ROSTER) {
      for (const bits of identiconRows(name)) {
        expect({ name, bits: reversed(bits) }).toEqual({ name, bits })
      }
    }
  })

  it('turns on about half the cells across many inputs', () => {
    let on = 0
    for (let n = 0; n < 500; n++)
      on += [...identiconRows(`bot-${n}`)].reduce((s, b) => s + popcount(b), 0)
    expect(on / (500 * 64)).toBeGreaterThan(0.45)
    expect(on / (500 * 64)).toBeLessThan(0.55)
  })

  it('draws the rows it computes: one rectangle per run of on cells', () => {
    const { container } = render(<Identicon value="imp" />)
    const d = container.querySelector('path')?.getAttribute('d') ?? ''
    const cells = new Set<string>()
    for (const [, x, y, run] of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
      for (let i = 0; i < Number(run); i++) cells.add(`${Number(x) + i},${y}`)
    }
    const expected = new Set<string>()
    identiconRows('imp').forEach((bits, y) => {
      for (let x = 0; x < 8; x++) if ((bits << x) & 0x80) expected.add(`${x},${y}`)
    })
    expect([...cells].sort()).toEqual([...expected].sort())
  })

  it('takes a bot index or a CSS color as its hue, and a hue from the hash without one', () => {
    const { container } = render(
      <>
        <Identicon value="imp" hue={3} />
        <Identicon value="imp" hue={15} />
        <Identicon value="imp" hue="var(--accent)" />
        <Identicon value="imp" />
      </>,
    )
    const hues = [...container.querySelectorAll('svg')].map((svg) =>
      (svg as SVGElement).style.getPropertyValue('--hue'),
    )
    expect(hues).toEqual([
      'var(--bot-3)',
      'var(--bot-3)',
      'var(--accent)',
      `var(--bot-${identiconHue('imp')})`,
    ])
    for (const svg of container.querySelectorAll('svg'))
      expect(svg.getAttribute('class')).toContain('text-(--hue)')
  })

  it('spreads the hashed hues over all 12 bot hues', () => {
    const hues = new Set(
      ROSTER.concat(Array.from({ length: 200 }, (_, n) => `bot-${n}`)).map(identiconHue),
    )
    expect([...hues].sort((a, b) => a - b)).toEqual(Array.from({ length: HUE_COUNT }, (_, i) => i))
  })

  it('is an 8 × 8 grid on black, off cells a 0.22 wash of the hue, drawn crisp', () => {
    const { container } = render(<Identicon value="imp" size={16} />)
    const svg = container.querySelector('svg') as SVGSVGElement
    expect(svg.getAttribute('viewBox')).toBe('0 0 8 8')
    expect(svg.getAttribute('width')).toBe('16')
    expect(svg.getAttribute('height')).toBe('16')
    expect(svg.getAttribute('shape-rendering')).toBe('crispEdges')
    const [tile, wash] = [...svg.querySelectorAll('rect')]
    expect(tile?.getAttribute('class')).toBe('fill-arena-bg')
    expect(wash?.getAttribute('fill')).toBe('currentColor')
    expect(wash?.getAttribute('fill-opacity')).toBe('0.22')
  })

  it('is 32 px unless told otherwise', () => {
    const { container } = render(<Identicon value="imp" />)
    expect(container.querySelector('svg')?.getAttribute('width')).toBe('32')
  })

  it('is hidden from assistive tech, or an image when aria-label names it', () => {
    const { container } = render(
      <>
        <Identicon value="imp" />
        <Identicon value="dwarf" aria-label="dwarf’s avatar" />
      </>,
    )
    const [plain] = container.querySelectorAll('svg')
    expect(plain?.getAttribute('aria-hidden')).toBe('true')
    expect(plain?.getAttribute('role')).toBeNull()
    const named = screen.getByRole('img', { name: 'dwarf’s avatar' })
    expect(named.getAttribute('aria-hidden')).toBeNull()
  })

  it('passes className, attributes, and style through, keeping its hue', () => {
    const { container } = render(
      <Identicon
        value="imp"
        hue={1}
        className="rounded-sm"
        data-bot="imp"
        style={{ opacity: 0.5 }}
      />,
    )
    const svg = container.querySelector('svg') as SVGSVGElement
    expect(svg.getAttribute('class')?.endsWith(' rounded-sm')).toBe(true)
    expect(svg.dataset.bot).toBe('imp')
    expect(svg.style.opacity).toBe('0.5')
    expect(svg.style.getPropertyValue('--hue')).toBe('var(--bot-1)')
  })
})

function popcount(bits: number): number {
  let n = 0
  for (let b = bits; b !== 0; b &= b - 1) n++
  return n
}
