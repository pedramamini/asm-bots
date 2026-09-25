/**
 * A bracket as an SVG document (PRODUCT_SPEC §4): the CLI's `--svg`, the web's bracket view, and
 * its `bracket.svg` download. Rounds are columns, left to right, the first round's matches top to
 * bottom and each later match centered between the two it takes its entrants from. Lines join a
 * match to the slot its winner goes to. The champion's box sits right of the final, the
 * third-place match under it.
 *
 * A match is a box of two rows, one per slot: the seed, the name, and the match points once it is
 * played. Its winner's row is bright, its loser's muted; a bye slot reads `bye`, a slot not decided
 * yet `—`. A walkover or an empty match is greyed. A match in `live` is outlined in the accent and
 * marked `data-live`, for the caller to animate; the one `selected` is outlined thicker.
 *
 * Every match's group carries `data-match-id` and `data-status`. The output is a plain string with
 * every name escaped, safe to write to a file or into the DOM.
 */
import type { Bracket, BracketMatch, BracketSlot } from './bracket'

/** The colors of a bracket drawing: CSS colors. */
export interface BracketPalette {
  /** Behind everything; `none` draws no background. */
  readonly background: string
  /** A match's box. */
  readonly node: string
  /** A match's outline and the line between its rows. */
  readonly border: string
  /** The lines between matches. */
  readonly line: string
  readonly text: string
  /** A loser, a seed, a round's title, a bye, a slot not decided yet. */
  readonly muted: string
  /** A winner. */
  readonly bright: string
  /** A live match's outline, the one selected, the champion's. */
  readonly accent: string
  /** The champion's name: the accent as text (`--accent-fg`, DESIGN_SYSTEM §2). */
  readonly accentText: string
}

/** The sentinel theme's tokens (DESIGN_SYSTEM §2): the CLI's colors. */
export const DEFAULT_BRACKET_PALETTE: BracketPalette = {
  background: '#0A0F0A',
  node: '#0D140D',
  border: '#2A4A2A',
  line: '#2A4A2A',
  text: '#A0C0A0',
  muted: '#7D9B7D',
  bright: '#E0FFE0',
  accent: '#00FF88',
  accentText: '#00FF88',
}

export interface BracketSvgOptions {
  /** Over `DEFAULT_BRACKET_PALETTE`. */
  readonly palette?: Partial<BracketPalette> | undefined
  /** The ids of the matches being played now. */
  readonly live?: readonly number[] | undefined
  /** The id of the match chosen, or null. */
  readonly selected?: number | null | undefined
  /** Makes each match a button: `role`, `tabindex`, and an `aria-label`. For the DOM, not a file. */
  readonly interactive?: boolean | undefined
  /** The document's `<title>`. */
  readonly title?: string | undefined
}

/** Where a match's box is, px from the top left of the drawing. */
export interface BracketNode {
  readonly id: number
  readonly x: number
  readonly y: number
}

export interface BracketLayout {
  readonly width: number
  readonly height: number
  /** By match id. */
  readonly nodes: readonly BracketNode[]
  /** The champion's box. */
  readonly champion: { readonly x: number; readonly y: number }
}

/** A match box's size, px: two rows. */
export const NODE_WIDTH = 176
export const ROW_HEIGHT = 18
export const NODE_HEIGHT = 2 * ROW_HEIGHT
/** The champion's box's height, px. */
const CHAMPION_HEIGHT = 28
/** Between the columns, and between two first-round boxes, px. */
const COLUMN_GAP = 40
const ROW_GAP = 12
const PAD = 16
/** The band of the rounds' titles, px. */
const TITLE = 20
/** The third-place match's distance under the final, px: room for its title. */
const THIRD_GAP = 36
/** A seed's gutter at a row's left, and the points' at its right, px. */
const SEED_WIDTH = 22
const POINTS_WIDTH = 30
/** Names longer than this end in an ellipsis; the box's `<title>` holds them whole. */
const NAME_CHARS = 17

/** The title of round `round` of `rounds`: the last three by name. */
export function roundTitle(round: number, rounds: number): string {
  const left = rounds - round
  if (left === 1) return 'final'
  if (left === 2) return 'semifinals'
  if (left === 3) return 'quarterfinals'
  return `round ${round + 1}`
}

/** Where each match's box goes. */
export function bracketLayout(bracket: Bracket): BracketLayout {
  const column = (round: number) => PAD + round * (NODE_WIDTH + COLUMN_GAP)
  const top = PAD + TITLE
  const centers: number[] = []
  const nodes: BracketNode[] = []
  for (const m of bracket.matches) {
    if (m.thirdPlace) continue
    let center: number
    if (m.round === 0) center = top + m.index * (NODE_HEIGHT + ROW_GAP) + NODE_HEIGHT / 2
    else {
      const [a, b] = m.slots.map((s) => centers[feeder(s) as number] as number) as [number, number]
      center = (a + b) / 2
    }
    centers[m.id] = center
    nodes[m.id] = { id: m.id, x: column(m.round), y: center - NODE_HEIGHT / 2 }
  }
  const final = nodes[bracket.final] as BracketNode
  let bottom = top + (bracket.size / 2) * (NODE_HEIGHT + ROW_GAP) - ROW_GAP
  if (bracket.thirdPlace !== null) {
    const y = final.y + NODE_HEIGHT + THIRD_GAP
    nodes[bracket.thirdPlace] = { id: bracket.thirdPlace, x: final.x, y }
    bottom = Math.max(bottom, y + NODE_HEIGHT)
  }
  const champion = { x: column(bracket.rounds), y: final.y + (NODE_HEIGHT - CHAMPION_HEIGHT) / 2 }
  return {
    width: champion.x + NODE_WIDTH + PAD,
    height: bottom + PAD,
    nodes,
    champion,
  }
}

/** The match a slot's entrant comes from, or null for a seed. */
function feeder(slot: BracketSlot): number | null {
  const { source } = slot
  if ('winnerOf' in source) return source.winnerOf
  if ('loserOf' in source) return source.loserOf
  return null
}

/** `text` with the five XML specials escaped: safe in content and in quoted attributes. */
export function escapeXml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  )
}

function clip(name: string): string {
  const chars = [...name]
  return chars.length > NAME_CHARS ? `${chars.slice(0, NAME_CHARS - 1).join('')}…` : name
}

/** Attributes from a record: values escaped, undefined ones left out. */
function attrs(values: Record<string, string | number | undefined>): string {
  return Object.entries(values)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}="${escapeXml(String(v))}"`)
    .join('')
}

/** What a screen reader says for match `m`. */
function matchLabel(bracket: Bracket, m: BracketMatch): string {
  const name = (slot: BracketSlot) =>
    slot.state === 'filled'
      ? (bracket.names[slot.entrant as number] as string)
      : slot.state === 'bye'
        ? 'bye'
        : 'to be decided'
  const where = m.thirdPlace ? 'third place' : roundTitle(m.round, bracket.rounds)
  const [a, b] = m.slots
  const winner = m.winner === null ? '' : `, ${bracket.names[m.winner]} advances`
  return `${where}, match ${m.id + 1}: ${name(a)} v ${name(b)}, ${m.status}${winner}`
}

function slotRow(
  bracket: Bracket,
  m: BracketMatch,
  j: 0 | 1,
  x: number,
  y: number,
  p: BracketPalette,
): string {
  const slot = m.slots[j]
  const baseline = y + ROW_HEIGHT / 2 + 4
  const e = slot.entrant
  let color = p.text
  let weight: string | undefined
  if (slot.state !== 'filled') color = p.muted
  else if (m.status === 'done' || m.status === 'walkover') {
    if (e === m.winner) {
      color = p.bright
      weight = 'bold'
    } else color = p.muted
  }
  const parts: string[] = []
  if (slot.state === 'filled') {
    const seed = bracket.seeds[e as number] as number
    parts.push(
      `<text${attrs({ x: x + SEED_WIDTH - 6, y: baseline, fill: p.muted, 'text-anchor': 'end', 'font-size': 9 })}>${seed}</text>`,
    )
  }
  const name =
    slot.state === 'filled'
      ? clip(bracket.names[e as number] as string)
      : slot.state === 'bye'
        ? 'bye'
        : '—'
  parts.push(
    `<text${attrs({ x: x + SEED_WIDTH, y: baseline, fill: color, 'font-weight': weight, 'font-style': slot.state === 'bye' ? 'italic' : undefined })}>${escapeXml(name)}</text>`,
  )
  if (m.status === 'done' && m.result !== null) {
    const points = m.result.points[j] as number
    parts.push(
      `<text${attrs({ x: x + NODE_WIDTH - 6, y: baseline, fill: color, 'text-anchor': 'end', 'font-weight': weight })}>${points}</text>`,
    )
  }
  return parts.join('')
}

/** The bracket as an SVG document. */
export function bracketSvg(bracket: Bracket, options: BracketSvgOptions = {}): string {
  const p: BracketPalette = { ...DEFAULT_BRACKET_PALETTE, ...options.palette }
  const live = new Set(options.live ?? [])
  const layout = bracketLayout(bracket)
  const { width, height, nodes } = layout
  const out: string[] = []
  out.push(
    `<svg${attrs({
      xmlns: 'http://www.w3.org/2000/svg',
      width,
      height,
      viewBox: `0 0 ${width} ${height}`,
      'font-family': 'JetBrains Mono, ui-monospace, SF Mono, Menlo, Consolas, monospace',
      'font-size': 11,
    })}>`,
  )
  if (options.title !== undefined) out.push(`<title>${escapeXml(options.title)}</title>`)
  if (p.background !== 'none') {
    out.push(`<rect${attrs({ width, height, fill: p.background })}/>`)
  }

  // The rounds' titles.
  for (let r = 0; r <= bracket.rounds; r++) {
    const x = PAD + r * (NODE_WIDTH + COLUMN_GAP)
    const title = r === bracket.rounds ? 'champion' : roundTitle(r, bracket.rounds)
    out.push(
      `<text${attrs({ x, y: PAD + 10, fill: p.muted, 'font-size': 10, 'letter-spacing': 1 })}>${title.toUpperCase()}</text>`,
    )
  }

  // The lines: from each match to the slot its winner fills, and from the final to the champion.
  out.push(`<g${attrs({ fill: 'none', 'stroke-width': 1 })}>`)
  for (const m of bracket.matches) {
    if (m.thirdPlace) continue
    const to = nodes[m.id] as BracketNode
    m.slots.forEach((slot, j) => {
      const from = feeder(slot)
      if (from === null) return
      const a = nodes[from] as BracketNode
      const x1 = a.x + NODE_WIDTH
      const y1 = a.y + NODE_HEIGHT / 2
      const y2 = to.y + j * ROW_HEIGHT + ROW_HEIGHT / 2
      const decided = slot.state !== 'pending'
      out.push(
        `<path${attrs({ d: `M${x1} ${y1}H${x1 + COLUMN_GAP / 2}V${y2}H${to.x}`, stroke: decided ? p.muted : p.line })}/>`,
      )
    })
  }
  const final = bracket.matches[bracket.final] as BracketMatch
  const fn = nodes[final.id] as BracketNode
  const cy = fn.y + NODE_HEIGHT / 2
  out.push(
    `<path${attrs({ d: `M${fn.x + NODE_WIDTH} ${cy}H${layout.champion.x}`, stroke: final.winner === null ? p.line : p.accent })}/>`,
  )
  out.push('</g>')

  // The third-place match's title.
  if (bracket.thirdPlace !== null) {
    const n = nodes[bracket.thirdPlace] as BracketNode
    out.push(
      `<text${attrs({ x: n.x, y: n.y - 8, fill: p.muted, 'font-size': 10, 'letter-spacing': 1 })}>THIRD PLACE</text>`,
    )
  }

  // The matches.
  for (const m of bracket.matches) {
    const { x, y } = nodes[m.id] as BracketNode
    const isLive = live.has(m.id)
    const selected = options.selected === m.id
    const greyed = m.status === 'walkover' || m.status === 'empty'
    const label = matchLabel(bracket, m)
    out.push(
      `<g${attrs({
        'data-match-id': m.id,
        'data-status': m.status,
        'data-live': isLive ? 'true' : undefined,
        'data-selected': selected ? 'true' : undefined,
        opacity: greyed ? 0.45 : undefined,
        role: options.interactive ? 'button' : undefined,
        tabindex: options.interactive ? 0 : undefined,
        'aria-label': options.interactive ? label : undefined,
        'aria-pressed': options.interactive ? String(selected) : undefined,
        cursor: options.interactive ? 'pointer' : undefined,
      })}>`,
    )
    if (!options.interactive) out.push(`<title>${escapeXml(label)}</title>`)
    out.push(
      `<rect${attrs({
        x: x + 0.5,
        y: y + 0.5,
        width: NODE_WIDTH - 1,
        height: NODE_HEIGHT - 1,
        rx: 3,
        fill: p.node,
        stroke: isLive || selected ? p.accent : p.border,
        'stroke-width': selected ? 2 : 1,
      })}/>`,
    )
    out.push(
      `<path${attrs({ d: `M${x + 1} ${y + ROW_HEIGHT}H${x + NODE_WIDTH - 1}`, stroke: p.border })}/>`,
    )
    out.push(
      `<path${attrs({ d: `M${x + SEED_WIDTH - 2} ${y + 1}V${y + NODE_HEIGHT - 1}`, stroke: p.border })}/>`,
    )
    if (m.status === 'done') {
      const px = x + NODE_WIDTH - POINTS_WIDTH
      out.push(`<path${attrs({ d: `M${px} ${y + 1}V${y + NODE_HEIGHT - 1}`, stroke: p.border })}/>`)
    }
    out.push(slotRow(bracket, m, 0, x, y, p))
    out.push(slotRow(bracket, m, 1, x, y + ROW_HEIGHT, p))
    out.push('</g>')
  }

  // The champion.
  const { x, y } = layout.champion
  const won = final.winner
  const name = won === null ? '—' : clip(bracket.names[won] as string)
  out.push(`<g${attrs({ 'data-champion': won === null ? undefined : won })}>`)
  out.push(
    `<rect${attrs({
      x: x + 0.5,
      y: y + 0.5,
      width: NODE_WIDTH - 1,
      height: CHAMPION_HEIGHT - 1,
      rx: 3,
      fill: p.node,
      stroke: won === null ? p.border : p.accent,
      'stroke-width': won === null ? 1 : 2,
    })}/>`,
  )
  out.push(
    `<text${attrs({
      x: x + 10,
      y: y + CHAMPION_HEIGHT / 2 + 4,
      fill: won === null ? p.muted : p.accentText,
      'font-weight': won === null ? undefined : 'bold',
      'font-size': 12,
    })}>${escapeXml(name)}</text>`,
  )
  out.push('</g>')

  out.push('</svg>')
  return out.join('')
}
