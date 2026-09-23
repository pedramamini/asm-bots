import { describe, expect, it } from 'bun:test'
import { decode, format } from '@asmbots/codec'
import { BOTS, CONFIG, CYCLES, measure, PROGRAMS } from '../bench/workload'
import { Battle, NullSink } from '../src/index'

/** Each bot's spawns, process deaths, and writes. */
class Counts extends NullSink {
  readonly spawns: number[] = BOTS.map(() => 0)
  readonly deaths: number[] = BOTS.map(() => 0)
  readonly writes: number[] = BOTS.map(() => 0)

  override spawn(_cycle: number, bot: number): void {
    this.spawns[bot] = (this.spawns[bot] as number) + 1
  }
  override death(_cycle: number, bot: number): void {
    this.deaths[bot] = (this.deaths[bot] as number) + 1
  }
  override write(_cycle: number, bot: number): void {
    this.writes[bot] = (this.writes[bot] as number) + 1
  }
}

/** Bot indices in the bench battle. */
const PAINTER = 0
const REPLICATOR = 2

describe('the bench battle', () => {
  it('disassembles to its source', () => {
    for (const program of Object.values(PROGRAMS)) {
      for (const [text, bytes] of program) {
        const d = decode((a) => bytes[a] ?? 0, 0)
        expect([format(d), d.length]).toEqual([text, bytes.length])
      }
    }
  })

  it('runs 8 instructions a cycle for all its cycles, so no bot dies', () => {
    const m = measure()
    expect([m.cycles, m.instructions]).toEqual([CYCLES, 8 * CYCLES])
  })

  it('spawns, kills, and writes at a steady rate', () => {
    const battle = new Battle(BOTS, CONFIG)
    const replicator = battle.bots[REPLICATOR]?.queue
    battle.run(20_000)
    for (let window = 0; window < 3; window++) {
      const counts = new Counts()
      battle.events = counts
      let fewest = Number.POSITIVE_INFINITY
      let most = 0
      for (let k = 0; k < 20_000; k++) {
        battle.step()
        fewest = Math.min(fewest, replicator?.size ?? 0)
        most = Math.max(most, replicator?.size ?? 0)
      }
      // The replicator holds 11 or 12 processes, and one starts and one dies every 11 cycles.
      // No other bot spawns or loses a process.
      expect([fewest, most]).toEqual([11, 12])
      const perSpawn = counts.spawns.map((n, bot) =>
        bot === REPLICATOR ? Math.round(20_000 / n) : n,
      )
      expect(perSpawn).toEqual([0, 0, 11, 0, 0, 0, 0, 0])
      expect(counts.deaths).toEqual(counts.spawns)
      // The painter writes on 256 of every 260 turns, and each imp on every other turn.
      expect(Math.abs((counts.writes[PAINTER] as number) - (20_000 * 256) / 260)).toBeLessThan(1)
      expect(counts.writes.slice(1)).toEqual([0, 0, 0, 10_000, 10_000, 10_000, 10_000])
    }
  })
})

/** Times `runs` runs of the bench battle in a new Worker; returns instructions per second. */
async function inWorker(runs: number): Promise<number[]> {
  const worker = new Worker(new URL('./ips.worker.ts', import.meta.url))
  try {
    return await new Promise<number[]>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<number[]>) => resolve(e.data)
      worker.onerror = (e) => reject(new Error(`worker: ${e.message}`))
      worker.postMessage(runs)
    })
  } finally {
    worker.terminate()
  }
}

/** GitHub Actions sets CI=true. */
const CI = process.env.CI === 'true'

describe('speed', () => {
  // ARCHITECTURE §9: fail under 15 M instructions/s on the CI runner. The runs happen in a
  // Worker, whose JIT the other tests have not trained on their own code (in this process the
  // bench runs about 15% slower after them), and the best of three counts, so a noisy neighbor
  // on the runner does not fail the build.
  it.skipIf(!CI)(
    'runs at least 15 M instructions/s on the bench battle',
    async () => {
      const best = Math.max(...(await inWorker(3)))
      console.log(`bench battle: ${(best / 1e6).toFixed(1)} M instructions/s`)
      expect(best).toBeGreaterThanOrEqual(15e6)
    },
    60_000,
  )
})
