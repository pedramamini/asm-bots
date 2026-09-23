/**
 * The engine's speed (ARCHITECTURE §3): the bench battle of `workload.ts`, 2,000,000 cycles with
 * a `NullSink`, once to warm up and then five timed runs. Prints instructions and cycles per
 * second for each run, then the median. The target is 25 M instructions/s in Bun on an M-series
 * Mac; `test/ips.test.ts` holds CI to 15 M. Run with `bun run --filter @asmbots/engine bench`.
 */
import { measure } from './workload'

const RUNS = 5

/** Millions per second. */
function rate(n: number, seconds: number): string {
  return `${(n / seconds / 1e6).toFixed(1)} M`
}

measure() // The warm-up: the JIT compiles the hot loop.
const runs = Array.from({ length: RUNS }, () => measure())
for (const m of runs) {
  const each = `${m.instructions.toLocaleString('en-US')} instructions`
  console.log(
    `${rate(m.instructions, m.seconds)} instr/s, ${rate(m.cycles, m.seconds)} cycles/s ` +
      `(${each} in ${m.seconds.toFixed(3)} s)`,
  )
}
const median = runs.map((m) => m.instructions / m.seconds).sort((a, b) => a - b)[RUNS >> 1]
console.log(`median of ${RUNS}: ${rate(median as number, 1)} instr/s`)
