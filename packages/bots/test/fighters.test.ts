import { describe, expect, it } from 'bun:test'
import { Battle, type Bot, IP } from '@asmbots/engine'
import { loadRoster, ROSTER } from '../src/roster'
import { type FightRecord, fighter, formatRecord, record, seeds } from './fight'

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

/** The roster bot `slug` alone in the core, placed by `seed`, after `cycles` cycles. */
function alone(slug: string, cycles: number, seed = 1): { battle: Battle; bot: Bot } {
  const battle = new Battle([fighter(slug)], { seed })
  battle.run(cycles)
  return { battle, bot: battle.bots[0] as Bot }
}

describe('roster: a bomber alone in the core never bombs its own body', () => {
  for (const slug of ['dwarf', 'dwarf-wide', 'stone', 'scanner']) {
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
