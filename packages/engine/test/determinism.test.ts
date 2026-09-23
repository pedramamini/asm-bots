import { describe, expect, it } from 'bun:test'
import { decode, format } from '@asmbots/codec'
import type { DeathReason } from '../src/index'
import {
  Battle,
  CX,
  eventHash,
  HashSink,
  IP,
  NullSink,
  type ProcRow,
  restore,
  resultHash,
  snapshot,
} from '../src/index'
import { BOTS, CONFIG, hashedRun, PROGRAMS } from './determinism.fixture'

/** Counts events by kind, and deaths by reason, on each side of `split`. */
class Census extends NullSink {
  readonly before = new Map<string, number>()
  readonly after = new Map<string, number>()
  private readonly split: number

  constructor(split: number) {
    super()
    this.split = split
  }

  private count(cycle: number, kind: string): void {
    const m = cycle < this.split ? this.before : this.after
    m.set(kind, (m.get(kind) ?? 0) + 1)
  }

  override exec(cycle: number): void {
    this.count(cycle, 'exec')
  }
  override write(cycle: number): void {
    this.count(cycle, 'write')
  }
  override spawn(cycle: number): void {
    this.count(cycle, 'spawn')
  }
  override death(cycle: number, _b: number, _p: number, _a: number, reason: DeathReason): void {
    this.count(cycle, `death ${reason}`)
  }
  override botDead(cycle: number): void {
    this.count(cycle, 'botDead')
  }
  override cycleEnd(cycle: number): void {
    this.count(cycle, 'cycleEnd')
  }
}

describe('the determinism battle', () => {
  it('disassembles to its source', () => {
    for (const program of PROGRAMS) {
      for (const [text, bytes] of program) {
        const d = decode((a) => bytes[a] ?? 0, 0)
        expect([format(d), d.length]).toEqual([text, bytes.length])
      }
    }
  })

  it('has every kind of event on each side of cycle 500', () => {
    const census = new Census(500)
    new Battle(BOTS, CONFIG, census).run(1000)
    const kinds = ['botDead', 'cycleEnd', 'death dat', 'exec', 'spawn', 'write']
    expect([...census.before.keys()].sort()).toEqual([...kinds, 'death hlt'].sort())
    expect([...census.after.keys()].sort()).toEqual([...kinds, 'death div'].sort())
  })

  it('holds a REP half done, a queue at its cap, and a dead bot at cycle 500', () => {
    const battle = new Battle(BOTS, CONFIG)
    battle.run(500)
    const [painter, spawner] = battle.bots
    const row = painter?.queue.rows[painter.queue.front()] as ProcRow
    expect([battle.core.read8(row[IP] as number), row[CX]]).toEqual([0xf3, 25])
    expect(spawner?.queue.size).toBe(CONFIG.maxProcesses)
    expect(battle.bots.map((b) => b.stats.deathReason)).toEqual([null, null, 'hlt', null])
  })

  it('ends at cycle 14,682 with the spawner alone, and its hashes are pinned', () => {
    const run = hashedRun()
    expect([run.result.cycles, run.result.survivors]).toEqual([14_682, [1]])
    expect(run.result.bots.map((b) => [b.deathCycle, b.deathReason])).toEqual([
      [14_681, 'dat'],
      [null, null],
      [193, 'hlt'],
      [901, 'div'],
    ])
    // Goldens: a change to either means the engine's behavior changed. Hill standings change with
    // it, so update them only for a deliberate change.
    expect([run.eventHash, run.resultHash]).toEqual(['feb72a563824385b', '2e76b24fd3dd413e'])
  })
})

describe('determinism (ISA §5.6)', () => {
  it('runs the same battle twice to the same event hash, result hash, and state', () => {
    const first = hashedRun()
    // Another battle in between shares nothing with them.
    new Battle([...BOTS].reverse(), { ...CONFIG, seed: 8 }).run()
    const second = hashedRun()
    expect(second.eventHash).toBe(first.eventHash)
    expect(second.resultHash).toBe(first.resultHash)
    expect(second.snapshot).toEqual(first.snapshot)
  })

  it('hashes another seed or another bot order differently', () => {
    const hashes = [
      hashedRun(),
      hashedRun(Number.POSITIVE_INFINITY, BOTS, { ...CONFIG, seed: 8 }),
      hashedRun(Number.POSITIVE_INFINITY, [...BOTS].reverse(), CONFIG),
    ]
    expect(new Set(hashes.map((h) => h.eventHash)).size).toBe(3)
    expect(new Set(hashes.map((h) => h.resultHash)).size).toBe(3)
  })

  it('restores a snapshot from cycle 500 that runs to 1,000 and on in step with the original', () => {
    const original = new Battle(BOTS, CONFIG)
    original.run(500)
    const s = snapshot(original)
    const a = new HashSink()
    original.events = a
    original.run(500)
    const b = new HashSink()
    const restored = restore(s, BOTS, CONFIG, b)
    for (let k = 0; k < 500; k++) restored.step()
    expect([original.cycle, restored.cycle]).toEqual([1000, 1000])
    expect(eventHash(b)).toBe(eventHash(a))
    expect(snapshot(restored)).toEqual(snapshot(original))
    expect(resultHash(restored.result())).toBe(resultHash(original.result()))
    // And on to the end.
    expect(restored.run()).toEqual(original.run())
    expect(eventHash(b)).toBe(eventHash(a))
  })
})
