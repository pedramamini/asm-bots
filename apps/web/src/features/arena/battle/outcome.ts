/**
 * How a round or a match came out, in the victory overlay's words (PRODUCT_SPEC §2): the overlay,
 * the embed's end line, and the victory cue's rule (one winner) all read it.
 */
import type { Result } from '@asmbots/engine'
import type { MatchResult, MeleeStanding } from '@asmbots/tourney'
import { botResults } from '../worker/protocol'

const count = (n: number) => n.toLocaleString('en-US')

/** How a round or a match came out. */
export interface Outcome {
  /** A sole winner, a draw between the best, or nobody left. */
  readonly kind: 'winner' | 'draw' | 'none'
  /** The winners: one, the bots that share first place, or none. */
  readonly winners: readonly number[]
  /** `WINNER · Dwarf`, `DRAW · Dwarf, Imp`, `NO WINNER`. */
  readonly headline: string
  /** `last bot standing · cycle 41,203`. */
  readonly detail: string
}

function joinNames(bots: readonly number[], names: readonly string[]): string {
  return bots.map((bot) => names[bot] ?? `bot ${bot + 1}`).join(', ')
}

/** A round's outcome: the bots standing at its end (ISA §5.5). */
export function roundOutcome(
  result: Result,
  order: readonly number[],
  names: readonly string[],
): Outcome {
  const standing = botResults(result, order).flatMap((bot, index) => (bot.alive ? [index] : []))
  const at = `cycle ${count(result.cycles)}`
  if (standing.length === 1) {
    return {
      kind: 'winner',
      winners: standing,
      headline: `winner · ${joinNames(standing, names)}`,
      detail: `last bot standing · ${at}`,
    }
  }
  if (standing.length === 0) {
    return { kind: 'none', winners: [], headline: 'no winner', detail: `no bot standing · ${at}` }
  }
  return {
    kind: 'draw',
    winners: standing,
    headline: `draw · ${joinNames(standing, names)}`,
    detail: `time ran out · ${standing.length} bots standing · ${at}`,
  }
}

/** A match's outcome: the most pMARS points over its rounds (ISA §5.5). */
export function matchOutcome(match: MatchResult, standings: readonly MeleeStanding[]): Outcome {
  const top = Math.max(...match.points)
  const winners = standings.filter((s) => s.points === top).map((s) => s.entrant)
  const rounds = `${match.rounds.length} ${match.rounds.length === 1 ? 'round' : 'rounds'}`
  if (winners.length === 1) {
    const wins = standings.find((s) => s.entrant === winners[0])?.wins ?? 0
    return {
      kind: 'winner',
      winners,
      headline: `winner · ${joinNames(winners, match.names)}`,
      detail: `${count(top)} points · won ${wins} of ${rounds}`,
    }
  }
  return {
    kind: top > 0 ? 'draw' : 'none',
    winners: top > 0 ? winners : [],
    headline: top > 0 ? `draw · ${joinNames(winners, match.names)}` : 'no winner',
    detail: top > 0 ? `${count(top)} points each · ${rounds}` : `no points · ${rounds}`,
  }
}
