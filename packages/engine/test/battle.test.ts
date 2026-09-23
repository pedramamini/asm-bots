import { describe, expect, it } from 'bun:test'
import { decode, format } from '@asmbots/codec'
import {
  Battle,
  type BattleConfig,
  type BattleConfigInput,
  BOT_DEAD_RECORD,
  CF,
  Core,
  DEATH_REASONS,
  DEATH_RECORD,
  DEFAULT_CONFIG,
  type DeathReason,
  type EventRing,
  type EventSink,
  EXEC_KILLED,
  EXEC_RECORD,
  EXEC_SPAWN,
  ExecContext,
  execOne,
  Fetcher,
  FLAGS,
  FLAGS_INIT,
  IP,
  type LoadedBot,
  MAX_BOTS,
  NullSink,
  Pcg32,
  PLACEMENT_ATTEMPTS,
  PlacementError,
  type ProcQueue,
  place,
  pmarsPoints,
  type Result,
  RingSink,
  SP,
  SPAWN_RECORD,
  simulate,
  WRITE_RECORD,
} from '../src/index'

function hex(n: number): string {
  return `0x${n.toString(16).toUpperCase().padStart(4, '0')}`
}

/** `base + k` in the core, in hex. */
function at(base: number, k: number): string {
  return hex((base + k) & 0xffff)
}

/** A program: each instruction's source and its hand-assembled bytes. */
type Source = readonly (readonly [text: string, bytes: readonly number[]])[]

const LOOP: Source = [['jmp short $', [0xeb, 0xfe]]]
/** Copies [SI] to [DI] forever. SI = DI = 0 at the start, so it rewrites the core onto itself. */
const IMP: Source = [
  ['movsb', [0xa4]],
  ['jmp short $ - 1', [0xeb, 0xfd]],
]
const DAT: Source = [['dat', [0x00, 0x00]]]
const HLT: Source = [['hlt', [0xf4]]]
const INT3: Source = [['int3', [0xcc]]]
const UNDEFINED: Source = [['db 0x0F', [0x0f]]]
/** AL is 0 at the start, so this divides by zero. */
const DIV: Source = [['div al', [0xf6, 0xf0]]]
/** Each SPL starts a child on itself and sends the parent on to the jump back. */
const STORM: Source = [
  ['spl $', [0x60, 0xfe]],
  ['jmp short $ - 2', [0xeb, 0xfc]],
]
const NOPS_THEN_DAT: Source = [
  ['nop', [0x90]],
  ['nop', [0x90]],
  ['nop', [0x90]],
  ['dat', [0x00, 0x00]],
]
/** The parent loops at +6, the child at +8. */
const SPLITTER: Source = [
  ['mov ax, 0x1234', [0xb8, 0x34, 0x12]],
  ['stc', [0xf9]],
  ['spl $ + 4', [0x60, 0x02]],
  ['jmp short $', [0xeb, 0xfe]],
  ['jmp short $', [0xeb, 0xfe]],
]
/** The child starts on the DAT at +4; the parent loops at +2. */
const SPAWN_THEN_DIE: Source = [
  ['spl $ + 4', [0x60, 0x02]],
  ['jmp short $', [0xeb, 0xfe]],
  ['dat', [0x00, 0x00]],
]
/** AX = 0 and DI = 0 at the start, so this zeroes 0x0000..0x0005. */
const PAINTER: Source = [
  ['mov cx, 3', [0xb9, 0x03, 0x00]],
  ['rep stosw', [0xf3, 0xab]],
  ['jmp short $', [0xeb, 0xfe]],
]

/** Writes a DAT over the word at `target`, then loops. */
function bomber(target: number): Source {
  return [
    [`mov word [${hex(target)}], 0`, [0xc7, 0x06, target & 0xff, target >> 8, 0x00, 0x00]],
    ['jmp short $', [0xeb, 0xfe]],
  ]
}

function bot(source: Source, name = 'bot'): LoadedBot {
  return { name, bytes: Uint8Array.from(source.flatMap(([, bytes]) => bytes)) }
}

type Kind = 'exec' | 'write' | 'spawn' | 'death' | 'botDead' | 'end'
/** An event: its kind, cycle, bot, proc, addr, and len or reason. -1 where a kind has no field. */
type Event = readonly [
  kind: Kind,
  cycle: number,
  bot: number,
  proc: number,
  addr: number,
  extra: number | string,
]

function line([kind, cycle, bot, proc, addr, extra]: Event): string {
  switch (kind) {
    case 'exec':
      return `${cycle} exec ${bot}.${proc} ${hex(addr)} ${extra}`
    case 'write':
      return `${cycle} write ${bot} ${hex(addr)} ${extra}`
    case 'spawn':
      return `${cycle} spawn ${bot}.${proc} ${hex(addr)}`
    case 'death':
      return `${cycle} death ${bot}.${proc} ${hex(addr)} ${extra}`
    case 'botDead':
      return `${cycle} botDead ${bot}`
    case 'end':
      return `${cycle} end`
  }
}

/** Every event, in order. */
class Recorder implements EventSink {
  readonly events: Event[] = []

  exec(cycle: number, bot: number, proc: number, addr: number, len: number): void {
    this.events.push(['exec', cycle, bot, proc, addr, len])
  }
  write(cycle: number, bot: number, addr: number, len: number): void {
    this.events.push(['write', cycle, bot, -1, addr, len])
  }
  spawn(cycle: number, bot: number, proc: number, addr: number): void {
    this.events.push(['spawn', cycle, bot, proc, addr, -1])
  }
  death(cycle: number, bot: number, proc: number, addr: number, reason: DeathReason): void {
    this.events.push(['death', cycle, bot, proc, addr, reason])
  }
  botDead(cycle: number, bot: number): void {
    this.events.push(['botDead', cycle, bot, -1, -1, -1])
  }
  cycleEnd(cycle: number): void {
    this.events.push(['end', cycle, -1, -1, -1, -1])
  }

  lines(): string[] {
    return this.events.map(line)
  }

  of(...kinds: Kind[]): string[] {
    return this.events.filter(([kind]) => kinds.includes(kind)).map(line)
  }
}

/** Passes every event to two sinks. */
class Tee implements EventSink {
  private readonly a: EventSink
  private readonly b: EventSink

  constructor(a: EventSink, b: EventSink) {
    this.a = a
    this.b = b
  }
  exec(cycle: number, bot: number, proc: number, addr: number, len: number): void {
    this.a.exec(cycle, bot, proc, addr, len)
    this.b.exec(cycle, bot, proc, addr, len)
  }
  write(cycle: number, bot: number, addr: number, len: number): void {
    this.a.write(cycle, bot, addr, len)
    this.b.write(cycle, bot, addr, len)
  }
  spawn(cycle: number, bot: number, proc: number, addr: number): void {
    this.a.spawn(cycle, bot, proc, addr)
    this.b.spawn(cycle, bot, proc, addr)
  }
  death(cycle: number, bot: number, proc: number, addr: number, reason: DeathReason): void {
    this.a.death(cycle, bot, proc, addr, reason)
    this.b.death(cycle, bot, proc, addr, reason)
  }
  botDead(cycle: number, bot: number): void {
    this.a.botDead(cycle, bot)
    this.b.botDead(cycle, bot)
  }
  cycleEnd(cycle: number): void {
    this.a.cycleEnd(cycle)
    this.b.cycleEnd(cycle)
  }
}

/** The bots that execute in each cycle, in order. */
function turns(rec: Recorder): number[][] {
  const out: number[][] = []
  for (const [kind, cycle, b] of rec.events) {
    if (kind !== 'exec') continue
    out[cycle] ??= []
    out[cycle]?.push(b)
  }
  return out
}

/** The first seed from 0 on that `ok` accepts. */
function firstSeed(ok: (seed: number) => boolean): number {
  for (let seed = 0; seed < 100_000; seed++) if (ok(seed)) return seed
  throw new Error('no seed found')
}

describe('test programs', () => {
  it('disassemble to their source', () => {
    const programs = [
      LOOP,
      IMP,
      DAT,
      HLT,
      INT3,
      UNDEFINED,
      DIV,
      STORM,
      NOPS_THEN_DAT,
      SPLITTER,
      SPAWN_THEN_DIE,
      PAINTER,
      bomber(0x1234),
      bomber(0x0005),
    ]
    for (const program of programs) {
      for (const [text, bytes] of program) {
        const d = decode((a) => bytes[a] ?? 0, 0)
        expect([format(d), d.length]).toEqual([text, bytes.length])
      }
    }
  })
})

describe('config (ISA §5.5)', () => {
  it('defaults to the ISA values, with seed 0', () => {
    expect(DEFAULT_CONFIG).toEqual({
      coreSize: 65536,
      maxCycles: 100_000,
      maxProcesses: 64,
      minSpacing: 1024,
      maxBotBytes: 512,
      seed: 0,
    })
    const b = new Battle([bot(LOOP)])
    expect(b.config).toEqual(DEFAULT_CONFIG)
    expect([Object.isFrozen(DEFAULT_CONFIG), Object.isFrozen(b.config)]).toEqual([true, true])
  })

  it('takes the fields given and defaults the rest', () => {
    const b = new Battle([bot(LOOP)], { maxCycles: 80_000, seed: 7, maxProcesses: 8 })
    expect(b.config).toEqual({ ...DEFAULT_CONFIG, maxCycles: 80_000, seed: 7, maxProcesses: 8 })
    // Undefined is left out, as a CLI flag not given would be.
    const flags: BattleConfigInput = { seed: undefined, minSpacing: 64 }
    expect(new Battle([bot(LOOP)], flags).config).toEqual({ ...DEFAULT_CONFIG, minSpacing: 64 })
  })

  it('rejects values out of range', () => {
    const bad: [keyof BattleConfig, number][] = [
      ['coreSize', 32768],
      ['coreSize', 65537],
      ['maxCycles', -1],
      ['maxCycles', 1.5],
      ['maxCycles', 2 ** 32],
      ['maxCycles', Number.NaN],
      ['maxProcesses', 0],
      ['maxProcesses', 65537],
      ['maxProcesses', 2.5],
      ['minSpacing', -1],
      ['minSpacing', 65537],
      ['minSpacing', 0.5],
      ['maxBotBytes', 0],
      ['maxBotBytes', 65537],
      ['seed', -1],
      ['seed', 2 ** 32],
      ['seed', 0.5],
      ['seed', Number.NaN],
    ]
    for (const [key, value] of bad) {
      const make = () => new Battle([bot(HLT)], { [key]: value })
      expect(make).toThrow(RangeError)
      // The config check says so, not whatever would have failed later.
      expect(make).toThrow(`Battle: ${key} `)
    }
  })

  it('accepts the bounds', () => {
    const good: BattleConfigInput[] = [
      { maxCycles: 0 },
      { maxCycles: 2 ** 32 - 1 },
      { maxProcesses: 1 },
      { maxProcesses: 65536 },
      { minSpacing: 0 },
      { minSpacing: 65536 },
      { maxBotBytes: 1 },
      { maxBotBytes: 65536 },
      { seed: 0 },
      { seed: 2 ** 32 - 1 },
    ]
    for (const config of good) {
      expect(new Battle([bot(HLT)], config).config).toEqual({ ...DEFAULT_CONFIG, ...config })
    }
  })

  it(`takes 1 to ${MAX_BOTS} bots of 1 to maxBotBytes bytes each`, () => {
    const tiny = bot(HLT)
    const many = (n: number) => Array.from({ length: n }, () => tiny)
    expect(() => new Battle([])).toThrow(RangeError)
    expect(new Battle(many(MAX_BOTS), { minSpacing: 0 }).bots.length).toBe(255)
    expect(() => new Battle(many(MAX_BOTS + 1), { minSpacing: 0 })).toThrow(RangeError)
    const sized = (n: number): LoadedBot => ({ name: `b${n}`, bytes: new Uint8Array(n) })
    expect(() => new Battle([sized(0)])).toThrow(RangeError)
    expect(() => new Battle([tiny, sized(513)])).toThrow('bot 1 (b513) is 513 bytes, not 1..512')
    expect(new Battle([sized(512)]).bots[0]?.size).toBe(512)
    expect(new Battle([sized(513)], { maxBotBytes: 513 }).bots[0]?.size).toBe(513)
  })
})

describe('loading (ISA §5.5)', () => {
  const images = [
    bot(IMP, 'imp'),
    bot(PAINTER, 'painter'),
    bot(LOOP, 'loop'),
    { name: 'big', bytes: Uint8Array.from({ length: 300 }, (_, k) => (k * 7 + 1) & 0xff) },
  ]
  const sizes = images.map((b) => b.bytes.length)

  it('loads each bot at its placement, tagged index + 1, over an empty core', () => {
    for (let seed = 0; seed < 20; seed++) {
      const b = new Battle(images, { seed })
      const bases = place(sizes, 1024, new Pcg32(seed))
      expect(b.bots.map((x) => x.base)).toEqual(bases)
      const bytes = new Uint8Array(65536)
      const owner = new Uint8Array(65536)
      images.forEach((image, i) => {
        image.bytes.forEach((v, k) => {
          const a = ((bases[i] as number) + k) & 0xffff
          bytes[a] = v
          owner[a] = i + 1
        })
      })
      expect(b.core.bytes).toEqual(bytes)
      expect(b.core.owner).toEqual(owner)
    }
  })

  it('loads an image across 0xFFFF', () => {
    const big = images[3] as LoadedBot
    const seed = firstSeed((s) => (place([300], 0, new Pcg32(s))[0] as number) > 0xffff - 299)
    const b = new Battle([big], { seed })
    const base = b.bots[0]?.base as number
    const split = 0x10000 - base
    expect(split).toBeGreaterThan(0)
    expect(split).toBeLessThan(300)
    expect(b.core.bytes.subarray(base)).toEqual(big.bytes.subarray(0, split))
    expect(b.core.bytes.subarray(0, 300 - split)).toEqual(big.bytes.subarray(split))
    expect(b.result().bots[0]?.footprint).toBe(300)
    expect([b.core.owner[0xffff], b.core.owner[0], b.core.owner[300 - split]]).toEqual([1, 1, 0])
  })

  it('starts each bot with one process: IP = SP = base, FLAGS = 0x0002, the rest 0', () => {
    const b = new Battle(images, { seed: 3 })
    for (const x of b.bots) {
      expect(x.queue.size).toBe(1)
      expect(Array.from(x.queue.rows[x.queue.front()] as Uint16Array)).toEqual([
        0,
        0,
        0,
        0,
        x.base,
        0,
        0,
        0,
        x.base,
        FLAGS_INIT,
      ])
    }
  })

  it('names each bot and keeps its meta', () => {
    const meta = { author: 'A. K. Dewdney', strategy: 'Bombs every 4th word.', version: '1' }
    const b = new Battle([{ ...bot(LOOP, 'dwarf'), meta }, bot(IMP, 'imp')])
    expect(b.bots.map((x) => [x.index, x.tag, x.name, x.meta, x.size, x.alive])).toEqual([
      [0, 1, 'dwarf', meta, 2, true],
      [1, 2, 'imp', undefined, 3, true],
    ])
  })

  it('counts the load as neither writes nor events', () => {
    const rec = new Recorder()
    const b = new Battle(images, {}, rec)
    expect(rec.events).toEqual([])
    expect(b.bots.map((x) => x.stats.writes)).toEqual([0, 0, 0, 0])
    expect(b.result().bots.map((x) => x.footprint)).toEqual(sizes)
  })

  it('keeps the placement PRNG where placement left it', () => {
    const g = new Pcg32(11)
    let draws = 0
    place(sizes, 1024, {
      nextInt: (n) => {
        draws++
        return g.nextInt(n)
      },
    })
    const b = new Battle(images, { seed: 11 })
    expect(b.prng.serialize()).toEqual(g.serialize())
    expect(draws).toBeGreaterThanOrEqual(sizes.length)
  })
})

/** Placement the slow way: a byte map of where a new image may not put a byte. */
function referencePlace(sizes: readonly number[], m: number, seed: number): number[] | string {
  const g = new Pcg32(seed)
  const zone = new Uint8Array(65536)
  const bases: number[] = []
  for (let i = 0; i < sizes.length; i++) {
    const size = sizes[i] as number
    let base = -1
    for (let t = 0; t < 1000 && base < 0; t++) {
      const b = g.nextInt(65536)
      let ok = true
      for (let k = 0; k < size && ok; k++) if (zone[(b + k) & 0xffff]) ok = false
      if (ok) base = b
    }
    if (base < 0) return `bot ${i} does not fit`
    bases.push(base)
    for (let k = -m; k < size + m; k++) zone[(base + k) & 0xffff] = 1
  }
  return bases
}

/** What `place` gives, or which bot did not fit. */
function placed(sizes: readonly number[], m: number, seed: number): number[] | string {
  try {
    return place(sizes, m, new Pcg32(seed))
  } catch (e) {
    if (!(e instanceof PlacementError)) throw e
    return `bot ${e.bot} does not fit`
  }
}

/** Overlaps and short gaps: each image must be followed by `m` free bytes before the next. */
function spacingFaults(bases: readonly number[], sizes: readonly number[], m: number): string[] {
  const faults: string[] = []
  const occupant = new Int16Array(65536).fill(-1)
  bases.forEach((base, i) => {
    for (let k = 0; k < (sizes[i] as number); k++) {
      const a = (base + k) & 0xffff
      if (occupant[a] !== -1) faults.push(`bots ${occupant[a]} and ${i} overlap at ${hex(a)}`)
      occupant[a] = i
    }
  })
  bases.forEach((base, i) => {
    let a = (base + (sizes[i] as number)) & 0xffff
    for (let free = 0; free < m; free++, a = (a + 1) & 0xffff) {
      if (occupant[a] !== -1) {
        faults.push(`bot ${occupant[a]} is ${free} bytes after bot ${i}`)
        break
      }
    }
  })
  return faults
}

/** A generator that returns `draws` in order. */
function scripted(draws: readonly number[]): Pick<Pcg32, 'nextInt'> & { calls: number } {
  const rng = {
    calls: 0,
    nextInt(n: number): number {
      if (n !== 65536) throw new Error(`drew from 0..${n - 1}`)
      const v = draws[rng.calls++]
      if (v === undefined) throw new Error('out of draws')
      return v
    },
  }
  return rng
}

describe('placement (ISA §5.5)', () => {
  const layouts = [
    { sizes: [512, 1, 100, 512, 333, 2, 511, 64], m: 1024 },
    { sizes: Array.from({ length: 32 }, (_, i) => 1 + ((i * 97) % 512)), m: 0 },
    // Only 1,533 of the 65,536 bases clear the first image.
    { sizes: [2, 2], m: 32000 },
    // Only the base opposite the first image clears it, so most seeds fail.
    { sizes: [2, 2], m: 32766 },
  ]

  it('matches a byte-map model over 1,000 seeds', () => {
    for (const { sizes, m } of layouts) {
      const got: (number[] | string)[] = []
      const want: (number[] | string)[] = []
      for (let seed = 0; seed < 1000; seed++) {
        got.push(placed(sizes, m, seed))
        want.push(referencePlace(sizes, m, seed))
      }
      expect(got).toEqual(want)
    }
    // Both outcomes of the last layout occur.
    const outcomes = new Set(
      Array.from({ length: 1000 }, (_, seed) => typeof placed([2, 2], 32766, seed)),
    )
    expect([...outcomes].sort()).toEqual(['object', 'string'])
  })

  it('respects minSpacing over 1,000 seeds, around the wrap too', () => {
    let wrapped = 0
    let gapsWrapped = 0
    const faults: string[] = []
    for (const { sizes, m } of layouts.slice(0, 3)) {
      for (let seed = 0; seed < 1000; seed++) {
        const bases = place(sizes, m, new Pcg32(seed))
        faults.push(...spacingFaults(bases, sizes, m).map((f) => `seed ${seed}: ${f}`))
        bases.forEach((base, i) => {
          const end = base + (sizes[i] as number)
          if (end > 0x10000) wrapped++
          else if (end + m > 0x10000) gapsWrapped++
        })
      }
    }
    expect(faults).toEqual([])
    expect(wrapped).toBeGreaterThan(0)
    expect(gapsWrapped).toBeGreaterThan(0)
  })

  it('takes the first draw for the first bot, and draws on for the next', () => {
    const rng = scripted([0xabcd, 0xabcd, 0xabd5 + 16])
    expect(place([8, 8], 16, rng)).toEqual([0xabcd, 0xabe5])
    expect(rng.calls).toBe(3)
  })

  it('allows a gap of exactly minSpacing on either side, and not one byte less', () => {
    // A is 32 bytes at 0x1000..0x101F. B is 8 bytes. m is 16.
    const cases: [number[], number][] = [
      [[0x1000, 0x102f, 0x1030], 0x1030], // after A: gap 15, then 16
      [[0x1000, 0x0fe9, 0x0fe8], 0x0fe8], // before A: B ends at 0x0FF0, gap 15; at 0x0FEF, gap 16
    ]
    for (const [draws, b] of cases) {
      const rng = scripted(draws)
      expect(place([32, 8], 16, rng)).toEqual([0x1000, b])
      expect(rng.calls).toBe(3)
    }
  })

  it('measures gaps around the wrap', () => {
    const cases: [number, number[], number][] = [
      // A covers 0xFFF0..0x000F. B after it: gap 15, then 16.
      [0xfff0, [0x001f, 0x0020], 0x0020],
      // B before it: 0xFFD9..0xFFE0 leaves 15, 0xFFD8..0xFFDF leaves 16.
      [0xfff0, [0xffd9, 0xffd8], 0xffd8],
      // A covers 0x0005..0x0024. B before it, the gap across 0xFFFF: 15, then 16.
      [0x0005, [0xffee, 0xffed], 0xffed],
      // A covers 0x0010..0x002F. B wraps: 0xFFF9..0x0000 leaves 15, 0xFFF8..0xFFFF leaves 16.
      [0x0010, [0xfff9, 0xfff8], 0xfff8],
    ]
    for (const [a, draws, b] of cases) {
      const rng = scripted([a, ...draws])
      expect(place([32, 8], 16, rng)).toEqual([a, b])
      expect(rng.calls).toBe(3)
    }
  })

  it('lets images touch with minSpacing 0, and never overlap', () => {
    // A is 32 bytes at 0x1000..0x101F. B is 8: at A's base, inside A, flush with A's end,
    // over A's last byte, and over A's first byte.
    const overlapping = [0x1000, 0x1010, 0x1018, 0x101f, 0x0ff9]
    const rng = scripted([0x1000, ...overlapping, 0x1020])
    expect(place([32, 8], 0, rng)).toEqual([0x1000, 0x1020])
    expect(rng.calls).toBe(2 + overlapping.length)
    expect(place([32, 8], 0, scripted([0x1000, 0x0ff8]))).toEqual([0x1000, 0x0ff8])
    // An image as big as the core leaves no room for a second.
    expect(() => place([65536, 1], 0, new Pcg32(1))).toThrow(PlacementError)
  })

  it(`throws PlacementError after ${PLACEMENT_ATTEMPTS} draws for one bot`, () => {
    expect(PLACEMENT_ATTEMPTS).toBe(1000)
    let calls = 0
    const rng = {
      nextInt: () => {
        calls++
        return 0x1000
      },
    }
    let error: unknown
    try {
      place([8, 8, 8], 16, rng)
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(PlacementError)
    expect((error as PlacementError).bot).toBe(1)
    expect((error as PlacementError).name).toBe('PlacementError')
    expect(calls).toBe(1 + PLACEMENT_ATTEMPTS)
  })

  it(`places a bot on its ${PLACEMENT_ATTEMPTS}th draw`, () => {
    let calls = 0
    const rng = {
      nextInt: () => {
        calls++
        return calls === 1 + PLACEMENT_ATTEMPTS ? 0x8000 : 0x1000
      },
    }
    expect(place([8, 8], 16, rng)).toEqual([0x1000, 0x8000])
  })

  it('makes the battle invalid when the bots do not fit', () => {
    // 2 + 2 + 2 * 32767 > 65536: no base clears the first bot.
    expect(() => new Battle([bot(LOOP), bot(LOOP)], { minSpacing: 32767 })).toThrow(PlacementError)
    expect(() => new Battle([bot(LOOP), bot(LOOP)], { minSpacing: 32767 })).toThrow(
      'cannot place bot 1 (2 bytes) 32767 bytes clear of the 1 placed before it in 1000 draws',
    )
  })
})

describe('cycles and turn order (ISA §5.2)', () => {
  it('starts cycle c with bot c mod N: bot 1 executes first on cycle 1', () => {
    const rec = new Recorder()
    new Battle([bot(LOOP), bot(LOOP)], { maxCycles: 4 }, rec).run()
    expect(turns(rec)).toEqual([
      [0, 1],
      [1, 0],
      [0, 1],
      [1, 0],
    ])
  })

  it('rotates through all N bots', () => {
    const rec = new Recorder()
    new Battle(
      Array.from({ length: 5 }, () => bot(LOOP)),
      { maxCycles: 7 },
      rec,
    ).run()
    expect(turns(rec)).toEqual([
      [0, 1, 2, 3, 4],
      [1, 2, 3, 4, 0],
      [2, 3, 4, 0, 1],
      [3, 4, 0, 1, 2],
      [4, 0, 1, 2, 3],
      [0, 1, 2, 3, 4],
      [1, 2, 3, 4, 0],
    ])
  })

  it('skips dead bots and counts N over every bot loaded', () => {
    const rec = new Recorder()
    new Battle([bot(LOOP), bot(DAT), bot(LOOP)], { maxCycles: 7 }, rec).run()
    expect(turns(rec)).toEqual([
      [0, 1, 2],
      [2, 0],
      [2, 0],
      [0, 2],
      [2, 0],
      [2, 0],
      [0, 2],
    ])
  })

  it('runs one instruction per living bot per cycle, however many processes it has', () => {
    const rec = new Recorder()
    const b = new Battle([bot(STORM), bot(LOOP)], { maxCycles: 300 }, rec)
    b.run()
    expect(turns(rec)).toEqual(Array.from({ length: 300 }, (_, c) => (c % 2 ? [1, 0] : [0, 1])))
    expect(b.bots[0]?.queue.size).toBe(64)
    expect(b.bots.map((x) => x.stats.cycles)).toEqual([300, 300])
  })

  it('counts cycles from 0, and events carry the cycle they happen in', () => {
    const rec = new Recorder()
    const b = new Battle([bot(IMP), bot(LOOP)], { maxCycles: 3 }, rec)
    expect(b.cycle).toBe(0)
    b.step()
    expect(b.cycle).toBe(1)
    b.run()
    expect(b.cycle).toBe(3)
    expect(rec.events.map(([kind, cycle]) => `${cycle} ${kind}`)).toEqual([
      '0 exec',
      '0 write',
      '0 exec',
      '0 end',
      '1 exec',
      '1 exec',
      '1 end',
      '2 exec',
      '2 write',
      '2 exec',
      '2 end',
    ])
  })

  it('ends a cycle once the battle has counted it and knows whether it is over', () => {
    const watch = new CycleWatch()
    const b = new Battle([bot(LOOP), bot(NOPS_THEN_DAT)], { maxCycles: 10 }, watch)
    watch.battle = b
    b.run()
    expect(watch.seen).toEqual(['0: 1 2 false', '1: 2 2 false', '2: 3 2 false', '3: 4 1 true'])
  })
})

/** Notes the battle's cycle, bots alive, and `over` at each `cycleEnd`. */
class CycleWatch extends NullSink {
  battle: Battle | undefined
  readonly seen: string[] = []

  override cycleEnd(cycle: number): void {
    const b = this.battle
    this.seen.push(`${cycle}: ${b?.cycle} ${b?.alive} ${b?.over}`)
  }
}

describe('SPL (ISA §3.6, §5.2)', () => {
  it('queues the child ahead of its parent', () => {
    const rec = new Recorder()
    const b = new Battle([bot(SPLITTER)], { maxCycles: 7 }, rec)
    const p = b.bots[0]?.base as number
    b.run()
    // The child's row is any free one: rotate leaves the free rows in any order.
    const c = rec.events.find(([kind]) => kind === 'spawn')?.[3]
    expect(c).not.toBe(0)
    expect(rec.lines()).toEqual([
      `0 exec 0.0 ${at(p, 0)} 3`,
      '0 end',
      `1 exec 0.0 ${at(p, 3)} 1`,
      '1 end',
      `2 exec 0.0 ${at(p, 4)} 2`,
      `2 spawn 0.${c} ${at(p, 8)}`,
      '2 end',
      `3 exec 0.${c} ${at(p, 8)} 2`,
      '3 end',
      `4 exec 0.0 ${at(p, 6)} 2`,
      '4 end',
      `5 exec 0.${c} ${at(p, 8)} 2`,
      '5 end',
      `6 exec 0.0 ${at(p, 6)} 2`,
      '6 end',
    ])
  })

  it("gives the child a copy of the parent's registers and flags, with IP at the target", () => {
    const b = new Battle([bot(SPLITTER)])
    b.run(3)
    const x = b.bots[0]
    if (x === undefined) throw new Error('no bot')
    const q = x.queue
    expect(q.size).toBe(2)
    const parent = [0x1234, 0, 0, 0, x.base, 0, 0, 0, (x.base + 6) & 0xffff, FLAGS_INIT | CF]
    expect(Array.from(q.rows[q.at(1)] as Uint16Array)).toEqual(parent)
    expect(Array.from(q.rows[q.at(0)] as Uint16Array)).toEqual([
      ...parent.slice(0, IP),
      (x.base + 8) & 0xffff,
      FLAGS_INIT | CF,
    ])
  })

  it('caps a spl storm at maxProcesses, where SPL is a NOP', () => {
    for (const cap of [1, 2, 5, DEFAULT_CONFIG.maxProcesses]) {
      const rec = new Recorder()
      const b = new Battle([bot(STORM), bot(LOOP)], { maxProcesses: cap, maxCycles: 400 }, rec)
      const x = b.bots[0]
      if (x === undefined) throw new Error('no bot')
      // Step by step: the queue grows by one per spawn and never past the cap.
      const sizes: number[] = []
      for (let c = 0; c < 400; c++) {
        b.step()
        sizes.push(x.queue.size)
      }
      const spawns = rec.events.filter(([kind]) => kind === 'spawn').map(([, cycle]) => cycle)
      const full = sizes.indexOf(cap)
      expect(spawns.length).toBe(cap - 1)
      expect(spawns.every((cycle) => cycle <= full)).toBe(true)
      expect(Math.max(...sizes)).toBe(cap)
      expect(sizes.slice(full).every((n) => n === cap)).toBe(true)
      expect(rec.of('death', 'botDead')).toEqual([])
      // At the cap the SPL still moves the process on to the jump back.
      const q = x.queue
      const ips = Array.from({ length: q.size }, (_, k) => (q.rows[q.at(k)] as Uint16Array)[IP])
      expect(ips.every((ip) => ip === x.base || ip === ((x.base + 2) & 0xffff))).toBe(true)
      expect(b.result().bots[0]).toMatchObject({ alive: true, procs: cap, peakProcs: cap })
    }
  })

  it('keeps peakProcs after processes die, and a bot lives on while one process does', () => {
    const rec = new Recorder()
    const b = new Battle([bot(SPAWN_THEN_DIE), bot(LOOP)], { maxCycles: 10 }, rec)
    const p = b.bots[0]?.base as number
    const r = b.run() as Result
    expect(rec.of('spawn', 'death', 'botDead')).toEqual([
      `0 spawn 0.1 ${at(p, 4)}`,
      `1 death 0.1 ${at(p, 4)} dat`,
    ])
    expect(r.bots[0]).toMatchObject({
      alive: true,
      procs: 1,
      peakProcs: 2,
      cycles: 10,
      deathCycle: null,
      deathReason: null,
    })
  })
})

describe('deaths (ISA §5.3)', () => {
  it('kills a bot that executes dat at cycle 0', () => {
    const rec = new Recorder()
    const b = new Battle([bot(LOOP, 'loop'), bot(DAT, 'dat')], {}, rec)
    const [l, d] = b.bots.map((x) => hex(x.base))
    const r = b.run()
    expect(rec.lines()).toEqual([
      `0 exec 0.0 ${l} 2`,
      `0 exec 1.0 ${d} 2`,
      `0 death 1.0 ${d} dat`,
      '0 botDead 1',
      '0 end',
    ])
    expect(r).toEqual({
      cycles: 1,
      survivors: [0],
      bots: [
        {
          name: 'loop',
          alive: true,
          points: 3,
          procs: 1,
          footprint: 2,
          cycles: 1,
          writes: 0,
          peakProcs: 1,
          deathCycle: null,
          deathReason: null,
        },
        {
          name: 'dat',
          alive: false,
          points: 0,
          procs: 0,
          footprint: 2,
          cycles: 1,
          writes: 0,
          peakProcs: 1,
          deathCycle: 0,
          deathReason: 'dat',
        },
      ],
    })
    expect([b.cycle, b.alive, b.over, b.bots[1]?.alive]).toEqual([1, 1, true, false])
  })

  it('kills bot 0 at cycle 0 too, before bot 1 runs', () => {
    const rec = new Recorder()
    const b = new Battle([bot(DAT), bot(LOOP)], {}, rec)
    const [d, l] = b.bots.map((x) => hex(x.base))
    expect((b.run() as Result).survivors).toEqual([1])
    expect(rec.lines()).toEqual([
      `0 exec 0.0 ${d} 2`,
      `0 death 0.0 ${d} dat`,
      '0 botDead 0',
      `0 exec 1.0 ${l} 2`,
      '0 end',
    ])
  })

  it('gives each killing instruction its reason, at its own address', () => {
    const killers: [Source, DeathReason, number][] = [
      [DAT, 'dat', 2],
      [HLT, 'hlt', 1],
      [INT3, 'int3', 1],
      [UNDEFINED, 'undefined', 1],
      [DIV, 'div', 2],
    ]
    for (const [source, reason, len] of killers) {
      const rec = new Recorder()
      const b = new Battle([bot(LOOP), bot(source)], {}, rec)
      const k = hex(b.bots[1]?.base as number)
      const r = b.run() as Result
      expect(rec.lines().slice(1, 4)).toEqual([
        `0 exec 1.0 ${k} ${len}`,
        `0 death 1.0 ${k} ${reason}`,
        '0 botDead 1',
      ])
      expect(r.bots[1]).toMatchObject({ alive: false, deathCycle: 0, deathReason: reason })
    }
  })

  it("kills a bot when another bombs its next instruction, in the cycle's turn order", () => {
    const seed = 5
    // Bomber first: it bombs in cycle 0 before the victim's turn.
    {
      const [bb, vb] = place([8, 2], 1024, new Pcg32(seed)) as [number, number]
      const rec = new Recorder()
      const b = new Battle([bot(bomber(vb), 'bomber'), bot(LOOP, 'victim')], { seed }, rec)
      expect(b.bots.map((x) => x.base)).toEqual([bb, vb])
      const r = b.run() as Result
      expect(rec.lines()).toEqual([
        `0 exec 0.0 ${hex(bb)} 6`,
        `0 write 0 ${hex(vb)} 2`,
        `0 exec 1.0 ${hex(vb)} 2`,
        `0 death 1.0 ${hex(vb)} dat`,
        '0 botDead 1',
        '0 end',
      ])
      expect([b.core.bytes[vb], b.core.bytes[(vb + 1) & 0xffff]]).toEqual([0, 0])
      expect(r.bots.map((x) => [x.points, x.writes, x.footprint])).toEqual([
        [3, 1, 10],
        [0, 0, 0],
      ])
    }
    // Victim first: it gets one more instruction, and dies in cycle 1.
    {
      const [vb, bb] = place([2, 8], 1024, new Pcg32(seed)) as [number, number]
      const rec = new Recorder()
      const b = new Battle([bot(LOOP, 'victim'), bot(bomber(vb), 'bomber')], { seed }, rec)
      const r = b.run() as Result
      expect(rec.lines()).toEqual([
        `0 exec 0.0 ${hex(vb)} 2`,
        `0 exec 1.0 ${hex(bb)} 6`,
        `0 write 1 ${hex(vb)} 2`,
        '0 end',
        `1 exec 1.0 ${at(bb, 6)} 2`,
        `1 exec 0.0 ${hex(vb)} 2`,
        `1 death 0.0 ${hex(vb)} dat`,
        '1 botDead 0',
        '1 end',
      ])
      expect([r.cycles, r.survivors, r.bots[0]?.deathCycle]).toEqual([2, [1], 1])
    }
  })

  it('leaves no survivors when every bot dies in the same cycle', () => {
    const r = new Battle([bot(DAT), bot(HLT), bot(INT3)]).run() as Result
    expect([r.cycles, r.survivors, r.bots.map((x) => x.points)]).toEqual([1, [], [0, 0, 0]])
  })
})

describe('ending (ISA §5.5)', () => {
  it('ends when maxCycles cycles have run', () => {
    const b = new Battle([bot(LOOP), bot(LOOP)], { maxCycles: 10 })
    const r = b.run() as Result
    expect([r.cycles, r.survivors, r.bots.map((x) => x.points)]).toEqual([10, [0, 1], [1, 1]])
    expect([b.cycle, b.over]).toEqual([10, true])
  })

  it('returns null from run until the battle is over, and never runs past the end', () => {
    const b = new Battle([bot(LOOP), bot(NOPS_THEN_DAT)], { maxCycles: 10 })
    expect(b.run(0)).toBeNull()
    expect(b.run(2)).toBeNull()
    expect([b.cycle, b.over]).toEqual([2, false])
    const r = b.run(100) as Result
    expect([r.cycles, b.cycle, r.survivors, r.bots[1]?.deathCycle]).toEqual([4, 4, [0], 3])
  })

  it('does nothing once over: step is a no-op, and run returns the result', () => {
    const rec = new Recorder()
    const b = new Battle([bot(IMP), bot(DAT)], {}, rec)
    const r = b.run() as Result
    const events = rec.events.length
    const bytes = b.core.bytes.slice()
    const owner = b.core.owner.slice()
    b.step()
    expect(b.run(5)).toEqual(r)
    expect(b.run()).toEqual(r)
    expect([b.cycle, rec.events.length]).toEqual([1, events])
    expect(b.core.bytes).toEqual(bytes)
    expect(b.core.owner).toEqual(owner)
  })

  it('runs a bot alone until it dies or maxCycles', () => {
    const lone = new Battle([bot(LOOP)], { maxCycles: 50 })
    expect([lone.over, lone.alive]).toEqual([false, 1])
    const r = lone.run() as Result
    expect([r.cycles, r.survivors, r.bots[0]?.points]).toEqual([50, [0], pmarsPoints(1, 1)])
    const doomed = new Battle([bot(NOPS_THEN_DAT)]).run() as Result
    expect([doomed.cycles, doomed.survivors, doomed.bots[0]?.deathCycle]).toEqual([4, [], 3])
  })

  it('is over at once with maxCycles 0', () => {
    const b = new Battle([bot(DAT), bot(DAT)], { maxCycles: 0 })
    expect(b.over).toBe(true)
    const r = b.run() as Result
    expect([r.cycles, r.survivors, r.bots.map((x) => x.points)]).toEqual([0, [0, 1], [1, 1]])
  })

  it('counts living bots and ends on the cycle that leaves one', () => {
    const b = new Battle([bot(NOPS_THEN_DAT), bot(LOOP), bot(DAT)])
    expect([b.alive, b.over]).toEqual([3, false])
    b.step()
    expect([b.alive, b.over]).toEqual([2, false])
    b.run(3)
    expect([b.cycle, b.alive, b.over]).toEqual([4, 1, true])
  })

  it('rejects a run of a negative or fractional count', () => {
    const b = new Battle([bot(LOOP)])
    for (const n of [-1, 1.5, Number.NaN, Number.NEGATIVE_INFINITY]) {
      expect(() => b.run(n)).toThrow(RangeError)
    }
    expect(b.cycle).toBe(0)
  })
})

describe('imp-style bots', () => {
  it('two identical movsb imps run to maxCycles and both survive', () => {
    const imp = bot(IMP, 'imp')
    const b = new Battle([imp, imp], { seed: 1 })
    const bytes = b.core.bytes.slice()
    const r = b.run() as Result
    expect([r.cycles, r.survivors]).toEqual([100_000, [0, 1]])
    // SI = DI, so every copy writes a byte back unchanged, but it takes the owner. Both bots
    // copy on even cycles, where bot 1 goes second, so 0x0000..0xC34F ends up bot 1's.
    expect(b.core.bytes).toEqual(bytes)
    const owner = new Uint8Array(65536)
    for (const x of b.bots) for (let k = 0; k < x.size; k++) owner[(x.base + k) & 0xffff] = x.tag
    owner.fill(2, 0, 50_000)
    expect(b.core.owner).toEqual(owner)
    const footprint = (tag: number) => owner.filter((o) => o === tag).length
    expect(r.bots).toEqual([
      {
        name: 'imp',
        alive: true,
        points: 1,
        procs: 1,
        footprint: footprint(1),
        cycles: 100_000,
        writes: 50_000,
        peakProcs: 1,
        deathCycle: null,
        deathReason: null,
      },
      {
        name: 'imp',
        alive: true,
        points: 1,
        procs: 1,
        footprint: footprint(2),
        cycles: 100_000,
        writes: 50_000,
        peakProcs: 1,
        deathCycle: null,
        deathReason: null,
      },
    ])
  })
})

describe('result and points (ISA §5.5)', () => {
  it('gives each survivor floor((N * N - 1) / S) points', () => {
    expect([pmarsPoints(2, 1), pmarsPoints(2, 2)]).toEqual([3, 1])
    expect([1, 2, 3, 4, 5].map((s) => pmarsPoints(5, s))).toEqual([24, 12, 8, 6, 4])
    expect([pmarsPoints(1, 1), pmarsPoints(3, 0), pmarsPoints(16, 1), pmarsPoints(16, 16)]).toEqual(
      [0, 0, 255, 15],
    )
  })

  it('scores N = 2: 3 for a sole survivor, 1 each for a tie, 0 for the dead', () => {
    const points = (a: Source, b: Source) =>
      (new Battle([bot(a), bot(b)], { maxCycles: 5 }).run() as Result).bots.map((x) => x.points)
    expect(points(LOOP, DAT)).toEqual([3, 0])
    expect(points(HLT, LOOP)).toEqual([0, 3])
    expect(points(LOOP, LOOP)).toEqual([1, 1])
    expect(points(DAT, DAT)).toEqual([0, 0])
  })

  it('scores N = 5 by the number of survivors', () => {
    for (let s = 1; s <= 5; s++) {
      // The survivors spread across the order: bots 0, 2, 4, 1, 3 in that order of survival.
      const lives = [0, 2, 4, 1, 3].slice(0, s)
      const bots = Array.from({ length: 5 }, (_, i) => bot(lives.includes(i) ? LOOP : DAT))
      const r = new Battle(bots, { maxCycles: 3 }).run() as Result
      expect(r.survivors).toEqual([...lives].sort())
      expect(r.bots.map((x) => x.points)).toEqual(
        bots.map((_, i) => (lives.includes(i) ? Math.floor(24 / s) : 0)),
      )
      expect(r.cycles).toBe(s === 1 ? 1 : 3)
    }
  })

  it('counts each REP iteration as one instruction and one write', () => {
    // The painter zeroes 0x0000..0x0005, so no image may sit near there.
    const seed = firstSeed((s) =>
      place([7, 2], 1024, new Pcg32(s)).every((base) => base >= 16 && base <= 0x10000 - 16),
    )
    const rec = new Recorder()
    const b = new Battle([bot(PAINTER, 'painter'), bot(LOOP, 'loop')], { seed, maxCycles: 8 }, rec)
    const p = b.bots[0]?.base as number
    const r = b.run() as Result
    const mine = rec.events.filter(
      ([kind, , x]) => x === 0 && (kind === 'exec' || kind === 'write'),
    )
    expect(mine.map(line)).toEqual([
      `0 exec 0.0 ${at(p, 0)} 3`,
      `1 exec 0.0 ${at(p, 3)} 2`,
      '1 write 0 0x0000 2',
      `2 exec 0.0 ${at(p, 3)} 2`,
      '2 write 0 0x0002 2',
      `3 exec 0.0 ${at(p, 3)} 2`,
      '3 write 0 0x0004 2',
      `4 exec 0.0 ${at(p, 5)} 2`,
      `5 exec 0.0 ${at(p, 5)} 2`,
      `6 exec 0.0 ${at(p, 5)} 2`,
      `7 exec 0.0 ${at(p, 5)} 2`,
    ])
    expect(r.bots.map((x) => [x.cycles, x.writes, x.footprint])).toEqual([
      [8, 3, 13],
      [8, 0, 2],
    ])
    expect(Array.from(b.core.owner.subarray(0, 7))).toEqual([1, 1, 1, 1, 1, 1, 0])
  })

  it('reports the standing so far before the end', () => {
    const b = new Battle([bot(LOOP), bot(NOPS_THEN_DAT), bot(LOOP)], { maxCycles: 10 })
    b.run(2)
    let r = b.result()
    expect([r.cycles, r.survivors, r.bots.map((x) => x.points)]).toEqual([2, [0, 1, 2], [2, 2, 2]])
    b.run(2)
    r = b.result()
    expect([r.cycles, r.survivors, r.bots.map((x) => x.points)]).toEqual([4, [0, 2], [4, 0, 4]])
    expect(b.run()).toEqual(b.result())
  })

  it('is plain data that survives structuredClone and JSON', () => {
    const r = new Battle([bot(STORM), bot(PAINTER), bot(DIV)], { maxCycles: 50 }).result()
    expect(structuredClone(r)).toEqual(r)
    expect(JSON.parse(JSON.stringify(r))).toEqual(r)
  })

  it('simulate runs a whole battle as a pure function', () => {
    const bots = [bot(PAINTER), bot(IMP), bot(STORM)]
    const config = { maxCycles: 500, seed: 9 }
    const r = simulate(bots, config)
    expect(r).toEqual(new Battle(bots, config).run() as Result)
    expect(simulate(bots, config)).toEqual(r)
    expect(r.cycles).toBe(500)
  })
})

/** A ring's records as events, oldest first. */
function records(ring: EventRing, kind: Kind): Event[] {
  const d = ring.drain()
  const out: Event[] = []
  for (let o = 0; o < d.length; o += ring.width) {
    const f = (k: number) => d[o + k] as number
    if (kind === 'exec') out.push(['exec', f(0), f(1), f(2), f(3), f(4)])
    else if (kind === 'write') out.push(['write', f(0), f(1), -1, f(2), f(3)])
    else if (kind === 'spawn') out.push(['spawn', f(0), f(1), f(2), f(3), -1])
    else if (kind === 'death')
      out.push(['death', f(0), f(1), f(2), f(3), DEATH_REASONS[f(4)] as string])
    else out.push(['botDead', f(0), f(1), -1, -1, -1])
  }
  return out
}

describe('events', () => {
  const bots = [bot(PAINTER), bot(STORM), bot(NOPS_THEN_DAT), bot(IMP), bot(SPAWN_THEN_DIE)]

  it('reach a RingSink as they reach any other sink', () => {
    const rec = new Recorder()
    const ring = new RingSink(4096)
    new Battle(bots, { maxCycles: 300 }, new Tee(rec, ring)).run()
    const only = (kind: Kind) => rec.events.filter(([k]) => k === kind)
    expect(records(ring.execs, 'exec')).toEqual(only('exec'))
    expect(records(ring.writes, 'write')).toEqual(only('write'))
    expect(records(ring.spawns, 'spawn')).toEqual(only('spawn'))
    expect(records(ring.deaths, 'death')).toEqual(only('death'))
    expect(records(ring.botDeaths, 'botDead')).toEqual(only('botDead'))
    expect(ring.lastCycle).toBe(299)
    expect(only('exec').length).toBeGreaterThan(1000)
    expect([EXEC_RECORD, WRITE_RECORD, SPAWN_RECORD, DEATH_RECORD, BOT_DEAD_RECORD]).toEqual([
      ring.execs.width,
      ring.writes.width,
      ring.spawns.width,
      ring.deaths.width,
      ring.botDeaths.width,
    ])
  })

  it("count only the bots' own writes, not a poke owned by nobody", () => {
    const rec = new Recorder()
    const b = new Battle([bot(IMP), bot(LOOP)], {}, rec)
    const base = b.bots[0]?.base as number
    // Pokes that keep the bytes, so the bots run as before.
    b.core.write8(base, b.core.bytes[base] as number, 0)
    b.core.write16(0x0000, b.core.read16(0x0000), 0)
    expect(rec.events).toEqual([])
    b.step()
    expect(rec.of('write')).toEqual(['0 write 0 0x0000 1'])
    expect(b.bots.map((x) => x.stats.writes)).toEqual([1, 0])
    expect([b.core.owner[base], b.core.owner[0], b.core.owner[1]]).toEqual([0, 1, 0])
  })

  it('go to whichever sink is set, and no sink changes the outcome', () => {
    const full = new Recorder()
    const a = new Battle(bots, { maxCycles: 30 }, full)
    const ra = a.run()
    const first = new Recorder()
    const last = new Recorder()
    const b = new Battle(bots, { maxCycles: 30 }, first)
    b.run(10)
    b.events = new NullSink()
    b.run(10)
    b.events = last
    expect(b.run()).toEqual(ra)
    expect(b.core.bytes).toEqual(a.core.bytes)
    expect(b.core.owner).toEqual(a.core.owner)
    expect(first.events).toEqual(full.events.filter(([, cycle]) => cycle < 10))
    expect(last.events).toEqual(full.events.filter(([, cycle]) => cycle >= 20))
    expect(new Battle(bots).events).toBeInstanceOf(NullSink)
  })
})

interface ModelProc {
  readonly id: number
  readonly row: Uint16Array
}

interface ModelBot {
  readonly tag: number
  readonly queue: ModelProc[]
  nextId: number
  cycles: number
  writes: number
  peakProcs: number
  deathCycle: number | null
  deathReason: DeathReason | null
}

/**
 * ISA §5.2 the plain way, to check `Battle` against: a queue is an array of register rows, and
 * a turn pops the front process, runs it with `execOne`, appends an SPL's child, and appends the
 * process again if it lives. Process ids count up per bot from 0.
 */
function model(bots: readonly LoadedBot[], config: BattleConfig) {
  const core = new Core()
  const fetcher = new Fetcher(core)
  const ctx = new ExecContext()
  const events: Event[] = []
  const bases = place(
    bots.map((b) => b.bytes.length),
    config.minSpacing,
    new Pcg32(config.seed),
  )
  const ms: ModelBot[] = bots.map((b, i) => {
    const base = bases[i] as number
    core.fill(base, b.bytes, i + 1)
    const row = new Uint16Array(10)
    row[IP] = base
    row[SP] = base
    row[FLAGS] = FLAGS_INIT
    return {
      tag: i + 1,
      queue: [{ id: 0, row }],
      nextId: 1,
      cycles: 0,
      writes: 0,
      peakProcs: 1,
      deathCycle: null,
      deathReason: null,
    }
  })
  let cycle = 0
  core.onWrite = (addr, len, owner) => {
    ;(ms[owner - 1] as ModelBot).writes++
    events.push(['write', cycle, owner - 1, -1, addr, len])
  }
  const n = bots.length
  const living = () => ms.filter((m) => m.queue.length > 0).length
  const over = () => cycle >= config.maxCycles || living() <= (n > 1 ? 1 : 0)
  // execOne reads the queue only for the SPL cap, and it counts the running process.
  const seen = { size: 0, capacity: config.maxProcesses }
  while (!over()) {
    for (let k = 0; k < n; k++) {
      const i = (cycle + k) % n
      const m = ms[i] as ModelBot
      const p = m.queue.shift()
      if (p === undefined) continue
      const ip = p.row[IP] as number
      const instr = fetcher.fetch(ip)
      m.cycles++
      events.push(['exec', cycle, i, p.id, ip, instr === undefined ? 1 : instr.length])
      seen.size = m.queue.length + 1
      const out = execOne(
        { tag: m.tag, queue: seen as unknown as ProcQueue },
        p.row,
        core,
        instr,
        ctx,
      )
      if (out === EXEC_KILLED) {
        events.push(['death', cycle, i, p.id, ip, ctx.reason])
        if (m.queue.length === 0) {
          m.deathCycle = cycle
          m.deathReason = ctx.reason
          events.push(['botDead', cycle, i, -1, -1, -1])
        }
        continue
      }
      if (out === EXEC_SPAWN) {
        const child = { id: m.nextId++, row: p.row.slice() }
        child.row[IP] = ctx.target
        m.queue.push(child)
        events.push(['spawn', cycle, i, child.id, ctx.target, -1])
      }
      m.queue.push(p)
      m.peakProcs = Math.max(m.peakProcs, m.queue.length)
    }
    events.push(['end', cycle, -1, -1, -1, -1])
    cycle++
  }
  const owned = new Array<number>(256).fill(0)
  for (const t of core.owner) owned[t] = (owned[t] as number) + 1
  const survivors = ms.flatMap((m, i) => (m.queue.length > 0 ? [i] : []))
  const points = survivors.length > 0 ? Math.floor((n * n - 1) / survivors.length) : 0
  const result: Result = {
    cycles: cycle,
    survivors,
    bots: ms.map((m, i) => ({
      name: (bots[i] as LoadedBot).name,
      alive: m.queue.length > 0,
      points: m.queue.length > 0 ? points : 0,
      procs: m.queue.length,
      footprint: owned[m.tag] as number,
      cycles: m.cycles,
      writes: m.writes,
      peakProcs: m.peakProcs,
      deathCycle: m.deathCycle,
      deathReason: m.deathReason,
    })),
  }
  return { events, core, bots: ms, result }
}

/**
 * Random code of exactly `size` bytes (9..64): instructions that spawn, jump, loop, write, and
 * kill, many of them aimed at the bots' images, ending in a jump back to the start.
 */
function randomProgram(rng: Pcg32, size: number, bases: readonly number[]): number[] {
  const pick = <T>(xs: readonly T[]): T => xs[rng.nextInt(xs.length)] as T
  const target = () => ((bases[rng.nextInt(bases.length)] as number) + rng.nextInt(24)) & 0xffff
  const word = (v: number) => [v & 0xff, v >> 8]
  // Words to bomb with: dat, `jmp short $`, `spl $`, two nops.
  const bomb = () => pick([0x0000, 0xfeeb, 0xfe60, 0x9090])
  const templates: (() => number[])[] = [
    () => [0x60, (rng.nextInt(20) - 8) & 0xff], // spl $ + k
    () => [0x60, (rng.nextInt(20) - 8) & 0xff],
    () => [0xeb, (rng.nextInt(20) - 14) & 0xff], // jmp short $ + k
    () => [0xbf, ...word(target())], // mov di, target
    () => [0xbe, ...word(target())], // mov si, target
    () => [0xb9, 1 + rng.nextInt(6), 0x00], // mov cx, k
    () => [0xb8, ...word(bomb())], // mov ax, word
    () => [pick([0xa4, 0xa5, 0xaa, 0xab])], // movsb movsw stosb stosw
    () => [0xf3, pick([0xa4, 0xa5, 0xaa, 0xab])], // rep ...
    () => [0xc7, 0x06, ...word(target()), ...word(bomb())], // mov word [target], word
    () => [0x47], // inc di
    () => [0x83, 0xc7, rng.nextInt(12)], // add di, k
    () => [0xe2, (rng.nextInt(12) - 10) & 0xff], // loop $ + k
    () => [0x90], // nop
    () => [0xe8, 0x00, 0x00, 0x5b], // call $ + 3; pop bx
    () => [0x62, 0xc3], // spl bx
    () => pick([[0x00, 0x00], [0xf4], [0xcc], [0x0f], [0xf6, 0xf0]]), // dat hlt int3 db div
  ]
  const out: number[] = []
  for (;;) {
    const next = pick(templates)()
    if (out.length + next.length > size - 2) break
    out.push(...next)
  }
  while (out.length < size - 2) out.push(0x90)
  out.push(0xeb, -size & 0xff)
  return out
}

/**
 * Checks the battle's events against the model's: the same events in order, and each process
 * one row for its whole life, a row no live process holds. Returns model id → row per bot.
 */
function sameEvents(got: readonly Event[], want: readonly Event[], n: number): Map<string, number> {
  const rowOf = new Map<string, number>()
  const liveRows = new Set<string>()
  for (let b = 0; b < n; b++) {
    rowOf.set(`${b}:0`, 0)
    liveRows.add(`${b}:0`)
  }
  for (let i = 0; i < Math.max(got.length, want.length); i++) {
    const g = got[i]
    const w = want[i]
    if (g === undefined || w === undefined) {
      expect([i, g && line(g)]).toEqual([i, w && line(w)])
      return rowOf
    }
    const [kind, cycle, b, row, addr, extra] = g
    if (kind !== w[0] || cycle !== w[1] || b !== w[2] || addr !== w[4] || extra !== w[5]) {
      expect([i, line(g)]).toEqual([i, line(w)])
    }
    const id = `${b}:${w[3]}`
    if (kind === 'spawn') {
      if (liveRows.has(`${b}:${row}`)) throw new Error(`event ${i}: spawn into live row ${row}`)
      rowOf.set(id, row)
      liveRows.add(`${b}:${row}`)
    } else if (kind === 'exec' || kind === 'death') {
      if (rowOf.get(id) !== row) throw new Error(`event ${i}: process ${id} is not row ${row}`)
      if (kind === 'death') {
        rowOf.delete(id)
        liveRows.delete(`${b}:${row}`)
      }
    }
  }
  return rowOf
}

describe('the battle loop against a plain model of ISA §5.2', () => {
  it('matches on 200 random battles: events, queues, core, and result', () => {
    const rng = new Pcg32(20260923, 4)
    const seen = {
      spawns: 0,
      capped: 0,
      deaths: 0,
      botDeaths: 0,
      byCycles: 0,
      byDeaths: 0,
      lone: 0,
    }
    const reasons = new Set<string>()
    for (let t = 0; t < 200; t++) {
      const n = 1 + rng.nextInt(6)
      const config: BattleConfig = {
        ...DEFAULT_CONFIG,
        seed: rng.next(),
        maxCycles: 50 + rng.nextInt(1500),
        maxProcesses: [1, 2, 3, 8, 64][rng.nextInt(5)] as number,
        minSpacing: [0, 16, 64, 1024][rng.nextInt(4)] as number,
      }
      const sizes = Array.from({ length: n }, () => 9 + rng.nextInt(56))
      const bases = place(sizes, config.minSpacing, new Pcg32(config.seed))
      const bots = sizes.map((size, i) => ({
        name: `r${i}`,
        bytes: Uint8Array.from(randomProgram(rng, size, bases)),
      }))
      const rec = new Recorder()
      const battle = new Battle(bots, config, rec)
      const result = battle.run()
      const want = model(bots, battle.config)
      const rowOf = sameEvents(rec.events, want.events, n)
      expect(result).toEqual(want.result)
      expect([battle.cycle, battle.alive, battle.over]).toEqual([
        want.result.cycles,
        want.result.survivors.length,
        true,
      ])
      expect(battle.core.bytes).toEqual(want.core.bytes)
      expect(battle.core.owner).toEqual(want.core.owner)
      battle.bots.forEach((x, i) => {
        const queue = (want.bots[i] as ModelBot).queue
        expect(queue.map((p) => rowOf.get(`${i}:${p.id}`))).toEqual(
          queue.map((_, k) => x.queue.at(k)),
        )
        expect(queue.map((p) => Array.from(p.row))).toEqual(
          queue.map((_, k) => Array.from(x.queue.rows[x.queue.at(k)] as Uint16Array)),
        )
      })
      for (const [kind, , , , , extra] of want.events) {
        if (kind === 'spawn') seen.spawns++
        if (kind === 'death') {
          seen.deaths++
          reasons.add(extra as string)
        }
        if (kind === 'botDead') seen.botDeaths++
      }
      if (want.result.bots.some((x) => x.peakProcs === config.maxProcesses && x.peakProcs > 1)) {
        seen.capped++
      }
      if (want.result.cycles === config.maxCycles) seen.byCycles++
      else seen.byDeaths++
      if (n === 1) seen.lone++
    }
    // The random battles reach every path of the loop.
    for (const [path, count] of Object.entries(seen))
      expect([path, count > 0]).toEqual([path, true])
    expect([...reasons].sort()).toEqual(['dat', 'div', 'hlt', 'int3', 'undefined'])
  })
})
