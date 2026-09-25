/**
 * A replay's share card (PRODUCT_SPEC §10): the core's owner map at the end of the last round,
 * one pixel a byte (the 64 KB core is 256 × 256) at twice the size, beside who won and the bots
 * with their points. Each row's runs of one owner are one `<rect>`, grouped by owner under its hue.
 */
import { Battle, CORE_SIZE } from '@asmbots/engine'
import { CARD_HEIGHT, CARD_WIDTH, type Replay, replayBots, replayConfig } from '@asmbots/protocol'
import { roundOrder, roundSeed } from '@asmbots/tourney'
import { brand, card, clip, hue, MARGIN, SENTINEL, text } from './card'

/** The owner map's side, in bytes: 256 rows of 256. */
const SIDE = 256
/** Screen pixels a byte. */
const SCALE = 2
const MAP_X = MARGIN
const MAP_Y = (CARD_HEIGHT - SIDE * SCALE) / 2
/** Where the text column starts. */
const TEXT_X = MAP_X + SIDE * SCALE + MARGIN
const TEXT_RIGHT = CARD_WIDTH - MARGIN
/** The most bots the list names; the rest are a count. */
const LISTED = 8
/** The list's first line and the space between lines. */
const LIST_Y = 318
const LIST_STEP = 32

/**
 * The owner of each core byte at the end of `replay`'s last round, by address: entrant index + 1,
 * or 0 for nobody. Runs that round again.
 */
export function finalOwners(replay: Replay): Uint8Array {
  const bots = replayBots(replay)
  const round = replay.rounds - 1
  const order = roundOrder(bots.length, round)
  const config = { ...replayConfig(replay), seed: roundSeed(replay.seed, round) }
  const battle = new Battle(
    order.map((k) => bots[k] as (typeof bots)[number]),
    config,
  )
  battle.run()
  // The engine tags a byte with its fighting index + 1; the image colors by entrant.
  const tags = battle.core.owner
  const owners = new Uint8Array(CORE_SIZE)
  for (let a = 0; a < CORE_SIZE; a++) {
    const tag = tags[a] as number
    owners[a] = tag === 0 ? 0 : (order[tag - 1] as number) + 1
  }
  return owners
}

/** The card of `replay`, whose core ended as `owners` (`finalOwners`); `host` signs it. */
export function replayCard(replay: Replay, owners: Uint8Array, host: string): string {
  const { points } = replay.result
  const n = replay.bots.length
  const listed = replay.bots.slice(0, LISTED)
  const rounds = `${replay.rounds} ${replay.rounds === 1 ? 'round' : 'rounds'}`
  const rows = listed.map((bot, i) => {
    const y = LIST_Y + i * LIST_STEP
    return [
      `<rect x="${TEXT_X}" y="${y - 15}" width="16" height="16" fill="${hue(i)}"/>`,
      `<text x="${TEXT_X + 28}" y="${y}" fill="${SENTINEL.text}">${text(clip(bot.name, 28))}</text>`,
      `<text x="${TEXT_RIGHT}" y="${y}" fill="${SENTINEL.muted}" text-anchor="end">${points[i]} pts</text>`,
    ].join('')
  })
  if (n > LISTED) {
    rows.push(
      `<text x="${TEXT_X}" y="${LIST_Y + LISTED * LIST_STEP}" fill="${SENTINEL.muted}">+ ${n - LISTED} more</text>`,
    )
  }
  return card(`ASM BOTS: ${winnerLine(replay)}`, [
    `<rect x="${MAP_X - 1}" y="${MAP_Y - 1}" width="${SIDE * SCALE + 2}" height="${SIDE * SCALE + 2}" fill="${SENTINEL.arena}" stroke="${SENTINEL.borderStrong}" stroke-width="2"/>`,
    `<g transform="translate(${MAP_X} ${MAP_Y}) scale(${SCALE})" shape-rendering="crispEdges">`,
    ...ownerRuns(owners),
    '</g>',
    brand(TEXT_X, 112, 'replay'),
    `<text x="${TEXT_X}" y="202" fill="${SENTINEL.bright}" font-size="48" font-weight="700">${text(clip(winnerLine(replay), 18))}</text>`,
    `<text x="${TEXT_X}" y="250" fill="${SENTINEL.muted}" font-size="22">${n} bots · ${rounds} · seed ${replay.seed}</text>`,
    `<g font-size="22">${rows.join('')}</g>`,
    `<text x="${TEXT_RIGHT}" y="${MAP_Y + SIDE * SCALE}" fill="${SENTINEL.dim}" font-size="20" text-anchor="end">${text(host)}</text>`,
  ])
}

/** Who won: the bot with the most match points, the bots that share them, or no one. */
export function winnerLine(replay: Replay): string {
  const { points } = replay.result
  const best = Math.max(...points)
  if (best === 0) return 'no winner'
  const top = replay.bots.filter((_, i) => points[i] === best).map((bot) => bot.name)
  if (top.length === 1) return `${top[0]} wins`
  return top.length === replay.bots.length ? 'a draw' : `${top.join(', ')} tie`
}

/** One `<g>` per owner, holding a `<rect>` for each run of its bytes in a row. */
function ownerRuns(owners: Uint8Array): string[] {
  const runs = new Map<number, string[]>()
  for (let y = 0; y < SIDE; y++) {
    const row = y * SIDE
    let x = 0
    while (x < SIDE) {
      const owner = owners[row + x] as number
      let end = x + 1
      while (end < SIDE && owners[row + end] === owner) end++
      if (owner !== 0) {
        const list = runs.get(owner) ?? []
        if (list.length === 0) runs.set(owner, list)
        list.push(`<rect x="${x}" y="${y}" width="${end - x}" height="1"/>`)
      }
      x = end
    }
  }
  return [...runs.entries()]
    .sort(([a], [b]) => a - b)
    .map(([owner, rects]) => `<g fill="${hue(owner - 1)}">${rects.join('')}</g>`)
}
