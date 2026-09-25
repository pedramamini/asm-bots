/**
 * A hill's share card (PRODUCT_SPEC §10): its name and rules over its standings, king first: the
 * rank, each bot's identicon (the king card's: its version id), name, owner, and score.
 */
import type { Hill, HillStanding } from '@asmbots/protocol'
import { CARD_WIDTH } from '@asmbots/protocol'
import {
  brand,
  card,
  clip,
  count,
  FOOTER_Y,
  fits,
  footer,
  identicon,
  MARGIN,
  plural,
  SENTINEL,
  short,
  text,
} from './card'

/** The most standings the card lists. */
export const HILL_ROWS = 7
const TABLE_Y = 272
const ROW_STEP = 38
const ICON = 26
const NAME_X = MARGIN + 88
const OWNER_X = 760
const RIGHT = CARD_WIDTH - MARGIN

/** The card of `hill` and its standings; `host` signs it. */
export function hillCard(hill: Hill, standings: readonly HillStanding[], host: string): string {
  const n = standings.length
  const rules = [
    `${n} of ${plural(hill.size, 'place')}`,
    plural(hill.rounds, 'round'),
    `${short(hill.config.maxCycles)} cycles`,
    `${count(hill.config.maxBotBytes)} B`,
  ].join(' · ')
  const rows = standings.slice(0, HILL_ROWS).map((s, i) => {
    const y = TABLE_Y + i * ROW_STEP
    const king = s.entry.rank === 1
    return [
      `<text x="${MARGIN}" y="${y}" fill="${king ? SENTINEL.accent : SENTINEL.muted}" font-weight="${king ? 700 : 400}">#${s.entry.rank}</text>`,
      identicon(s.bot.versionId, MARGIN + 50, y - ICON + 6, ICON),
      `<text x="${NAME_X}" y="${y}" fill="${king ? SENTINEL.bright : SENTINEL.text}" font-weight="${king ? 700 : 400}">${text(clip(s.bot.name, fits(OWNER_X - NAME_X - 16, 24)))}</text>`,
      `<text x="${OWNER_X}" y="${y}" fill="${SENTINEL.muted}">${text(clip(s.bot.owner, 16))}</text>`,
      `<text x="${RIGHT}" y="${y}" fill="${king ? SENTINEL.accent : SENTINEL.text}" text-anchor="end">${count(s.entry.score)}</text>`,
    ].join('')
  })
  const more =
    n > HILL_ROWS
      ? `<text x="${MARGIN}" y="${Math.min(TABLE_Y + HILL_ROWS * ROW_STEP, FOOTER_Y - 14)}" fill="${SENTINEL.dim}" font-size="20">+ ${n - HILL_ROWS} more</text>`
      : ''
  const body =
    n === 0
      ? [
          `<text x="${MARGIN}" y="${TABLE_Y + 20}" fill="${SENTINEL.muted}" font-size="26">no entrants yet. submit a bot →</text>`,
        ]
      : [`<g font-size="24">${rows.join('')}</g>`, more]
  return card(`ASM BOTS: the ${hill.name} hill`, [
    brand(MARGIN, 96, 'hill'),
    `<text x="${MARGIN}" y="170" fill="${SENTINEL.bright}" font-size="56" font-weight="700">${text(clip(hill.name, fits(CARD_WIDTH - 2 * MARGIN, 56)))}</text>`,
    `<text x="${MARGIN}" y="214" fill="${SENTINEL.muted}" font-size="22">${text(rules)}</text>`,
    ...body,
    footer(host),
  ])
}
