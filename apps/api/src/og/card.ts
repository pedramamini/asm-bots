/**
 * What every share card has in common (PRODUCT_SPEC §10): the sentinel theme's colors, the brand
 * line, the footer, the text rules, and the identicon. A card is a string of SVG at `CARD_WIDTH` ×
 * `CARD_HEIGHT`; `png.ts` draws it. The font is JetBrains Mono, whose every glyph is 0.6 em wide,
 * so a line's width is its length in characters.
 */
import { CARD_HEIGHT, CARD_WIDTH } from '@asmbots/protocol'
import { escapeXml } from '@asmbots/tourney'
import {
  IDENTICON_CELLS,
  IDENTICON_OFF_OPACITY,
  identiconHue,
  identiconPath,
  identiconRows,
} from '@asmbots/ui/identicon'
import { BOT_HUES } from '@asmbots/ui/themes'

/** The page's margin, px. */
export const MARGIN = 48
/** Where the footer's hairline runs. */
export const FOOTER_Y = CARD_HEIGHT - 72

/** Sentinel's tokens (DESIGN_SYSTEM §2): `--bg`, `--border-strong`, `--text`, … in tokens.css. */
export const SENTINEL = {
  bg: '#0A0F0A',
  panel: '#111A11',
  border: '#1A2F1A',
  borderStrong: '#2A4A2A',
  text: '#A0C0A0',
  muted: '#7D9B7D',
  dim: '#4A6A4A',
  bright: '#E0FFE0',
  accent: '#00FF88',
  arena: '#000000',
} as const

const HUES = BOT_HUES.sentinel
const FONT = `'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace`

/** A glyph's width over the font size: JetBrains Mono's advance, 600 of 1,000 units. */
const ADVANCE = 0.6

/** The characters that fit `width` px at `size` px with `spacing` px between letters. */
export function fits(width: number, size: number, spacing = 0): number {
  return Math.floor(width / (size * ADVANCE + spacing))
}

/** Bot `i`'s hue; 12 and up wrap. */
export function hue(i: number): string {
  return HUES[((i % HUES.length) + HUES.length) % HUES.length] as string
}

/** `n` with thousands separators: `12,480`. */
export function count(n: number): string {
  return n.toLocaleString('en-US')
}

/** `100k`, `50k`, `1,500`: a hill's cycles, as its page writes them. */
export function short(n: number): string {
  return n >= 10_000 && n % 1000 === 0 ? `${n / 1000}k` : count(n)
}

/** `n`, and `one` or its plural: `1 bot`, `4 bots`. */
export function plural(n: number, one: string): string {
  return `${count(n)} ${one}${n === 1 ? '' : 's'}`
}

/** `value` cut to `most` characters, with an ellipsis when cut. */
export function clip(value: string, most: number): string {
  const chars = [...value]
  return chars.length > most ? `${chars.slice(0, Math.max(0, most - 1)).join('')}…` : value
}

/**
 * `value` in lines of at most `width` characters, broken between words (a word longer than a line
 * is cut), and at most `lines` of them: the last ends in an ellipsis when some is left out.
 */
export function wrap(value: string, width: number, lines: number): string[] {
  const out: string[] = []
  let line = ''
  const words = value.trim().split(/\s+/).filter(Boolean)
  for (let i = 0; i < words.length; i++) {
    let word = words[i] as string
    while ([...word].length > width) {
      if (line !== '') {
        out.push(line)
        line = ''
      }
      out.push([...word].slice(0, width).join(''))
      word = [...word].slice(width).join('')
    }
    const next = line === '' ? word : `${line} ${word}`
    if ([...next].length <= width) line = next
    else {
      out.push(line)
      line = word
    }
  }
  if (line !== '') out.push(line)
  if (out.length <= lines) return out
  const kept = out.slice(0, lines)
  kept[lines - 1] = clip(`${kept[lines - 1]} …`, width).replace(/ …$/, '…')
  return kept
}

/** What XML 1.0 does not allow: C0 controls but tab, LF, CR; U+FFFE, U+FFFF; lone surrogates. */
const NOT_XML =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the control characters are the point.
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

/** `value` as XML character data: escaped, and what XML does not allow replaced with U+FFFD. */
export function text(value: string): string {
  return escapeXml(value.replace(NOT_XML, '\uFFFD'))
}

/** A card: `parts` over the theme's background, named by `title` for screen readers. */
export function card(title: string, parts: readonly string[]): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}" font-family="${FONT}">`,
    `<title>${text(title)}</title>`,
    `<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="${SENTINEL.bg}"/>`,
    ...parts,
    '</svg>',
  ].join('\n')
}

/**
 * A space that starts a `<tspan>`: a plain one there is collapsed away (SVG's whitespace rules), a
 * no-break space is not.
 */
export const LEAD = '&#160;'

/** `ASM BOTS // LABEL` at `x`, `y`: the brand in the accent, the label muted. */
export function brand(x: number, y: number, label: string): string {
  const tail =
    label === ''
      ? ''
      : `<tspan fill="${SENTINEL.muted}">${LEAD}// ${text(label.toUpperCase())}</tspan>`
  return `<text x="${x}" y="${y}" fill="${SENTINEL.accent}" font-size="28" font-weight="700" letter-spacing="4">ASM BOTS${tail}</text>`
}

/**
 * The foot of a full-width card: a hairline, the 12 bot hues in a row at the left (color is
 * identity, DESIGN_SYSTEM §1), and the site's host at the right.
 */
export function footer(host: string): string {
  const swatches = HUES.map(
    (color, i) =>
      `<rect x="${MARGIN + i * 22}" y="${FOOTER_Y + 30}" width="16" height="16" fill="${color}"/>`,
  )
  return [
    `<rect x="${MARGIN}" y="${FOOTER_Y}" width="${CARD_WIDTH - 2 * MARGIN}" height="2" fill="${SENTINEL.border}"/>`,
    ...swatches,
    `<text x="${CARD_WIDTH - MARGIN}" y="${FOOTER_Y + 45}" fill="${SENTINEL.muted}" font-size="22" text-anchor="end">${text(host)}</text>`,
  ].join('')
}

/**
 * The identicon of `value` (the kit's `Identicon`, DESIGN_SYSTEM §6) as a `size` px square at
 * `x`, `y`: a patch of the arena, black, with its on cells in the hue and its off cells in the
 * hue's dim wash. `hueIndex` overrides the hue the hash picks.
 */
export function identicon(
  value: Uint8Array | string,
  x: number,
  y: number,
  size: number,
  hueIndex = identiconHue(value),
): string {
  const color = hue(hueIndex)
  const cells = IDENTICON_CELLS
  return [
    `<g transform="translate(${x} ${y}) scale(${size / cells})" shape-rendering="crispEdges">`,
    `<rect width="${cells}" height="${cells}" fill="${SENTINEL.arena}"/>`,
    `<rect width="${cells}" height="${cells}" fill="${color}" fill-opacity="${IDENTICON_OFF_OPACITY}"/>`,
    `<path d="${identiconPath(identiconRows(value))}" fill="${color}"/>`,
    '</g>',
  ].join('')
}
