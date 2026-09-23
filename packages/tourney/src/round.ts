/**
 * Rounds (ISA §5.5): a round is one battle. `runRound` runs it with the engine and adds what a
 * tournament keeps: the result hash, the cycles run, and each bot's points.
 */
import {
  type BattleConfigInput,
  DEFAULT_CONFIG,
  type LoadedBot,
  type Result,
  resultHash,
  simulate,
} from '@asmbots/engine'

/** A round's outcome. The bots are in the order they fought in. */
export interface RoundResult {
  /** The placement seed of the round. */
  readonly seed: number
  /** The engine's result. */
  readonly result: Result
  /** `resultHash(result)`: the FNV-1a 64 hash of the result's canonical JSON (ISA §5.6). */
  readonly resultHash: string
  /** The cycles the battle ran. */
  readonly durationCycles: number
  /** The pMARS points of each bot (ISA §5.5), in fighting order. */
  readonly points: readonly number[]
}

/** Runs one battle of `bots` with `config` (ISA §5.5). Throws what `simulate` throws. */
export function runRound(bots: readonly LoadedBot[], config: BattleConfigInput = {}): RoundResult {
  const result = simulate(bots, config)
  return {
    seed: config.seed ?? DEFAULT_CONFIG.seed,
    result,
    resultHash: resultHash(result),
    durationCycles: result.cycles,
    points: result.bots.map((b) => b.points),
  }
}
