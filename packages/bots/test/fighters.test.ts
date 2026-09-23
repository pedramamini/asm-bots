import { describe, expect, it } from 'bun:test'
import { Battle, type Bot, type Core, IP, NullSink } from '@asmbots/engine'
import { loadRoster, ROSTER } from '../src/roster'
import { type FightRecord, fighter, formatRecord, HILL_RULES, record, seeds } from './fight'

/** A record line of a header (roster/README.md): `; vs imp.asm, seeds 1..20: 14 W / 6 T / 0 L`. */
const RECORD_LINE = /^; vs ([a-z0-9-]+)\.asm, seeds (\d+)\.\.(\d+): (.*)$/

/** A record a header claims: the rival's slug, the seeds, and the `14 W / 6 T / 0 L` text. */
interface Claim {
  rival: string
  first: number
  last: number
  text: string
}

/** The record lines in the header of the roster bot `slug`, the leading `;` lines of its file. */
function claimsOf(slug: string): Claim[] {
  const source = loadRoster().get(slug)?.source ?? ''
  const header = /^(?:;.*\n)+/.exec(source)?.[0] ?? ''
  return header.split('\n').flatMap((line) => {
    const m = RECORD_LINE.exec(line)
    if (m === null) return []
    const [, rival = '', first = '', last = '', text = ''] = m
    return [{ rival, first: Number(first), last: Number(last), text }]
  })
}

const fought = new Map<string, FightRecord>()

/** `record` of `slug` against `rival` over seeds `first..last`, fought once per test run. */
function recordOf(slug: string, rival: string, first: number, last: number): FightRecord {
  const key = `${slug} ${rival} ${first} ${last}`
  let r = fought.get(key)
  if (r === undefined) {
    r = record(slug, rival, seeds(first, last))
    fought.set(key, r)
  }
  return r
}

/** The families of classic Core War: each of their bots records its fights against the imp. */
const CLASSIC = new Set(['imp', 'dwarf', 'stone', 'paper', 'scanner', 'vampire'])

describe('roster: fight records', () => {
  for (const entry of ROSTER) {
    const claims = claimsOf(entry.slug)
    if (CLASSIC.has(entry.family)) {
      it(`${entry.file} records its fights against imp.asm over seeds 1..20`, () => {
        expect(claims.map((c) => `${c.rival} ${c.first}..${c.last}`)).toContain('imp 1..20')
      })
    }
    for (const { rival, first, last, text } of claims) {
      it(`${entry.file} is ${text} against ${rival}.asm over seeds ${first}..${last}`, () => {
        expect(formatRecord(recordOf(entry.slug, rival, first, last))).toBe(text)
      })
    }
  }
})

/**
 * EXEC_1_4 part 1: against imp.asm over seeds 1..20, the dwarves, the stone, and the scanner win
 * 60% of the rounds or more, and the imps tie 60% or more.
 */
const VS_IMP: readonly (readonly [slug: string, bar: 'wins' | 'ties'])[] = [
  ['imp', 'ties'],
  ['imp-ring', 'ties'],
  ['dwarf', 'wins'],
  ['dwarf-wide', 'wins'],
  ['stone', 'wins'],
  ['scanner', 'wins'],
]

describe('roster: part 1 against imp.asm, seeds 1..20', () => {
  for (const [slug, bar] of VS_IMP) {
    it(`${slug} ${bar} 12 rounds or more`, () => {
      expect(recordOf(slug, 'imp', 1, 20)[bar]).toBeGreaterThanOrEqual(12)
    })
  }
})

/** A label or `equ` value of the roster bot `slug`. */
function symbolOf(slug: string, name: string): number {
  const value = loadRoster().get(slug)?.assembled.symbols.get(name)
  if (value === undefined) throw new Error(`${slug} has no symbol '${name}'`)
  return value
}

/**
 * Keeps the spawns and the deaths of a battle: the bot, and where the child starts or the process
 * dies. Once a test sets `core`, a spawn also keeps the 2 bytes at the child's start as the SPL
 * leaves them.
 */
class EventLog extends NullSink {
  core: Core | undefined
  readonly spawns: { bot: number; addr: number; bytes: number[] }[] = []
  readonly deaths: { bot: number; addr: number }[] = []

  override spawn(_cycle: number, bot: number, _proc: number, addr: number): void {
    const core = this.core
    const bytes = core === undefined ? [] : [core.read8(addr), core.read8(addr + 1)]
    this.spawns.push({ bot, addr, bytes })
  }

  override death(_cycle: number, bot: number, _proc: number, addr: number): void {
    this.deaths.push({ bot, addr })
  }
}

/**
 * Fights `slug` against `rival` as `record` does, one round a seed with the order alternating,
 * and returns how many rounds `test` passes. `test` gets the round's events, its battle, and the
 * index of `slug` in it.
 */
function roundsWhere(
  slug: string,
  rival: string,
  roundSeeds: readonly number[],
  test: (events: EventLog, battle: Battle, us: number) => boolean,
): number {
  const bots = [fighter(slug), fighter(rival)]
  let rounds = 0
  roundSeeds.forEach((seed, round) => {
    const us = round % 2
    const events = new EventLog()
    const order = us === 0 ? bots : [...bots].reverse()
    const battle = new Battle(order, { ...HILL_RULES, seed }, events)
    battle.run()
    if (test(events, battle, us)) rounds++
  })
  return rounds
}

/** The base of bot `index` of `battle`. */
const baseOf = (battle: Battle, index: number) => (battle.bots[index] as Bot).base

/** EXEC_1_4 part 2: the papers, the vampire, the gate, the decoy, and the hybrid. */
const PART_2 = ['paper', 'silk', 'vampire', 'gate', 'decoy', 'hybrid']

describe('roster: part 2 against imp.asm, dwarf.asm, and paper.asm, seeds 1..20', () => {
  for (const slug of PART_2) {
    it(`${slug} records its fights against dwarf.asm over seeds 1..20`, () => {
      expect(claimsOf(slug).map((c) => `${c.rival} ${c.first}..${c.last}`)).toContain('dwarf 1..20')
    })
  }

  for (const slug of ['paper', 'silk']) {
    it(`${slug} is alive at the end of 14 rounds or more against imp.asm`, () => {
      const { wins, ties } = recordOf(slug, 'imp', 1, 20)
      expect(wins + ties).toBeGreaterThanOrEqual(14)
    })
  }

  it('vampire holds a process of paper.asm in its pit in 10 seeds or more', () => {
    // A held process runs the pit's spl, so its bot starts a child at pit.hold.
    const hold = symbolOf('vampire', 'pit.hold')
    const held = roundsWhere('vampire', 'paper', seeds(1, 20), ({ spawns }, battle, us) => {
      const pit = (baseOf(battle, us) + hold) & 0xffff
      return spawns.some(({ bot, addr }) => bot !== us && addr === pit)
    })
    expect(held).toBeGreaterThanOrEqual(10)
  })
})

/** The roster bot `slug` alone in the core, placed by `seed`, after `cycles` cycles. */
function alone(slug: string, cycles: number, seed = 1): { battle: Battle; bot: Bot } {
  const battle = new Battle([fighter(slug)], { seed })
  battle.run(cycles)
  return { battle, bot: battle.bots[0] as Bot }
}

describe('roster: a bomber alone in the core never bombs its own body', () => {
  for (const slug of ['dwarf', 'dwarf-wide', 'gate', 'decoy', 'stone', 'scanner', 'hybrid']) {
    it(`${slug} lives 100,000 cycles with its image as loaded`, () => {
      for (const seed of [1, 2, 3]) {
        // More than a lap of each bomber and of the scan.
        const { battle, bot } = alone(slug, 100_000, seed)
        const at = (i: number) => battle.core.bytes[(bot.base + i) & 0xffff]
        const image = Array.from({ length: bot.size }, (_, i) => at(i))
        expect({ seed, alive: bot.alive, image }).toEqual({
          seed,
          alive: true,
          image: [...fighter(slug).bytes],
        })
      }
    })
  }
})

describe('roster: part 1 shapes', () => {
  it('imp walks the whole core: alone for 100,000 cycles, it has written every byte', () => {
    const r = alone('imp', 100_000).battle.result().bots[0]
    expect({ alive: r?.alive, procs: r?.procs, footprint: r?.footprint }).toEqual({
      alive: true,
      procs: 1,
      footprint: 0x10000,
    })
  })

  it('imp-ring runs three imps a third of the core apart', () => {
    const { queue } = alone('imp-ring', 60).bot
    const ips = Array.from({ length: queue.size }, (_, i) => queue.rows[queue.at(i)]?.[IP] ?? 0)
    ips.sort((a, b) => a - b)
    const gaps = ips.map((ip, i) => ((ips[(i + 1) % ips.length] ?? 0) - ip) & 0xffff)
    expect(gaps).toHaveLength(3)
    for (const gap of gaps) expect(Math.abs(gap - 0x10000 / 3)).toBeLessThan(32)
  })

  it('stone runs its two bombers and its decoy imp as three processes', () => {
    expect(alone('stone', 1000).bot.queue.size).toBe(3)
  })
})

/** The `size` bytes from `from` in the core of `battle`. */
const bytesAt = (battle: Battle, from: number, size: number) =>
  Array.from({ length: size }, (_, i) => battle.core.read8(from + i))

describe('roster: part 2 shapes', () => {
  it('paper and silk fill the process cap and live alone to the cycle cap', () => {
    for (const slug of ['paper', 'silk']) {
      const r = alone(slug, 80_000).battle.result().bots[0]
      expect({ slug, alive: r?.alive, peak: r?.peakProcs }).toEqual({ slug, alive: true, peak: 64 })
    }
  })

  it('paper starts a child on a whole copy, and silk starts it on a jmp $ pad first', () => {
    const first = [...fighter('paper').bytes.slice(0, 2)]
    for (const [slug, want] of [
      ['paper', first],
      ['silk', [0xeb, 0xfe]],
    ] as const) {
      const events = new EventLog()
      const battle = new Battle([fighter(slug)], { seed: 1 }, events)
      events.core = battle.core
      battle.run(2000)
      const starts = events.spawns.slice(0, 8).map(({ bytes }) => bytes)
      expect({ slug, starts }).toEqual({ slug, starts: Array(8).fill(want) })
    }
  })

  it('vampire alone writes to its own body only to close its pit', () => {
    const hold = symbolOf('vampire', 'pit.hold')
    const image = [...fighter('vampire').bytes]
    image.splice(hold, 2, 0, 0)
    for (const seed of [1, 2, 3]) {
      const { battle, bot } = alone('vampire', 100_000, seed)
      expect({ seed, alive: bot.alive, image: bytesAt(battle, bot.base, bot.size) }).toEqual({
        seed,
        alive: true,
        image,
      })
    }
  })

  it('gate kills imps at the gate: an imp of imp-ring.asm dies there in 10 seeds or more', () => {
    const gate = symbolOf('gate', 'GATE')
    const killed = roundsWhere('gate', 'imp-ring', seeds(1, 20), ({ deaths }, battle, us) =>
      deaths.some(({ bot, addr }) => {
        const under = (baseOf(battle, us) - addr) & 0xffff
        return bot !== us && under > 0 && under <= gate
      }),
    )
    expect(killed).toBeGreaterThanOrEqual(10)
  })

  it('decoy covers the 1 KB under its body and the 1 KB over it with noise first', () => {
    const noise = symbolOf('decoy', 'NOISE')
    const fill = symbolOf('decoy', 'FILL')
    const { battle, bot } = alone('decoy', 1100)
    const over = Array.from({ length: noise / 2 }, (_, i) =>
      battle.core.read16(bot.base + bot.size + 2 * i),
    )
    expect(new Set(over)).toEqual(new Set([fill]))
    expect(battle.result().bots[0]?.footprint).toBe(2 * noise + bot.size)
  })

  it('hybrid stays a scanner alone, and turns to paper when a bomb lands in its guard', () => {
    expect(alone('hybrid', 100_000).bot.queue.size).toBe(1)
    const guard = symbolOf('hybrid', 'end') + symbolOf('hybrid', 'AWAY')
    const { battle, bot } = alone('hybrid', 100)
    battle.core.write8(bot.base + guard + 5, 0, 0) // a bomb that no bot owns
    battle.run(3000)
    expect(bot.queue.size).toBe(64)
  })
})
