/**
 * The strategy guide (EXEC 2.6 task 4) against the engine: each roster bot on a page is the
 * roster's file, each other bot is lint-clean, every record table is fought again, and each thing
 * a page says a bot does (a lap time, a death, a fang, a standings table, what a "try" edit
 * changes) is run here. Edit a page, a roster bot, or the engine, and this says whether the words
 * still hold.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { type Assembled, assemble, disassemble, lint } from '@asmbots/asm'
import { fighter, HILL_RULES, loadRoster, ROSTER } from '@asmbots/bots'
import {
  Battle,
  type BattleConfigInput,
  type DeathReason,
  type LoadedBot,
  NullSink,
  pmarsPoints,
  simulate,
} from '@asmbots/engine'
import { melee, roundRobin } from '@asmbots/tourney'

const DOCS_DIR = new URL('../src/docs/', import.meta.url).pathname

const PAGES = [
  'strategy/imps',
  'strategy/dwarves',
  'strategy/stones',
  'strategy/papers',
  'strategy/scanners',
  'strategy/vampires',
  'strategy/imp-gates',
  'strategy/stack-tricks',
  'strategy/hygiene',
  'strategy/melee',
  'strategy/hill-meta',
]

const mdx = (page: string): string => readFileSync(`${DOCS_DIR}${page}.mdx`, 'utf8')

/** The page's fenced x16c blocks: each one's meta and source. */
function blocks(page: string): { meta: string; source: string }[] {
  return [...mdx(page).matchAll(/^```asm ?([^\n]*)\n([\s\S]*?)^```$/gm)].map((m) => ({
    meta: m[1] as string,
    source: m[2] as string,
  }))
}

const nameOf = (source: string): string | undefined => /%name\s+"([^"]+)"/.exec(source)?.[1]

/** The whole bot named `name` on `page`. */
function pageBot(page: string, name: string): string {
  const found = blocks(page).find((b) => nameOf(b.source) === name)
  if (found === undefined) throw new Error(`no bot "${name}" on ${page}`)
  return found.source
}

const src = (slug: string): string => loadRoster().get(slug)?.source ?? ''

function build(source: string): Assembled {
  const assembled = assemble(source)
  expect(assembled.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  return assembled
}

const load = (source: string): LoadedBot => {
  const assembled = build(source)
  return { name: assembled.name, bytes: assembled.bytes }
}

/** `source` with `from` swapped for `to`, which must be there. */
function edit(source: string, from: string, to: string): string {
  expect(source).toContain(from)
  return source.replace(from, to)
}

/** A bot as a page names it: a roster slug, or the source of a bot. */
type Fighter = string

const botOf = (f: Fighter): LoadedBot => (f.includes('\n') ? load(f) : fighter(f))

/**
 * The record of `a` against `b`, seeds 1..n at hill rules, from `a`'s side: `a` goes first at
 * seed 1, and the order swaps each seed, as a match of two bots rotates it.
 */
function record(a: Fighter, b: Fighter, n = 20): string {
  const bots = [botOf(a), botOf(b)]
  let wins = 0
  let ties = 0
  let losses = 0
  for (let seed = 1; seed <= n; seed++) {
    const us = (seed - 1) % 2
    const { survivors } = simulate(us === 0 ? bots : [...bots].reverse(), { ...HILL_RULES, seed })
    if (!survivors.includes(us)) losses++
    else if (survivors.length === 1) wins++
    else ties++
  }
  return `${wins} W / ${ties} T / ${losses} L`
}

/** Collects the cycles in which a process runs the instruction at `addr`. */
class Visits extends NullSink {
  readonly at: number[] = []
  constructor(readonly addr: number) {
    super()
  }
  override exec(cycle: number, _bot: number, _proc: number, addr: number): void {
    if (addr === this.addr) this.at.push(cycle)
  }
}

/** Where the loader puts `source` alone at `seed`. */
const baseOf = (source: string, seed: number): number =>
  (new Battle([load(source)], { seed }).bots[0] as { base: number }).base

/** The cycles in which `source`, alone at `seed`, runs its `label`, in the first `cycles`. */
function visits(source: string, label: string, cycles: number, seed = 1): number[] {
  const offset = build(source).symbols.get(label)
  if (offset === undefined) throw new Error(`no label ${label}`)
  const sink = new Visits((baseOf(source, seed) + offset) & 0xffff)
  new Battle([load(source)], { seed, maxCycles: cycles }, sink).run()
  return sink.at
}

/** A lap: the cycles between the first two visits of `label`. */
function lap(source: string, label: string, cycles: number): number {
  const [first, second] = visits(source, label, cycles)
  expect(second).toBeDefined()
  return (second as number) - (first as number)
}

/** Keeps the spawns and the deaths of a battle. */
class Log extends NullSink {
  readonly spawns: { cycle: number; addr: number }[] = []
  readonly deaths: { cycle: number; addr: number; reason: DeathReason }[] = []
  override spawn(cycle: number, _bot: number, _proc: number, addr: number): void {
    this.spawns.push({ cycle, addr })
  }
  override death(cycle: number, _b: number, _p: number, addr: number, reason: DeathReason): void {
    this.deaths.push({ cycle, addr, reason })
  }
}

/** `source` alone at seed 1 for `cycles` cycles. */
function alone(source: string, cycles: number, config: BattleConfigInput = {}) {
  const log = new Log()
  const battle = new Battle([load(source)], { seed: 1, maxCycles: cycles, ...config }, log)
  battle.run()
  return { battle, log, base: battle.bots[0]?.base as number }
}

const n = (text: string): number => Number(text.replace(/,/g, ''))

// The edits the pages' "try" notes and variant rows describe.
const RING7 = edit(
  edit(src('imp-ring'), 'THIRD   equ     21846', 'THIRD   equ     8192'),
  'mov     cx, 2 ',
  'mov     cx, 7 ',
)
const DWARF_FREE = edit(
  src('dwarf'),
  'loop    .bomb                   ; the jmp back, counting the lap down',
  'jmp     .bomb',
)
const dwarfStride = (s: number) => edit(src('dwarf'), 'STRIDE  equ     4 ', `STRIDE  equ     ${s} `)
const STONE_NO_SPARSE = edit(src('stone'), '        spl     sparse\n', '')
const STONE_NO_DECOY = edit(
  src('stone'),
  '        spl     si                      ; the imp gets these si and di\n',
  '',
)
const PAPER_EARLY = edit(
  edit(src('paper'), '        spl     dx\n', ''),
  '        rep     movsw\n',
  '        spl     dx\n        rep     movsw\n',
)
const PAPER_NO_BOMB = edit(
  src('paper'),
  '        mov     word [di+STEP/2], 0     ; the occasional bomb\n',
  '',
)
const SCANNER_NO_SKIP = edit(src('scanner'), 'jae     bomb', 'jmp     bomb')
const VAMPIRE_OPEN = edit(
  src('vampire'),
  '        mov     word [bx+pit.hold], 0   ; and so is the pit: its loop is DAT from now on\n',
  '',
)
const GATE_NO_GATE = edit(src('gate'), '        spl     bomb\n', '        jmp     bomb\n')
const GATE_ONE = edit(src('gate'), 'times   8 dec', 'times   1 dec')
const decoyNoise = (bytes: number) =>
  edit(src('decoy'), 'NOISE   equ     1024', `NOISE   equ     ${bytes}`)
const PUSHER = pageBot('strategy/stack-tricks', 'Pusher')
const PUSHER_ONE = edit(PUSHER, 'WORDS   equ     8 ', 'WORDS   equ     1 ')

/** The bots of record rows that are neither a roster slug nor a bot on the page. */
const VARIANTS: Readonly<Record<string, string>> = {
  'Decoy, no noise': decoyNoise(0),
  'Decoy, 4 KB': decoyNoise(4096),
}

const SLUGS = new Set(ROSTER.map((r) => r.slug))

describe('the bots on the strategy pages', () => {
  it('are the roster files, word for word, when they carry a roster name', () => {
    const byName = new Map(ROSTER.map((r) => [r.name, r.slug]))
    let roster = 0
    for (const page of PAGES) {
      for (const { meta, source } of blocks(page)) {
        if (meta.includes('fragment')) continue
        const slug = byName.get(nameOf(source) ?? '')
        if (slug === undefined) continue
        roster++
        expect({ page, slug, source }).toEqual({ page, slug, source: src(slug) })
      }
    }
    expect(roster).toBeGreaterThanOrEqual(PAGES.length)
  })

  it('are lint-clean, and each whole bot opens in the arena against roster bots', () => {
    for (const page of PAGES) {
      for (const { meta, source } of blocks(page)) {
        if (meta.includes('fragment')) continue
        const assembled = build(source)
        expect({
          page,
          name: assembled.name,
          codes: lint(source, assembled).map((d) => d.code),
        }).toEqual({ page, name: assembled.name, codes: [] })
        const rivals = /run="vs=([^" ]+)/.exec(meta)?.[1]?.split(',') ?? []
        expect({ page, name: assembled.name, fights: rivals.length > 0 }).toEqual({
          page,
          name: assembled.name,
          fights: true,
        })
        for (const slug of rivals) expect(SLUGS.has(slug)).toBe(true)
      }
    }
  })

  it('each page has one or more whole bots and a "Try" note', () => {
    for (const page of PAGES) {
      expect({ page, bots: blocks(page).some((b) => !b.meta.includes('fragment')) }).toEqual({
        page,
        bots: true,
      })
      expect({ page, tries: /<Note>\s+Try /.test(mdx(page)) }).toEqual({ page, tries: true })
    }
  })
})

describe('the record tables', () => {
  const rows: { page: string; a: string; b: string; seeds: number; want: string }[] = []
  for (const page of PAGES) {
    let seeds = 0
    for (const line of mdx(page).split('\n')) {
      const header = /^\| seeds 1\.\.(\d+), hill rules \| record \|$/.exec(line)
      if (header !== null) seeds = Number(header[1])
      const row = /^\| `([^`]+)` vs `([^`]+)` \| (\d+ W \/ \d+ T \/ \d+ L) \|$/.exec(line)
      if (row !== null) {
        expect({ page, line, seeds: seeds > 0 }).toEqual({ page, line, seeds: true })
        rows.push({ page, a: row[1] as string, b: row[2] as string, seeds, want: row[3] as string })
      }
    }
  }

  /** A row's bot: a roster slug, a variant, or a bot on the page by its `%name`. */
  const resolve = (page: string, name: string): Fighter =>
    SLUGS.has(name) ? name : (VARIANTS[name] ?? pageBot(page, name))

  it('are on the pages', () => {
    expect(rows.length).toBeGreaterThan(40)
  })

  for (const { page, a, b, seeds, want } of rows) {
    it(`${page}: ${a} vs ${b}, seeds 1..${seeds}: ${want}`, () => {
      expect(record(resolve(page, a), resolve(page, b), seeds)).toBe(want)
    })
  }
})

describe('imps', () => {
  it('eight imps an eighth of the core apart fight the dwarf and the gate better', () => {
    expect(build(RING7).diagnostics).toEqual([])
    expect(record(RING7, 'dwarf')).toBe('5 W / 7 T / 8 L')
    expect(record(RING7, 'gate')).toBe('1 W / 11 T / 8 L')
    const note = mdx('strategy/imps')
    expect(note).toContain('from 3 W / 5 T / 12 L to 5 W / 7 T / 8 L')
    expect(note).toContain('from 0 W / 3 T / 17 L to 1 W / 11 T / 8 L')
  })

  it("the ring's three imps each run every third cycle", () => {
    const counts = new Map<number, number>()
    const sink = new (class extends NullSink {
      override exec(cycle: number, _bot: number, proc: number): void {
        if (cycle >= 1000 && cycle < 1300) counts.set(proc, (counts.get(proc) ?? 0) + 1)
      }
    })()
    new Battle([fighter('imp-ring')], { seed: 1, maxCycles: 1300 }, sink).run()
    expect([...counts.values()]).toEqual([100, 100, 100])
  })
})

describe('dwarves', () => {
  it('the stride table: a lap of the dwarf loop at each stride, and what it can miss', () => {
    const rows = [
      ...mdx('strategy/dwarves').matchAll(/^\| (\d) \| ([^|]+) \| ([^|]+) \| ([\d,]+) \|$/gm),
    ]
    expect(rows.map((r) => Number(r[1]))).toEqual([2, 3, 4, 5, 8])
    for (const [, stride, , miss, cycles] of rows) {
      const s = Number(stride)
      expect({ s, lap: lap(dwarfStride(s), 'lap', 250_000) }).toEqual({
        s,
        lap: n(cycles as string),
      })
      const missable = s - 2
      expect(miss).toStartWith(missable === 0 ? 'none' : `${missable} byte`)
    }
    expect(HILL_RULES.maxCycles).toBe(80_000)
  })

  it('without the lap counter, the dwarf bombs its own code in cycle 49,142', () => {
    expect(lint(DWARF_FREE, build(DWARF_FREE)).map((d) => d.code)).toEqual(['unreachable'])
    const { log, base } = alone(DWARF_FREE, 100_000)
    const [death] = log.deaths
    expect(death?.cycle).toBe(49_142)
    expect(death?.reason).toBe('dat')
    expect(((death?.addr as number) - base) & 0xffff).toBeLessThan(build(DWARF_FREE).bytes.length)
    expect(mdx('strategy/dwarves')).toContain('dies with `dat` in cycle 49,142')
  })

  it('Stride 32 is 19 bytes and never bombs itself', () => {
    const s32 = pageBot('strategy/dwarves', 'Stride 32')
    expect(build(s32).bytes.length).toBe(19)
    const { battle, log } = alone(s32, 300_000)
    expect(log.deaths).toEqual([])
    expect(battle.result().cycles).toBe(300_000)
    expect(build(src('dwarf')).bytes.length).toBe(23)
  })
})

describe('stones', () => {
  it('a bomb from a register is 2 or 3 bytes, an immediate one 4', () => {
    const bytesOf = (line: string) => build(`%name "x"\n${line}`).bytes.length
    expect(bytesOf('mov [di], ax')).toBe(2)
    expect(bytesOf('mov [di-44], ax')).toBe(3)
    expect(bytesOf('mov word [di], 0')).toBe(4)
    expect(build('%name "x"\nmov [di], ax').listing.find((l) => l.bytesHex)?.bytesHex).toBe('89 05')
  })

  it("alone at seed 1: the bombers' first laps, the decoy's death, and the header's 27,000", () => {
    expect(lap(src('stone'), 'sparse', 60_000)).toBe(23_749)
    expect(lap(src('stone'), 'dense', 120_000)).toBe(54_997)
    const laps = build(src('stone')).symbols.get('LAPS') as number
    expect(Math.abs((3 + 6 * laps) * 3 - 27_000)).toBeLessThan(500)
    const { log } = alone(src('stone'), 23_749)
    expect(log.deaths.length).toBeGreaterThan(0)
    expect(build(src('scanner')).bytes.length).toBe(43)
    const page = mdx('strategy/stones')
    expect(page).toContain("first lap takes 23,749 cycles and the dense bomber's 54,997")
  })

  it('without the sparse bomber, or without the decoy, against the imp', () => {
    expect(record(STONE_NO_SPARSE, 'imp')).toBe('12 W / 8 T / 0 L')
    expect(record(STONE_NO_DECOY, 'imp')).toBe('17 W / 3 T / 0 L')
  })
})

describe('papers', () => {
  it('paper spawns first in cycle 26 and fills its 64 slots after 2,026 cycles; silk 2,213', () => {
    const full = (slug: string) => {
      const log = new Log()
      const battle = new Battle([fighter(slug)], { seed: 1 }, log)
      for (let cycles = 1; cycles <= 5000; cycles++) {
        battle.run(1)
        if (battle.bots[0]?.queue.size === 64) return { first: log.spawns[0]?.cycle, cycles }
      }
      return null
    }
    expect(full('paper')).toEqual({ first: 26, cycles: 2026 })
    expect(full('silk')?.cycles).toBe(2213)
    expect(build(src('paper')).bytes.length).toBe(34)
  })

  it('spl before rep movsw: each child runs empty core and dies', () => {
    const { battle, log } = alone(PAPER_EARLY, 2000)
    expect(log.spawns[0]?.cycle).toBe(9)
    expect(log.deaths[0]).toMatchObject({ cycle: 10, reason: 'dat' })
    expect(battle.bots[0]?.queue.size).toBe(1)
    expect(record(PAPER_EARLY, 'dwarf')).toBe('7 W / 0 T / 13 L')
  })
})

describe('scanners', () => {
  it('without the self-skip, the scanner carpets itself in cycle 65,497', () => {
    expect(lint(SCANNER_NO_SKIP, build(SCANNER_NO_SKIP)).map((d) => d.code)).toContain(
      'unreachable',
    )
    const { log, base } = alone(SCANNER_NO_SKIP, 100_000)
    expect(log.deaths[0]).toMatchObject({ cycle: 65_497, reason: 'undefined' })
    expect(((log.deaths[0]?.addr as number) - base) & 0xffff).toBeLessThan(43)
    expect(alone(src('scanner'), 200_000).log.deaths).toEqual([])
  })
})

describe('vampires', () => {
  it('a fang is E9 and the distance from its end to the pit', () => {
    const vampire = fighter('vampire')
    const pit = build(src('vampire')).symbols.get('pit') as number
    let fang = -1
    const sink = new (class extends NullSink {
      core: Battle['core'] | null = null
      override write(_cycle: number, bot: number, addr: number, len: number): void {
        if (fang < 0 && bot === 0 && len === 2 && this.core?.read8(addr - 1) === 0xe9) {
          fang = (addr - 1) & 0xffff
        }
      }
    })()
    const battle = new Battle([vampire, fighter('dwarf')], { ...HILL_RULES, seed: 1 }, sink)
    sink.core = battle.core
    while (fang < 0 && !battle.over) battle.run(1)
    expect(fang).toBeGreaterThanOrEqual(0)
    const bytes = new Uint8Array([0, 1, 2].map((i) => battle.core.read8(fang + i)))
    const target = ((battle.bots[0]?.base as number) + pit) & 0xffff
    const hex = target.toString(16).toUpperCase().padStart(4, '0')
    expect(disassemble(bytes, fang)[0]?.text).toBe(`jmp 0x${hex}`)
  })

  it('a pit that never closes turns wins into ties', () => {
    expect(record(VAMPIRE_OPEN, 'dwarf')).toBe('12 W / 4 T / 4 L')
    expect(record(VAMPIRE_OPEN, 'paper')).toBe('0 W / 12 T / 8 L')
  })
})

describe('imp gates', () => {
  it('the gate is 3-byte decs, and a dec turns an imp word into movsb or an undefined pop', () => {
    const gate = build(src('gate'))
    const decs = gate.listing.filter((l) => /dec\s+word/.test(l.source))
    expect(build('%name "x"\ndec word [bx-16]').bytes.length).toBe(3)
    expect(gate.bytes.length).toBeGreaterThan(24)
    expect(decs.length).toBeGreaterThan(0)
    const dis = (bytes: number[]) =>
      disassemble(new Uint8Array(bytes), 0).map((d) => [d.text, d.kind])
    expect(dis([0xa4, 0x90])).toEqual([
      ['movsb', 'instr'],
      ['nop', 'instr'],
    ])
    expect(dis([0x8f, 0xa5])[0]).toEqual(['db 0x8F', 'undefined'])
    expect(((0x90a5 - 1) & 0xffff).toString(16)).toBe('90a4')
    expect(((0xa590 - 1) & 0xffff).toString(16)).toBe('a58f')
  })

  it('without the gate process, or with a slower gate', () => {
    expect(record(GATE_NO_GATE, 'imp')).toBe('15 W / 5 T / 0 L')
    expect(record(GATE_NO_GATE, 'imp-ring')).toBe('9 W / 5 T / 6 L')
    expect(record(GATE_ONE, 'imp')).toBe('18 W / 2 T / 0 L')
  })
})

describe('stack tricks', () => {
  it('the base idiom leaves base + 3 at base - 2, and the first push zeros it', () => {
    const imp = new Battle([fighter('imp')], { seed: 1 })
    imp.run(2)
    const base = imp.bots[0]?.base as number
    const word = (b: Battle, at: number) => b.core.read8(at) | (b.core.read8(at + 1) << 8)
    expect(word(imp, base - 2)).toBe((base + 3) & 0xffff)
    const pusher = new Battle([load(PUSHER)], { seed: 1 })
    pusher.run(7)
    expect(word(pusher, (pusher.bots[0]?.base as number) - 2)).toBe(0)
  })

  it("Pusher's lap: 36,849 cycles, 65,504 bytes, all but its body and the 6 over it", () => {
    expect(build(PUSHER).bytes.length).toBe(26)
    expect(lap(PUSHER, 'lap', 80_000)).toBe(36_849)
    const written = new Set<number>()
    const sink = new (class extends NullSink {
      override write(cycle: number, _bot: number, addr: number, len: number): void {
        if (cycle > 36_852) return
        for (let i = 0; i < len; i++) written.add((addr + i) & 0xffff)
      }
    })()
    const battle = new Battle([load(PUSHER)], { seed: 1, maxCycles: 36_853 }, sink)
    battle.run()
    const base = battle.bots[0]?.base as number
    expect(written.size).toBe(65_504)
    for (let i = 0; i < 32; i++) expect(written.has((base + i) & 0xffff)).toBe(false)
  })

  it('one push a pass: a lap of 65,519 cycles, and imps that live', () => {
    expect(lap(PUSHER_ONE, 'lap', 150_000)).toBe(65_519)
    expect(record(PUSHER_ONE, 'imp')).toBe('16 W / 4 T / 0 L')
  })

  it('push sp pushes the decremented sp', () => {
    const bot = load('%name "x"\n        push    sp\n        jmp     $')
    const battle = new Battle([bot], { seed: 1 })
    battle.run(1)
    const base = battle.bots[0]?.base as number
    const pushed = battle.core.read8(base - 2) | (battle.core.read8(base - 1) << 8)
    expect(pushed).toBe((base - 2) & 0xffff)
  })
})

describe('hygiene', () => {
  it('the noise costs 1,024 turns: the first bomb lap starts in cycle 9 + 1,024', () => {
    expect(visits(src('decoy'), 'lap', 2000)[0]).toBe(9 + 1024)
  })
})

describe('melee', () => {
  const standings = (bots: Fighter[]) =>
    melee(bots.map(botOf), { ...HILL_RULES, seed: 1 }, 20).standings.map((s) => [
      s.name,
      s.points,
      s.wins,
      s.ties,
      s.losses,
    ])

  it('the scoring table is pMARS scoring', () => {
    const rows = [...mdx('strategy/melee').matchAll(/^\| (\d) \| (\d+) \| (\d+) \|$/gm)]
    expect(rows).toHaveLength(4)
    for (const [, s, four, eight] of rows) {
      expect([Number(four), Number(eight)]).toEqual([
        pmarsPoints(4, Number(s)),
        pmarsPoints(8, Number(s)),
      ])
    }
  })

  it('the melee table, and the vampire whose pit never closes', () => {
    const table = [
      ...mdx('strategy/melee').matchAll(
        /^\| ([A-Z][a-z]+) \| (\d+) \| (\d+) \| (\d+) \| (\d+) \|$/gm,
      ),
    ].map((r) => [r[1], ...r.slice(2).map(Number)])
    expect(standings(['vampire', 'dwarf', 'stone', 'paper'])).toEqual(table)
    const open = standings([VAMPIRE_OPEN, 'dwarf', 'stone', 'paper'])
    expect(open.find((s) => s[0] === 'Vampire')).toEqual(['Vampire', 45, 0, 9, 11])
  })
})

describe('hill meta', () => {
  const fighters = ROSTER.filter((r) => r.family !== 'painter' && r.family !== 'test').map(
    (r) => r.slug as Fighter,
  )
  const field = (bots: Fighter[]) =>
    roundRobin(bots.map(botOf), { ...HILL_RULES, seed: 1 }, { rounds: 10 })

  it('the roster round robin, and where paper and the vampire took their points', () => {
    const page = mdx('strategy/hill-meta')
    const result = field(fighters)
    const table = [
      ...page.matchAll(/^\| ([A-Z][A-Za-z ]+) \| (\d+) \| (\d+) \| (\d+) \| (\d+) \|$/gm),
    ].map((r) => [r[1], ...r.slice(2).map(Number)])
    expect(fighters).toHaveLength(12)
    expect(result.standings.map((s) => [s.name, s.points, s.wins, s.ties, s.losses])).toEqual(table)

    const names = fighters.map((slug) => fighter(slug).name)
    const scores = (who: string) => {
      const me = names.indexOf(who)
      const out = new Map<string, string>()
      result.schedule.forEach((spec, i) => {
        const at = spec.entrants.indexOf(me)
        if (at < 0) return
        const points = result.matches[i]?.points as readonly number[]
        out.set(names[spec.entrants[1 - at] as number] as string, `${points[at]}-${points[1 - at]}`)
      })
      return out
    }
    const paper = scores('Paper')
    const vampire = scores('Vampire')
    const rows = [...page.matchAll(/^\| ([A-Za-z ]+) \| (\d+-\d+) \| (\d+-\d+) \|$/gm)]
    expect(rows).toHaveLength(11)
    for (const [, against, p, v] of rows) {
      if (against === 'each other') {
        expect([vampire.get('Paper'), paper.get('Vampire')]).toEqual([v, p])
      } else {
        expect({
          against,
          p: paper.get(against as string),
          v: vampire.get(against as string),
        }).toEqual({ against, p, v })
      }
    }
  })

  it("without paper's bomb, paper scores 222 and falls under silk", () => {
    const result = field(fighters.map((slug) => (slug === 'paper' ? PAPER_NO_BOMB : slug)))
    const names = result.standings.map((s) => s.name)
    expect(result.standings.find((s) => s.name === 'Paper')?.points).toBe(222)
    expect(names.indexOf('Paper')).toBeGreaterThan(names.indexOf('Silk'))
  })
})
