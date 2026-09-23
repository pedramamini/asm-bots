import { describe, expect, it } from 'bun:test'
import type { BotResult, DeathReason, Result } from '../src/index'
import {
  Battle,
  DEATH_REASONS,
  eventHash,
  fnv1a64,
  HashSink,
  Pcg32,
  resultHash,
} from '../src/index'
import { BOTS, CONFIG } from './determinism.fixture'

/** FNV-1a 64 in BigInt, straight from the definition: the oracle for the uint32 version. */
function reference(bytes: ArrayLike<number>): string {
  let h = 0xcbf29ce484222325n
  for (let i = 0; i < bytes.length; i++) {
    h ^= BigInt(bytes[i] as number)
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn
  }
  return h.toString(16).padStart(16, '0')
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

/** uint32 words as little-endian bytes. */
function le(words: readonly number[]): number[] {
  return words.flatMap((v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, v >>> 24])
}

/** A HashSink that also keeps the bytes it hashes, encoded here from the documented format. */
class Recording extends HashSink {
  readonly bytes: number[] = []

  private put(kind: number, ...fields: number[]): void {
    this.bytes.push(...le([kind, ...fields]))
  }

  override exec(cycle: number, bot: number, proc: number, addr: number, len: number): void {
    this.put(0, cycle, bot, proc, addr, len)
    super.exec(cycle, bot, proc, addr, len)
  }
  override write(cycle: number, bot: number, addr: number, len: number): void {
    this.put(1, cycle, bot, addr, len)
    super.write(cycle, bot, addr, len)
  }
  override spawn(cycle: number, bot: number, proc: number, addr: number): void {
    this.put(2, cycle, bot, proc, addr)
    super.spawn(cycle, bot, proc, addr)
  }
  override death(cycle: number, bot: number, proc: number, addr: number, reason: DeathReason) {
    this.put(3, cycle, bot, proc, addr, DEATH_REASONS.indexOf(reason))
    super.death(cycle, bot, proc, addr, reason)
  }
  override botDead(cycle: number, bot: number): void {
    this.put(4, cycle, bot)
    super.botDead(cycle, bot)
  }
  override cycleEnd(cycle: number): void {
    this.put(5, cycle)
    super.cycleEnd(cycle)
  }
}

const BOT: BotResult = {
  name: 'imp',
  alive: true,
  points: 3,
  procs: 1,
  footprint: 700,
  cycles: 1000,
  writes: 350,
  peakProcs: 1,
  deathCycle: null,
  deathReason: null,
}
const DEAD: BotResult = {
  ...BOT,
  name: 'dwarf',
  alive: false,
  points: 0,
  procs: 0,
  footprint: 12,
  deathCycle: 17,
  deathReason: 'div',
}
const RESULT: Result = { cycles: 1000, survivors: [0], bots: [BOT, DEAD] }

describe('fnv1a64', () => {
  it('gives the published FNV-1a 64 values', () => {
    expect(fnv1a64(utf8(''))).toBe('cbf29ce484222325')
    expect(fnv1a64(utf8('a'))).toBe('af63dc4c8601ec8c')
    expect(fnv1a64(utf8('foobar'))).toBe('85944171f73967e8')
  })

  it('matches the BigInt definition on 2,000 random byte strings', () => {
    const rng = new Pcg32(0x46a1, 3)
    for (let t = 0; t < 2000; t++) {
      const bytes = Uint8Array.from({ length: rng.nextInt(80) }, () => rng.nextInt(256))
      expect(fnv1a64(bytes)).toBe(reference(bytes))
    }
  })

  it('matches it on a long run of each byte value', () => {
    for (const b of [0x00, 0x01, 0x7f, 0x80, 0xfe, 0xff]) {
      const bytes = new Uint8Array(4096).fill(b)
      expect(fnv1a64(bytes)).toBe(reference(bytes))
    }
  })
})

describe('resultHash', () => {
  it('is FNV-1a 64 of the canonical JSON in UTF-8', () => {
    const json =
      '{"bots":[' +
      '{"alive":true,"cycles":1000,"deathCycle":null,"deathReason":null,"footprint":700,' +
      '"name":"imp","peakProcs":1,"points":3,"procs":1,"writes":350},' +
      '{"alive":false,"cycles":1000,"deathCycle":17,"deathReason":"div","footprint":12,' +
      '"name":"dwarf","peakProcs":1,"points":0,"procs":0,"writes":350}' +
      '],"cycles":1000,"survivors":[0]}'
    expect(resultHash(RESULT)).toBe(reference(utf8(json)))
  })

  it('does not depend on the order of the fields', () => {
    const reversed = (o: object) => Object.fromEntries(Object.entries(o).reverse())
    const shuffled = {
      survivors: [0],
      bots: RESULT.bots.map(reversed),
      cycles: 1000,
    } as unknown as Result
    expect(resultHash(shuffled)).toBe(resultHash(RESULT))
  })

  it('changes with every field', () => {
    const seen = new Set([resultHash(RESULT)])
    const variants: Result[] = [
      { ...RESULT, cycles: 1001 },
      { ...RESULT, survivors: [1] },
      { ...RESULT, survivors: [] },
      { ...RESULT, bots: [DEAD, BOT] },
      { ...RESULT, bots: [BOT] },
    ]
    const changes: Partial<BotResult>[] = [
      { name: 'imq' },
      { alive: false },
      { points: 1 },
      { procs: 2 },
      { footprint: 701 },
      { cycles: 999 },
      { writes: 351 },
      { peakProcs: 2 },
      { deathCycle: 0 },
      { deathReason: 'dat' },
    ]
    for (const change of changes) variants.push({ ...RESULT, bots: [{ ...BOT, ...change }, DEAD] })
    for (const v of variants) seen.add(resultHash(v))
    expect(seen.size).toBe(variants.length + 1)
  })

  it('hashes names in UTF-8', () => {
    const r: Result = { cycles: 0, survivors: [], bots: [{ ...DEAD, name: 'Zoë "☃"' }] }
    const json =
      '{"bots":[{"alive":false,"cycles":1000,"deathCycle":17,"deathReason":"div",' +
      '"footprint":12,"name":"Zoë \\"☃\\"","peakProcs":1,"points":0,"procs":0,"writes":350}],' +
      '"cycles":0,"survivors":[]}'
    expect(resultHash(r)).toBe(reference(utf8(json)))
    expect(utf8(json).length).toBeGreaterThan(json.length)
  })

  it('is 16 lowercase hex digits', () => {
    for (const r of [RESULT, { cycles: 0, survivors: [], bots: [] }]) {
      expect(/^[0-9a-f]{16}$/.test(resultHash(r))).toBe(true)
    }
  })
})

describe('HashSink and eventHash', () => {
  it('hashes nothing to the FNV offset basis', () => {
    expect(eventHash(new HashSink())).toBe('cbf29ce484222325')
  })

  it('hashes each event as its kind code and its fields, uint32 little-endian', () => {
    const sink = new HashSink()
    sink.exec(0x01020304, 1, 2, 0xfffe, 6)
    sink.write(7, 254, 0xffff, 2)
    sink.spawn(0xffffffff, 0, 63, 0x1234)
    sink.death(9, 3, 4, 0xabcd, 'int3')
    sink.botDead(9, 3)
    sink.cycleEnd(9)
    const words = [
      [0, 0x01020304, 1, 2, 0xfffe, 6],
      [1, 7, 254, 0xffff, 2],
      [2, 0xffffffff, 0, 63, 0x1234],
      [3, 9, 3, 4, 0xabcd, 3],
      [4, 9, 3],
      [5, 9],
    ]
    expect(eventHash(sink)).toBe(reference(le(words.flat())))
  })

  it('codes each death reason as its DEATH_REASONS index', () => {
    const hashes = DEATH_REASONS.map((reason, code) => {
      const sink = new HashSink()
      sink.death(1, 0, 0, 0x100, reason)
      expect(eventHash(sink)).toBe(reference(le([3, 1, 0, 0, 0x100, code])))
      return eventHash(sink)
    })
    expect(new Set(hashes).size).toBe(DEATH_REASONS.length)
  })

  it('depends on the order of the events', () => {
    const a = new HashSink()
    a.write(0, 0, 0x10, 2)
    a.write(0, 1, 0x20, 2)
    const b = new HashSink()
    b.write(0, 1, 0x20, 2)
    b.write(0, 0, 0x10, 2)
    expect(eventHash(a)).not.toBe(eventHash(b))
  })

  it("hashes a battle's whole event stream", () => {
    const sink = new Recording()
    new Battle(BOTS, CONFIG, sink).run(1000)
    const kinds = new Set<number>()
    for (let i = 0; i < sink.bytes.length; ) {
      const kind = sink.bytes[i] as number
      kinds.add(kind)
      i += 4 * ([6, 5, 5, 6, 3, 2][kind] as number)
    }
    expect([...kinds].sort()).toEqual([0, 1, 2, 3, 4, 5])
    expect(eventHash(sink)).toBe(reference(sink.bytes))
  })
})
