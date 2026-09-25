/**
 * `test vs ▾` (PRODUCT_SPEC §3): the bot in the editor against a roster bot, ten rounds of the
 * arena's duel headless in the arena Worker, told as wins, ties, and losses; and `watch`, the
 * arena set up with the same two bots and the same seed, which fights the same match.
 */
import type { Assembled } from '@asmbots/asm'
import { fnv1a64 } from '@asmbots/engine'
import type { MatchResult } from '@asmbots/tourney'
import type { ArenaConfig } from '../../store/settings'
import type { AssembledBot, CatalogBot } from '../arena/setup/bots'
import { DEFAULT_ARENA_CONFIG } from '../arena/setup/config'
import type { ArenaSetupSpec, SharedBot } from '../arena/setup/url'
import type { ArenaBot } from '../arena/worker/protocol'

/** Rounds in a test (PRODUCT_SPEC §3). */
export const TEST_ROUNDS = 10

/** A test's config: the arena's duel, ten rounds. */
export const TEST_CONFIG: ArenaConfig = Object.freeze({
  ...DEFAULT_ARENA_CONFIG,
  rounds: TEST_ROUNDS,
  preset: null,
})

/** A bot's rounds of a match, as wins, ties, and losses. */
export interface Tally {
  readonly wins: number
  readonly ties: number
  readonly losses: number
}

/**
 * Entrant `me`'s record in `match`: a round is a win when it scores more than every other
 * entrant (it alone survived), a tie when it shares the top score, and a loss when it scores less.
 */
export function tally(match: MatchResult, me = 0): Tally {
  let wins = 0
  let ties = 0
  let losses = 0
  for (const round of match.rounds) {
    const mine = round.points[me] ?? 0
    const best = Math.max(0, ...round.points.filter((_, k) => k !== me))
    if (mine > best) wins++
    else if (mine === best && mine > 0) ties++
    else losses++
  }
  return { wins, ties, losses }
}

/** The bots a test loads: the editor's first, then the opponent, named as the arena names them. */
export function testBots(mine: Assembled, opponent: CatalogBot): ArenaBot[] {
  const name = mine.name === '' ? 'my bot' : mine.name
  const theirs = opponent.name === name ? `${opponent.name} 2` : opponent.name
  const bot = (bot: AssembledBot, battleName: string): ArenaBot => ({
    name: battleName,
    bytes: bot.bytes,
    meta: { author: bot.author, strategy: bot.strategy, version: bot.version },
  })
  return [bot(mine, name), bot(opponent.assembled, theirs)]
}

/**
 * The id the arena knows the tested source by. A saved bot whose text is what was tested keeps
 * its own; any other text gets one from its hash, so the arena never swaps in the saved text.
 */
export function testedId(source: string, saved: { id: string; source: string } | null): string {
  if (saved !== null && saved.source === source) return saved.id
  return `draft-${fnv1a64(new TextEncoder().encode(source)).slice(0, 12)}`
}

/** The arena setup of a test: the tested bot and the opponent, at the test's seed. */
export function watchSetup(
  tested: SharedBot,
  opponentSlug: string,
  seed: number,
): { spec: ArenaSetupSpec; shared: SharedBot[] } {
  return {
    spec: {
      bots: [
        { kind: 'local', id: tested.id },
        { kind: 'roster', slug: opponentSlug },
      ],
      config: { ...TEST_CONFIG, seed },
    },
    shared: [tested],
  }
}
