import { describe, expect, it } from 'bun:test'
import type { DeathReason, Snapshot } from '../src/index'
import { Battle, eventHash, HashSink, NullSink, restore, snapshot } from '../src/index'
import { BOTS, CONFIG } from './determinism.fixture'

/** Every event as a line of text. */
class Lines extends NullSink {
  readonly lines: string[] = []

  override exec(cycle: number, bot: number, proc: number, addr: number, len: number): void {
    this.lines.push(`${cycle} exec ${bot}.${proc} ${addr} ${len}`)
  }
  override write(cycle: number, bot: number, addr: number, len: number): void {
    this.lines.push(`${cycle} write ${bot} ${addr} ${len}`)
  }
  override spawn(cycle: number, bot: number, proc: number, addr: number): void {
    this.lines.push(`${cycle} spawn ${bot}.${proc} ${addr}`)
  }
  override death(cycle: number, bot: number, proc: number, addr: number, reason: DeathReason) {
    this.lines.push(`${cycle} death ${bot}.${proc} ${addr} ${reason}`)
  }
  override botDead(cycle: number, bot: number): void {
    this.lines.push(`${cycle} botDead ${bot}`)
  }
  override cycleEnd(cycle: number): void {
    this.lines.push(`${cycle} end`)
  }
}

/** The fixture battle after `cycles` cycles. */
function after(cycles: number): Battle {
  const battle = new Battle(BOTS, CONFIG)
  battle.run(cycles)
  return battle
}

describe('snapshot', () => {
  it('copies the core, the owner map, the queues, the stats, the cycle, and the PRNG', () => {
    const battle = after(500)
    const s = snapshot(battle)
    expect(s.cycle).toBe(500)
    expect(s.core).toEqual(battle.core.bytes)
    expect(s.owner).toEqual(battle.core.owner)
    expect(s.prngState).toEqual(battle.prng.serialize())
    expect(s.bots.map((b) => [b.queue, b.head, b.size, b.stats])).toEqual(
      battle.bots.map((b) => [b.queue.data, b.queue.head, b.queue.size, b.stats]),
    )
    // Copies, never views.
    const live = [battle.core.bytes, battle.core.owner, ...battle.bots.map((b) => b.queue.data)]
    for (const a of [s.core, s.owner, ...s.bots.map((b) => b.queue)]) {
      expect(live.some((x) => x.buffer === a.buffer)).toBe(false)
    }
    s.bots.forEach((b, i) => {
      expect(b.stats).not.toBe(battle.bots[i]?.stats)
    })
  })

  it('stays as it was while the battle runs on', () => {
    const battle = after(500)
    const s = snapshot(battle)
    const copy = structuredClone(s)
    battle.run(500)
    expect(s).toEqual(copy)
  })

  it('survives structuredClone whole, and the clone restores', () => {
    const battle = after(500)
    const clone = structuredClone(snapshot(battle))
    expect(clone).toEqual(snapshot(battle))
    expect(clone.core).toBeInstanceOf(Uint8Array)
    expect(clone.owner).toBeInstanceOf(Uint8Array)
    for (const b of clone.bots) expect(b.queue).toBeInstanceOf(Uint16Array)
    const restored = restore(clone, BOTS, CONFIG)
    restored.run(500)
    battle.run(500)
    expect(snapshot(restored)).toEqual(snapshot(battle))
  })

  it('takes 128 KB and 22 bytes per process slot per bot', () => {
    const bytes = (s: Snapshot) =>
      s.core.byteLength + s.owner.byteLength + s.bots.reduce((n, b) => n + b.queue.byteLength, 0)
    expect(bytes(snapshot(after(0)))).toBe(131_072 + 4 * 8 * 22)
    // Two bots at the default 64 processes: about 131 KB.
    expect(bytes(snapshot(new Battle(BOTS.slice(0, 2))))).toBe(133_888)
  })
})

describe('restore', () => {
  it('restored at each of cycles 0 to 1,000, runs the next cycle as the original does', () => {
    const original = new Battle(BOTS, CONFIG)
    let s = snapshot(original)
    for (let c = 0; c <= 1000; c++) {
      const a = new HashSink()
      const b = new HashSink()
      original.events = a
      const restored = restore(s, BOTS, CONFIG, b)
      expect([restored.cycle, restored.alive, restored.over]).toEqual([c, original.alive, false])
      original.step()
      restored.step()
      expect([c, eventHash(b)]).toEqual([c, eventHash(a)])
      s = snapshot(original)
      expect(snapshot(restored)).toEqual(s)
    }
  })

  it('restores one snapshot any number of times', () => {
    const s = snapshot(after(500))
    const copy = structuredClone(s)
    const ends = [0, 1, 2].map(() => {
      const battle = restore(s, BOTS, CONFIG)
      battle.run(500)
      return snapshot(battle)
    })
    expect(ends[1]).toEqual(ends[0] as Snapshot)
    expect(ends[2]).toEqual(ends[0] as Snapshot)
    expect(s).toEqual(copy)
  })

  it('emits no events and counts no writes, then goes on in turn order', () => {
    const s = snapshot(after(501))
    const sink = new Lines()
    const battle = restore(s, BOTS, CONFIG, sink)
    expect(sink.lines).toEqual([])
    expect(battle.events).toBe(sink)
    expect(battle.bots.map((b) => b.stats)).toEqual(s.bots.map((b) => b.stats))
    battle.step()
    // Cycle 501 starts with bot 501 mod 4 = 1; bot 2 is dead.
    const execs = sink.lines.filter((l) => l.includes('exec')).map((l) => l.split(' ')[2]?.[0])
    expect(execs).toEqual(['1', '3', '0'])
  })

  it('counts the living bots from the queues', () => {
    // The caller dies in cycle 193 and the divider in cycle 901.
    for (const [cycles, alive] of [
      [0, 4],
      [193, 4],
      [194, 3],
      [901, 3],
      [902, 2],
    ] as const) {
      const battle = restore(snapshot(after(cycles)), BOTS, CONFIG)
      expect([cycles, battle.alive, battle.bots.map((b) => b.alive)]).toEqual([
        cycles,
        alive,
        after(cycles).bots.map((b) => b.alive),
      ])
    }
  })

  it('restores a finished battle finished', () => {
    const battle = new Battle(BOTS, CONFIG)
    const result = battle.run()
    const restored = restore(snapshot(battle), BOTS, CONFIG)
    expect([restored.over, restored.alive, restored.cycle]).toEqual([true, 1, 14_682])
    expect(restored.run()).toEqual(result)
    restored.step()
    expect(restored.cycle).toBe(14_682)
  })

  it('takes maxCycles from the config, so a battle cut short can run on', () => {
    const short = new Battle(BOTS, { ...CONFIG, maxCycles: 600 })
    short.run()
    const s = snapshot(short)
    expect([short.over, s.cycle]).toEqual([true, 600])
    const longer = restore(s, BOTS, { ...CONFIG, maxCycles: 1000 })
    expect(longer.over).toBe(false)
    const straight = new Battle(BOTS, { ...CONFIG, maxCycles: 1000 })
    expect(longer.run()).toEqual(straight.run())
    expect(snapshot(longer)).toEqual(snapshot(straight))
    const shorter = restore(s, BOTS, { ...CONFIG, maxCycles: 400 })
    expect([shorter.over, shorter.cycle]).toEqual([true, 600])
  })

  it('rejects a snapshot that does not fit the bots or the config', () => {
    const s = snapshot(after(500))
    const bot0 = s.bots[0] as Snapshot['bots'][number]
    const withBot0 = (b: Partial<typeof bot0>): Snapshot => ({
      ...s,
      bots: [{ ...bot0, ...b }, ...s.bots.slice(1)],
    })
    const misfits: [string, () => unknown][] = [
      ['another seed', () => restore(s, BOTS, { ...CONFIG, seed: 8 })],
      ['fewer bots', () => restore(s, BOTS.slice(0, 3), CONFIG)],
      ['a bot short', () => restore({ ...s, bots: s.bots.slice(0, 3) }, BOTS, CONFIG)],
      ['more processes', () => restore(s, BOTS, { ...CONFIG, maxProcesses: 16 })],
      [
        'a PRNG state with a fifth word',
        () => restore({ ...s, prngState: [...s.prngState, 0] as never }, BOTS, CONFIG),
      ],
      ['no PRNG state', () => restore({ ...s, prngState: undefined as never }, BOTS, CONFIG)],
      ['a short core', () => restore({ ...s, core: s.core.subarray(1) }, BOTS, CONFIG)],
      ['a long owner map', () => restore({ ...s, owner: new Uint8Array(65_537) }, BOTS, CONFIG)],
      ['a short queue', () => restore(withBot0({ queue: bot0.queue.subarray(1) }), BOTS, CONFIG)],
      ['a head past the ring', () => restore(withBot0({ head: 8 }), BOTS, CONFIG)],
      ['a fractional head', () => restore(withBot0({ head: 0.5 }), BOTS, CONFIG)],
      ['a size past the cap', () => restore(withBot0({ size: 9 }), BOTS, CONFIG)],
      ['a negative size', () => restore(withBot0({ size: -1 }), BOTS, CONFIG)],
      ['a negative cycle', () => restore({ ...s, cycle: -1 }, BOTS, CONFIG)],
      ['a fractional cycle', () => restore({ ...s, cycle: 1.5 }, BOTS, CONFIG)],
      ['a cycle past 2^32 - 1', () => restore({ ...s, cycle: 2 ** 32 }, BOTS, CONFIG)],
    ]
    for (const [name, f] of misfits) {
      let error = 'no error'
      try {
        f()
      } catch (e) {
        error = String(e)
      }
      expect([name, error.slice(0, 20)]).toEqual([name, 'RangeError: restore:'])
    }
    // The fit itself restores.
    expect(restore(withBot0({}), BOTS, CONFIG).cycle).toBe(500)
  })
})
