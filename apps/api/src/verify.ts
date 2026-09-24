/**
 * Uploaded replays, checked (ARCHITECTURE §7): the server runs the match again from the replay's
 * inputs and keeps the replay only when its result is the one the server got. The engine is
 * deterministic, so a true replay always passes.
 */
import { assemble } from '@asmbots/asm'
import { CORE_SIZE } from '@asmbots/engine'
import {
  buildReplay,
  bytesProblem,
  canonicalJson,
  MAX_REPLAY_BOTS,
  MAX_REPLAY_ROUNDS,
  MAX_VERIFIED_CYCLES,
  type Replay,
  type ReplayResult,
  replayBots,
  replayConfig,
  toBase64,
} from '@asmbots/protocol'
import { runMatch } from '@asmbots/tourney'
import { HTTPException } from 'hono/http-exception'

const unprocessable = (message: string) => new HTTPException(422, { message })
const tooMuch = (message: string) => new HTTPException(413, { message })

/**
 * Refuses with a 413 an upload that asks more of one request than the server runs: more than
 * 16 bots, 10 rounds, or 200,000 cycles a round. It reads the raw value, before the replay's
 * schema does, so an oversized replay is a 413 and not a 400.
 */
export function checkWork(value: unknown): void {
  if (typeof value !== 'object' || value === null) return
  const { bots, rounds, config } = value as { bots?: unknown; rounds?: unknown; config?: unknown }
  if (Array.isArray(bots) && bots.length > MAX_REPLAY_BOTS) {
    throw tooMuch(`the server checks ${MAX_REPLAY_BOTS} bots at most, not ${bots.length}`)
  }
  if (typeof rounds === 'number' && rounds > MAX_REPLAY_ROUNDS) {
    throw tooMuch(`the server checks ${MAX_REPLAY_ROUNDS} rounds at most, not ${rounds}`)
  }
  const cycles = typeof config === 'object' && config !== null && 'maxCycles' in config
  const maxCycles = cycles ? (config as { maxCycles: unknown }).maxCycles : undefined
  if (typeof maxCycles === 'number' && maxCycles > MAX_VERIFIED_CYCLES) {
    const most = MAX_VERIFIED_CYCLES.toLocaleString('en-US')
    throw tooMuch(`the server checks ${most} cycles a round at most, not ${maxCycles}`)
  }
}

/** The first bot whose source does not assemble to its bytes, as a message; null when none. */
function sourceProblem(replay: Replay): string | null {
  for (const bot of replay.bots) {
    if (bot.source === undefined) continue
    // The size limit is the engine's, which the replay's config already checks the bytes against.
    const out = assemble(bot.source, { maxBytes: CORE_SIZE })
    if (out.diagnostics.some((d) => d.severity === 'error') || toBase64(out.bytes) !== bot.bytes) {
      return `${bot.name}'s source does not assemble to its bytes`
    }
  }
  return null
}

/**
 * Throws a 422 when `got` is not `expected`: the recorded result against the one the server
 * got, or has stored, for the same inputs.
 */
export function checkResult(expected: ReplayResult, got: ReplayResult): void {
  if (got.resultHash !== expected.resultHash) {
    throw unprocessable('the result hash is not the one the server got from the match')
  }
  if (canonicalJson(got) !== canonicalJson(expected)) {
    throw unprocessable('the result is not the one the server got from the match')
  }
}

/**
 * Checks `replay` whole: each bot's bytes against its SHA-256 and its source, if it has one, then
 * the result against a new run of the match. Throws a 422 at the first thing that is not so.
 */
export async function verifyReplay(replay: Replay): Promise<void> {
  const problem = (await bytesProblem(replay)) ?? sourceProblem(replay)
  if (problem !== null) throw unprocessable(problem)
  const bots = replayBots(replay)
  const config = replayConfig(replay)
  let match: ReturnType<typeof runMatch>
  try {
    match = runMatch(bots, config, replay.rounds)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw unprocessable(`the server could not run the match: ${reason}`)
  }
  const rerun = await buildReplay({ bots, config, rounds: replay.rounds, match })
  checkResult(rerun.result, replay.result)
}
