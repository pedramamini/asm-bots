/**
 * The fight helper of the roster tests: plays roster bots against each other headlessly, round by
 * round as a hill match plays them (ISA §5.5), and keeps the score from one bot's side.
 */
import { type BattleConfigInput, type LoadedBot, simulate } from '@asmbots/engine'
import { loadRoster } from '../src/roster'

/** The hill rules: 80,000 cycles (ISA §5.5), everything else at its default. */
export const HILL_RULES: BattleConfigInput = { maxCycles: 80_000 }

/** Rounds won, tied, and lost, from one bot's side. */
export interface FightRecord {
  wins: number
  ties: number
  losses: number
}

/** The roster bot `slug`, ready for a battle. */
export function fighter(slug: string): LoadedBot {
  const bot = loadRoster().get(slug)
  if (bot === undefined) throw new Error(`loadRoster has no bot '${slug}'`)
  const { name, author, strategy, version, bytes } = bot.assembled
  return { name, bytes, meta: { author, strategy, version } }
}

/** The seeds `first` to `last`, both included. */
export const seeds = (first: number, last: number): number[] =>
  Array.from({ length: last - first + 1 }, (_, i) => first + i)

/**
 * The record of `slug` against `rival`: one round for each seed, in order. As in a match, the
 * order alternates: `slug` is bot 0 in the first round, bot 1 in the second, and so on. A round
 * is a win when `slug` is the only bot alive at the end, a tie when both are, and a loss when
 * `slug` is dead.
 */
export function record(
  slug: string,
  rival: string,
  roundSeeds: readonly number[],
  config: BattleConfigInput = HILL_RULES,
): FightRecord {
  const bots = [fighter(slug), fighter(rival)]
  const out: FightRecord = { wins: 0, ties: 0, losses: 0 }
  roundSeeds.forEach((seed, round) => {
    const us = round % 2
    const { survivors } = simulate(us === 0 ? bots : [...bots].reverse(), { ...config, seed })
    if (!survivors.includes(us)) out.losses++
    else if (survivors.length === 1) out.wins++
    else out.ties++
  })
  return out
}

/** A record as a header line shows it: `14 W / 6 T / 0 L`. */
export const formatRecord = ({ wins, ties, losses }: FightRecord): string =>
  `${wins} W / ${ties} T / ${losses} L`
