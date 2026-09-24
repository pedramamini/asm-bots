/**
 * A replay's Open Graph image, as SVG (PRODUCT_SPEC §10): the core's owner map at the end of the
 * last round, one pixel a byte (the 64 KB core is 256 × 256), beside who won, in the sentinel
 * theme. Each row's runs of one owner are one `<rect>`, grouped by owner under its hue.
 */
import { Battle, CORE_SIZE } from '@asmbots/engine'
import { type Replay, replayBots, replayConfig } from '@asmbots/protocol'
import { escapeXml, roundOrder, roundSeed } from '@asmbots/tourney'
import { BOT_HUES } from '@asmbots/ui/themes'

/** The image: Open Graph's 1.91:1. */
const WIDTH = 1200
const HEIGHT = 630
/** The owner map's side, in bytes: 256 rows of 256. */
const SIDE = 256
/** Screen pixels a byte. */
const SCALE = 2
const MAP_X = 48
const MAP_Y = (HEIGHT - SIDE * SCALE) / 2
/** Where the text column starts. */
const TEXT_X = MAP_X + SIDE * SCALE + 48
const TEXT_RIGHT = WIDTH - 48
/** The most bots the list names; the rest are a count. */
const LISTED = 8

/** Sentinel's surface and text colors: `--bg`, `--border-strong`, `--text`, … in tokens.css. */
const SENTINEL = {
  bg: '#0A0F0A',
  border: '#2A4A2A',
  text: '#A0C0A0',
  muted: '#6A8C6A',
  bright: '#D0F0D0',
  accent: '#00FF88',
  arena: '#000000',
} as const
const HUES = BOT_HUES.sentinel
const FONT = `'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace`

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

/** The SVG of `replay`, whose core ended as `owners` (`finalOwners`). */
export function ogSvg(replay: Replay, owners: Uint8Array): string {
  const { points } = replay.result
  const n = replay.bots.length
  const listed = replay.bots.slice(0, LISTED)
  const rounds = `${replay.rounds} ${replay.rounds === 1 ? 'round' : 'rounds'}`
  const rows = listed.map((bot, i) => {
    const y = 330 + i * 34
    return [
      `<rect x="${TEXT_X}" y="${y - 15}" width="16" height="16" fill="${hue(i)}"/>`,
      `<text x="${TEXT_X + 28}" y="${y}" fill="${SENTINEL.text}">${text(clip(bot.name, 28))}</text>`,
      `<text x="${TEXT_RIGHT}" y="${y}" fill="${SENTINEL.muted}" text-anchor="end">${points[i]} pts</text>`,
    ].join('')
  })
  if (n > LISTED) {
    rows.push(
      `<text x="${TEXT_X}" y="${330 + LISTED * 34}" fill="${SENTINEL.muted}">+ ${n - LISTED} more</text>`,
    )
  }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" font-family="${FONT}">`,
    `<title>${text(`ASM Bots: ${winnerLine(replay)}`)}</title>`,
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="${SENTINEL.bg}"/>`,
    `<rect x="${MAP_X - 1}" y="${MAP_Y - 1}" width="${SIDE * SCALE + 2}" height="${SIDE * SCALE + 2}" fill="${SENTINEL.arena}" stroke="${SENTINEL.border}" stroke-width="2"/>`,
    `<g transform="translate(${MAP_X} ${MAP_Y}) scale(${SCALE})" shape-rendering="crispEdges">`,
    ...ownerRuns(owners),
    '</g>',
    `<text x="${TEXT_X}" y="120" fill="${SENTINEL.accent}" font-size="28" font-weight="700" letter-spacing="4">ASM BOTS</text>`,
    `<text x="${TEXT_X}" y="210" fill="${SENTINEL.bright}" font-size="48" font-weight="700">${text(clip(winnerLine(replay), 18))}</text>`,
    `<text x="${TEXT_X}" y="258" fill="${SENTINEL.muted}" font-size="22">${n} bots · ${rounds} · seed ${replay.seed}</text>`,
    `<g font-size="22">${rows.join('')}</g>`,
    '</svg>',
  ].join('\n')
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

/** Entrant `i`'s hue; 12 and up wrap. */
function hue(i: number): string {
  return HUES[i % HUES.length] as string
}

/** `name` cut to `most` characters, with an ellipsis when cut. */
function clip(name: string, most: number): string {
  const chars = [...name]
  return chars.length > most ? `${chars.slice(0, most - 1).join('')}…` : name
}

/** What XML 1.0 does not allow: C0 controls but tab, LF, CR; U+FFFE, U+FFFF; lone surrogates. */
const NOT_XML =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the control characters are the point.
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

/** `value` as XML character data: escaped, and what XML does not allow replaced with U+FFFD. */
function text(value: string): string {
  return escapeXml(value.replace(NOT_XML, '�'))
}
