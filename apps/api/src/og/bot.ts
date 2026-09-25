/**
 * A bot's share card (PRODUCT_SPEC §10): its identicon at the size of the replay card's owner map,
 * beside its name, its owner, its strategy, its size and versions, and its best place on a hill.
 */
import type { Bot, BotPlacement, BotVersion, User } from '@asmbots/protocol'
import { CARD_HEIGHT, CARD_WIDTH } from '@asmbots/protocol'
import {
  brand,
  card,
  clip,
  count,
  fits,
  identicon,
  MARGIN,
  plural,
  SENTINEL,
  text,
  wrap,
} from './card'

/** The identicon's side, px: the replay card's owner map. */
const SIDE = 512
const ICON_Y = (CARD_HEIGHT - SIDE) / 2
const TEXT_X = MARGIN + SIDE + MARGIN
const TEXT_RIGHT = CARD_WIDTH - MARGIN
const TEXT_WIDTH = TEXT_RIGHT - TEXT_X
/** The strategy's lines, and the space between them. */
const STRATEGY_LINES = 4
const STRATEGY_Y = 318
const STRATEGY_STEP = 34

/** What a bot's card shows: `GET /api/bots/:id`'s detail, its newest version first. */
export interface BotCardInput {
  readonly bot: Bot
  readonly owner: User
  readonly versions: readonly BotVersion[]
  readonly placements: readonly BotPlacement[]
}

/** The place of `placements` with the best rank, the first of equals; null for none. */
export function bestPlacement(placements: readonly BotPlacement[]): BotPlacement | null {
  let best: BotPlacement | null = null
  for (const p of placements) if (best === null || p.entry.rank < best.entry.rank) best = p
  return best
}

/** The card of a bot; `host` signs it. The identicon is the bot page's: its newest bytes' hash. */
export function botCard({ bot, owner, versions, placements }: BotCardInput, host: string): string {
  const latest = versions[0] ?? null
  const byline =
    latest?.author && latest.author !== owner.handle
      ? `by ${owner.handle} · ${latest.author}`
      : `by ${owner.handle}`
  const strategy = latest?.strategy
    ? wrap(latest.strategy, fits(TEXT_WIDTH, 24), STRATEGY_LINES)
    : []
  const facts = [
    latest === null ? null : `${count(latest.size)} B`,
    plural(versions.length, 'version'),
    latest?.isa ?? null,
  ].filter((fact) => fact !== null)
  const best = bestPlacement(placements)
  const place =
    best === null
      ? `<text x="${TEXT_X}" y="540" fill="${SENTINEL.muted}" font-size="22">not on a hill yet.</text>`
      : `<text x="${TEXT_X}" y="540" fill="${SENTINEL.accent}" font-size="22">${text(clip(`#${best.entry.rank} on ${best.hill.name} · score ${count(best.entry.score)}`, fits(TEXT_WIDTH, 22)))}</text>`
  return card(`ASM BOTS: ${bot.name} by ${owner.handle}`, [
    `<rect x="${MARGIN - 1}" y="${ICON_Y - 1}" width="${SIDE + 2}" height="${SIDE + 2}" fill="${SENTINEL.arena}" stroke="${SENTINEL.borderStrong}" stroke-width="2"/>`,
    identicon(latest?.bytesSha256 ?? bot.id, MARGIN, ICON_Y, SIDE),
    brand(TEXT_X, 112, 'bot'),
    `<text x="${TEXT_X}" y="202" fill="${SENTINEL.bright}" font-size="48" font-weight="700">${text(clip(bot.name, fits(TEXT_WIDTH, 48)))}</text>`,
    `<text x="${TEXT_X}" y="250" fill="${SENTINEL.muted}" font-size="22">${text(clip(byline, fits(TEXT_WIDTH, 22)))}</text>`,
    ...strategy.map(
      (line, i) =>
        `<text x="${TEXT_X}" y="${STRATEGY_Y + i * STRATEGY_STEP}" fill="${SENTINEL.text}" font-size="24">${text(line)}</text>`,
    ),
    `<text x="${TEXT_X}" y="502" fill="${SENTINEL.text}" font-size="22">${text(facts.join(' · '))}</text>`,
    place,
    `<text x="${TEXT_RIGHT}" y="${ICON_Y + SIDE}" fill="${SENTINEL.dim}" font-size="20" text-anchor="end">${text(host)}</text>`,
  ])
}
