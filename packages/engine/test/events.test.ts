import { describe, expect, it } from 'bun:test'
import {
  BOT_DEAD_RECORD,
  DEATH_REASONS,
  DEATH_RECORD,
  EventRing,
  EXEC_RECORD,
  NullSink,
  RingSink,
  SPAWN_RECORD,
  WRITE_RECORD,
} from '../src/index'

/** Adds one-field records `from` to `to - 1`. */
function fill(ring: EventRing, from: number, to: number): void {
  for (let v = from; v < to; v++) ring.data[ring.add()] = v
}

describe('EventRing', () => {
  it('holds records oldest first and drains them into a new array', () => {
    const r = new EventRing(2, 4)
    for (let v = 0; v < 3; v++) {
      const o = r.add()
      r.data[o] = v
      r.data[o + 1] = 10 + v
    }
    expect([r.length, r.dropped]).toEqual([3, 0])
    const out = r.drain()
    expect(out).not.toBe(r.data)
    expect(Array.from(out)).toEqual([0, 10, 1, 11, 2, 12])
    expect([r.start, r.length, r.dropped]).toEqual([0, 0, 0])
    expect(Array.from(r.drain())).toEqual([])
  })

  it('fills to capacity without dropping', () => {
    const r = new EventRing(1, 4)
    fill(r, 0, 4)
    expect([r.length, r.dropped]).toEqual([4, 0])
    expect(Array.from(r.drain())).toEqual([0, 1, 2, 3])
  })

  it('overwrites the oldest record when full and counts it as dropped', () => {
    const r = new EventRing(1, 3)
    fill(r, 0, 7)
    expect([r.start, r.length, r.dropped]).toEqual([1, 3, 4])
    expect(Array.from(r.drain())).toEqual([4, 5, 6])
    expect([r.start, r.length, r.dropped]).toEqual([0, 0, 0])
  })

  it('keeps every record in order when drains keep up', () => {
    const r = new EventRing(1, 5)
    const got: number[] = []
    let v = 0
    for (const batch of [3, 5, 1, 4, 5, 2]) {
      fill(r, v, v + batch)
      v += batch
      got.push(...r.drain())
    }
    expect(got).toEqual(Array.from({ length: v }, (_, k) => k))
  })

  it('drains the newest records after many wraps', () => {
    const r = new EventRing(3, 7)
    for (let v = 0; v < 100; v++) {
      const o = r.add()
      r.data.set([v, v * 2, v * 3], o)
    }
    expect(r.dropped).toBe(93)
    expect(Array.from(r.drain())).toEqual(
      Array.from({ length: 7 }, (_, k) => [93 + k, (93 + k) * 2, (93 + k) * 3]).flat(),
    )
  })

  it('rejects a capacity that is not a positive integer', () => {
    for (const c of [0, -1, 1.5, Number.NaN]) expect(() => new EventRing(1, c)).toThrow(RangeError)
  })
})

describe('RingSink', () => {
  it('writes each kind of event as one record in its own ring', () => {
    const s = new RingSink(8)
    s.exec(7, 1, 3, 0x1234, 6)
    s.write(7, 1, 0xffff, 2)
    s.spawn(8, 2, 5, 0x0100)
    s.death(9, 0, 4, 0xbeef, 'div')
    s.botDead(9, 0)
    expect(Array.from(s.execs.drain())).toEqual([7, 1, 3, 0x1234, 6])
    expect(Array.from(s.writes.drain())).toEqual([7, 1, 0xffff, 2])
    expect(Array.from(s.spawns.drain())).toEqual([8, 2, 5, 0x0100])
    expect(Array.from(s.deaths.drain())).toEqual([9, 0, 4, 0xbeef, 4])
    expect(Array.from(s.botDeaths.drain())).toEqual([9, 0])
  })

  it('gives each ring its record width and the capacity asked for', () => {
    const s = new RingSink(100)
    const rings = [s.execs, s.writes, s.spawns, s.deaths, s.botDeaths]
    expect(rings.map((r) => r.width)).toEqual([
      EXEC_RECORD,
      WRITE_RECORD,
      SPAWN_RECORD,
      DEATH_RECORD,
      BOT_DEAD_RECORD,
    ])
    expect([EXEC_RECORD, WRITE_RECORD, SPAWN_RECORD, DEATH_RECORD, BOT_DEAD_RECORD]).toEqual([
      5, 4, 4, 5, 2,
    ])
    expect(rings.map((r) => r.capacity)).toEqual([100, 100, 100, 100, 100])
    expect(new RingSink().execs.capacity).toBe(16384)
  })

  it('codes a death reason as its index in DEATH_REASONS', () => {
    expect(DEATH_REASONS).toEqual(['undefined', 'dat', 'hlt', 'int3', 'div'])
    const s = new RingSink(8)
    for (const reason of DEATH_REASONS) s.death(0, 0, 0, 0, reason)
    const codes = Array.from(s.deaths.drain()).filter((_, k) => k % DEATH_RECORD === 4)
    expect(codes.map((c) => DEATH_REASONS[c])).toEqual([...DEATH_REASONS])
  })

  it('keeps the newest events of a kind when its ring overflows', () => {
    const s = new RingSink(2)
    for (let c = 0; c < 5; c++) s.write(c, 0, c, 1)
    s.botDead(4, 1)
    expect(s.writes.dropped).toBe(3)
    expect(Array.from(s.writes.drain())).toEqual([3, 0, 3, 1, 4, 0, 4, 1])
    expect([s.botDeaths.length, s.botDeaths.dropped]).toEqual([1, 0])
  })

  it('remembers the last cycle that ended', () => {
    const s = new RingSink(4)
    expect(s.lastCycle).toBe(-1)
    s.cycleEnd(0)
    s.cycleEnd(41)
    expect(s.lastCycle).toBe(41)
  })
})

describe('NullSink', () => {
  it('takes every event and keeps nothing', () => {
    const s = new NullSink()
    expect([
      s.exec(0, 0, 0, 0, 1),
      s.write(0, 0, 0, 1),
      s.spawn(0, 0, 1, 0),
      s.death(0, 0, 1, 0, 'dat'),
      s.botDead(0, 0),
      s.cycleEnd(0),
      Object.keys(s).length,
    ]).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, 0])
  })
})
