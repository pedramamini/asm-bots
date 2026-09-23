import { describe, expect, it } from 'bun:test'
import type { LoadedBot } from '@asmbots/engine'
import {
  DEFAULT_SURVIVAL_BINS,
  iterateMelee,
  type MeleeResult,
  melee,
  runMatch,
} from '../src/index'

const bot = (name: string, bytes: readonly number[]): LoadedBot => ({
  name,
  bytes: Uint8Array.from(bytes),
})

/** `jmp short $`: lives until the cycle cap. */
const loop = (name: string) => bot(name, [0xeb, 0xfe])
/** `dat`: dies on its first instruction. */
const dat = (name: string) => bot(name, [0x00, 0x00])

const CONFIG = { maxCycles: 100, seed: 11 }

describe('melee', () => {
  const entrants = [dat('d'), loop('a'), loop('b'), dat('e')]

  it('runs all the entrants in one core per round, as one match', () => {
    const m = melee(entrants, CONFIG, 5)
    expect(m.match).toEqual(runMatch(entrants, CONFIG, 5))
    expect(m.match.rounds.every((r) => r.order.length === 4)).toBe(true)
  })

  it('ranks by total points and counts W/T/L per round', () => {
    const m = melee(entrants, CONFIG, 5)
    // Two of four live each round: floor((16 - 1) / 2) = 7 points each (ISA §5.5).
    expect(m.standings.map((s) => [s.name, s.points, s.wins, s.ties, s.losses])).toEqual([
      ['a', 35, 0, 5, 0],
      ['b', 35, 0, 5, 0],
      ['d', 0, 0, 0, 5],
      ['e', 0, 0, 0, 5],
    ])
    const solo = melee([dat('d'), loop('a'), dat('e')], CONFIG, 3)
    expect(solo.standings[0]).toMatchObject({ name: 'a', points: 24, wins: 3, ties: 0 })
  })

  it('has survival histograms that sum to the rounds', () => {
    for (const rounds of [1, 4, 7]) {
      const m = melee(entrants, CONFIG, rounds)
      for (const s of m.standings) {
        expect(s.histogram.length).toBe(DEFAULT_SURVIVAL_BINS)
        expect(s.histogram.reduce((a, b) => a + b, 0)).toBe(rounds)
        expect(s.survival.length).toBe(rounds)
      }
    }
  })

  it('bins deaths at cycle 0 first and survivors to the cap last', () => {
    const m = melee(entrants, CONFIG, 4, { bins: 5 })
    const by = Object.fromEntries(m.standings.map((s) => [s.name, s]))
    expect(by.d?.survival).toEqual([0, 0, 0, 0])
    expect(by.d?.histogram).toEqual([4, 0, 0, 0, 0])
    expect(by.a?.survival).toEqual([100, 100, 100, 100])
    expect(by.a?.histogram).toEqual([0, 0, 0, 0, 4])
  })

  it('rejects bad entrant and bin counts', () => {
    expect(() => melee([loop('a')], CONFIG, 1)).toThrow(RangeError)
    const many = Array.from({ length: 17 }, (_, i) => loop(`l${i}`))
    expect(() => melee(many, CONFIG, 1)).toThrow(/2\.\.16/)
    expect(melee(many.slice(0, 16), CONFIG, 1).standings.length).toBe(16)
    expect(() => melee(entrants, CONFIG, 1, { bins: 0 })).toThrow(RangeError)
  })
})

describe('iterateMelee', () => {
  const entrants = [dat('d'), loop('a'), loop('b')]

  it('yields standings after each round, resumes, and ends as melee does', async () => {
    const ac = new AbortController()
    let partial: MeleeResult | undefined
    const run = async () => {
      for await (const p of iterateMelee(entrants, CONFIG, 5, { signal: ac.signal })) {
        partial = p.partial
        expect(p.of).toBe(5)
        for (const s of p.partial.standings) {
          expect(s.histogram.reduce((a, b) => a + b, 0)).toBe(p.round)
        }
        if (p.round === 3) ac.abort()
      }
    }
    await expect(run()).rejects.toMatchObject({ name: 'AbortError' })
    expect(partial?.match.rounds.length).toBe(3)
    const it = iterateMelee(entrants, CONFIG, 5, { resume: partial?.match })
    const rounds: number[] = []
    let step = await it.next()
    while (!step.done) {
      rounds.push(step.value.round)
      step = await it.next()
    }
    expect(rounds).toEqual([4, 5])
    expect(step.value).toEqual(melee(entrants, CONFIG, 5))
  })
})
