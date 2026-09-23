/**
 * The fight helper of the roster tests: plays roster bots against each other headlessly, round by
 * round as a hill match plays them (ISA §5.5), and keeps the score from one bot's side. It also
 * runs a bot alone and logs a battle's spawns and deaths, for the tests that check what one bot
 * does.
 */
import {
  Battle,
  type BattleConfigInput,
  type Bot,
  type Core,
  type DeathReason,
  NullSink,
  simulate,
} from '@asmbots/engine'
import { HILL_RULES } from '../src/goldens'
import { fighter, loadRoster } from '../src/roster'

// Re-exported, so the tests get every fight helper from this file.
export { fighter, HILL_RULES }

/** Rounds won, tied, and lost, from one bot's side. */
export interface FightRecord {
  wins: number
  ties: number
  losses: number
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

/** A label or `equ` value of the roster bot `slug`. */
export function symbolOf(slug: string, name: string): number {
  const value = loadRoster().get(slug)?.assembled.symbols.get(name)
  if (value === undefined) throw new Error(`${slug} has no symbol '${name}'`)
  return value
}

/** The roster bot `slug` alone in the core, placed by `seed`, after `cycles` cycles. */
export function alone(slug: string, cycles: number, seed = 1): { battle: Battle; bot: Bot } {
  const battle = new Battle([fighter(slug)], { seed })
  battle.run(cycles)
  return { battle, bot: battle.bots[0] as Bot }
}

/** The `size` bytes from `from` in the core of `battle`. */
export const bytesAt = (battle: Battle, from: number, size: number): number[] =>
  Array.from({ length: size }, (_, i) => battle.core.read8(from + i))

/**
 * Keeps the spawns and the deaths of a battle: the cycle, the bot, and where the child starts or
 * the process dies, with why. Once a test sets `core`, a spawn also keeps the 2 bytes at the
 * child's start as the SPL leaves them.
 */
export class EventLog extends NullSink {
  core: Core | undefined
  readonly spawns: { cycle: number; bot: number; addr: number; bytes: number[] }[] = []
  readonly deaths: { cycle: number; bot: number; addr: number; reason: DeathReason }[] = []

  override spawn(cycle: number, bot: number, _proc: number, addr: number): void {
    const core = this.core
    const bytes = core === undefined ? [] : [core.read8(addr), core.read8(addr + 1)]
    this.spawns.push({ cycle, bot, addr, bytes })
  }

  override death(
    cycle: number,
    bot: number,
    _proc: number,
    addr: number,
    reason: DeathReason,
  ): void {
    this.deaths.push({ cycle, bot, addr, reason })
  }
}
