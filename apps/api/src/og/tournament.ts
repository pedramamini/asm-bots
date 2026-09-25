/**
 * A tournament's share card (PRODUCT_SPEC §10): its name, kind, and state, the champion once it
 * has one, and a thumbnail of how it stands: a bracket's drawing (`@asmbots/tourney`'s
 * `bracketSvg`, scaled to fit), a round robin's or a melee's points so far, or, before anything is
 * played, its entrants.
 */
import {
  type BotLabel,
  CARD_WIDTH,
  entrantNames,
  type Match,
  type Tournament,
} from '@asmbots/protocol'
import { type Bracket, bracketSvg, champion, DEFAULT_BRACKET_PALETTE } from '@asmbots/tourney'
import {
  brand,
  card,
  clip,
  count,
  FOOTER_Y,
  fits,
  footer,
  identicon,
  LEAD,
  MARGIN,
  plural,
  SENTINEL,
  text,
} from './card'

/** The thumbnail's box. */
const BODY_Y = 240
const BODY_HEIGHT = FOOTER_Y - 16 - BODY_Y
const BODY_WIDTH = CARD_WIDTH - 2 * MARGIN
/** The most rows a list shows. */
const ROWS = 7
const ROW_STEP = 38
const ICON = 26
const NAME_X = MARGIN + 88
const OWNER_X = 760
const RIGHT = CARD_WIDTH - MARGIN

const KINDS: Readonly<Record<Tournament['kind'], string>> = {
  roundrobin: 'round robin',
  bracket: 'bracket',
  melee: 'melee',
}

/** The card of a tournament, its entrants (in seed order), and its matches; `host` signs it. */
export function tournamentCard(
  t: Tournament,
  entrants: readonly BotLabel[],
  matches: readonly Match[],
  host: string,
): string {
  const names = entrantNames(entrants)
  const bracket = t.kind === 'bracket' ? bracketOf(t, names) : null
  const winner = championOf(t, entrants, bracket)
  const facts = [KINDS[t.kind], plural(entrants.length, 'bot'), t.status].join(' · ')
  const crown =
    winner === null
      ? ''
      : `<tspan fill="${SENTINEL.accent}">${LEAD}· champion: ${text(clip(names[winner] ?? '', 32))}</tspan>`
  return card(`ASM BOTS: ${t.name}`, [
    brand(MARGIN, 96, 'tournament'),
    `<text x="${MARGIN}" y="164" fill="${SENTINEL.bright}" font-size="52" font-weight="700">${text(clip(t.name, fits(BODY_WIDTH, 52)))}</text>`,
    `<text x="${MARGIN}" y="206" fill="${SENTINEL.muted}" font-size="22">${text(facts)}${crown}</text>`,
    ...(bracket === null ? standingsRows(entrants, names, matches) : [thumbnail(bracket)]),
    footer(host),
  ])
}

/** The bracket a tournament keeps, with its entrants' names, or null when it has none to draw. */
function bracketOf(t: Tournament, names: readonly string[]): Bracket | null {
  const kept = t.bracket as Partial<Bracket> | null
  if (kept === null || typeof kept !== 'object' || !Array.isArray(kept.matches)) return null
  const bracket = { ...kept, names } as Bracket
  try {
    bracketSvg(bracket)
    return bracket
  } catch {
    return null
  }
}

/** The champion's entrant index: the one the server named, else a finished bracket's. */
function championOf(
  t: Tournament,
  entrants: readonly BotLabel[],
  bracket: Bracket | null,
): number | null {
  if (t.status !== 'finished') return null
  if (t.championId !== null) {
    const e = entrants.findIndex((label) => label.versionId === t.championId)
    return e < 0 ? null : e
  }
  return bracket === null ? null : champion(bracket)
}

/** The bracket's drawing in the sentinel theme, scaled into the card's body, left aligned. */
function thumbnail(bracket: Bracket): string {
  const drawing = bracketSvg(bracket, {
    palette: { ...DEFAULT_BRACKET_PALETTE, background: 'none' },
  })
  return drawing.replace(
    /^<svg xmlns="([^"]+)" width="[\d.]+" height="[\d.]+"/,
    `<svg xmlns="$1" x="${MARGIN}" y="${BODY_Y}" width="${BODY_WIDTH}" height="${BODY_HEIGHT}" preserveAspectRatio="xMinYMid meet"`,
  )
}

/**
 * The entrants by the points their played matches give them, most first (a round robin's or a
 * melee's standings so far); before any match, the entrants in seed order.
 */
function standingsRows(
  entrants: readonly BotLabel[],
  names: readonly string[],
  matches: readonly Match[],
): string[] {
  if (entrants.length === 0) {
    return [
      `<text x="${MARGIN}" y="${BODY_Y + 52}" fill="${SENTINEL.muted}" font-size="26">no bots have entered yet.</text>`,
    ]
  }
  const byVersion = new Map(entrants.map((label, e) => [label.versionId, e]))
  const points = entrants.map(() => 0)
  let played = 0
  for (const match of matches) {
    if (match.result === null) continue
    played++
    match.participants.forEach((versionId, j) => {
      const e = byVersion.get(versionId)
      if (e !== undefined) points[e] = (points[e] ?? 0) + (match.result?.points[j] ?? 0)
    })
  }
  const order = entrants.map((_, e) => e)
  if (played > 0) order.sort((a, b) => (points[b] ?? 0) - (points[a] ?? 0) || a - b)
  const rows = order.slice(0, ROWS).map((e, i) => {
    const y = BODY_Y + 32 + i * ROW_STEP
    const label = entrants[e] as BotLabel
    const lead = played > 0 && i === 0
    return [
      `<text x="${MARGIN}" y="${y}" fill="${lead ? SENTINEL.accent : SENTINEL.muted}">${played > 0 ? `#${i + 1}` : `${e + 1}.`}</text>`,
      identicon(label.versionId, MARGIN + 50, y - ICON + 6, ICON),
      `<text x="${NAME_X}" y="${y}" fill="${lead ? SENTINEL.bright : SENTINEL.text}">${text(clip(names[e] ?? label.name, fits(OWNER_X - NAME_X - 16, 24)))}</text>`,
      `<text x="${OWNER_X}" y="${y}" fill="${SENTINEL.muted}">${text(clip(label.owner, 16))}</text>`,
      played > 0
        ? `<text x="${RIGHT}" y="${y}" fill="${lead ? SENTINEL.accent : SENTINEL.text}" text-anchor="end">${count(points[e] ?? 0)} pts</text>`
        : '',
    ].join('')
  })
  const more =
    entrants.length > ROWS
      ? `<text x="${MARGIN}" y="${Math.min(BODY_Y + 32 + ROWS * ROW_STEP, FOOTER_Y - 14)}" fill="${SENTINEL.dim}" font-size="20">+ ${entrants.length - ROWS} more</text>`
      : ''
  return [`<g font-size="24">${rows.join('')}</g>`, more]
}
