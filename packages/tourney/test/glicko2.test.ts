import { describe, expect, it } from 'bun:test'
import {
  DEFAULT_RATING,
  type MatchResult,
  type Rating,
  rateMatches,
  scoreFromPoints,
  TAU,
  updateRating,
} from '../src/index'

/** A made-up finished match with the given points. */
const fake = (points: number[]): MatchResult => ({
  key: 'fake',
  names: points.map((_, i) => `e${i}`),
  of: 1,
  rounds: [],
  points,
})

/** Glickman's worked example ("Example of the Glicko-2 system", 2012). */
const PLAYER: Rating = { rating: 1500, rd: 200, volatility: 0.06 }
const GAMES = [
  { opponent: { rating: 1400, rd: 30 }, score: 1 },
  { opponent: { rating: 1550, rd: 100 }, score: 0 },
  { opponent: { rating: 1700, rd: 300 }, score: 0 },
] as const

describe('updateRating', () => {
  it("reproduces Glickman's example: 1464.06 / 151.52 / 0.05999", () => {
    const r = updateRating(PLAYER, GAMES)
    // The paper rounds mu' to -0.2069 before it scales back, so it prints 1464.06; the unrounded
    // value is 1464.0507. Its 0.05999 volatility is 0.059996 truncated.
    expect(Math.abs(r.rating - 1464.06)).toBeLessThan(0.01)
    expect(r.rating).toBeCloseTo(1464.0507, 4)
    expect(r.rd).toBeCloseTo(151.52, 2)
    expect(r.volatility).toBeCloseTo(0.059996, 6)
  })

  it('uses the spec defaults', () => {
    expect(DEFAULT_RATING).toEqual({ rating: 1500, rd: 350, volatility: 0.06 })
    expect(TAU).toBe(0.5)
  })

  it('grows RD without games and keeps rating and volatility', () => {
    const r = updateRating(PLAYER, [])
    expect(r.rating).toBe(1500)
    expect(r.volatility).toBe(0.06)
    expect(r.rd).toBeCloseTo(Math.hypot(200 / 173.7178, 0.06) * 173.7178, 9)
    expect(r.rd).toBeGreaterThan(200)
  })

  it('caps RD at maxRd', () => {
    expect(updateRating(DEFAULT_RATING, []).rd).toBe(350)
    expect(updateRating(PLAYER, [], { maxRd: 200.1 }).rd).toBe(200.1)
  })

  it('moves up on a win, down on a loss, and a tie between equals keeps the rating', () => {
    const opponent = { rating: 1500, rd: 350 }
    const win = updateRating(DEFAULT_RATING, [{ opponent, score: 1 }])
    const loss = updateRating(DEFAULT_RATING, [{ opponent, score: 0 }])
    const tie = updateRating(DEFAULT_RATING, [{ opponent, score: 0.5 }])
    expect(win.rating).toBeGreaterThan(1500)
    expect(loss.rating).toBeLessThan(1500)
    expect(win.rating - 1500).toBeCloseTo(1500 - loss.rating, 9)
    expect(tie.rating).toBeCloseTo(1500, 9)
    expect(win.rd).toBeLessThan(350)
  })

  it('is deterministic', () => {
    expect(updateRating(PLAYER, GAMES)).toEqual(updateRating(PLAYER, GAMES))
  })

  it('rejects bad input', () => {
    expect(() => updateRating({ ...PLAYER, rd: 0 }, [])).toThrow(RangeError)
    expect(() => updateRating({ ...PLAYER, volatility: -1 }, [])).toThrow(RangeError)
    expect(() => updateRating({ ...PLAYER, rating: Number.NaN }, [])).toThrow(RangeError)
    expect(() => updateRating(PLAYER, [], { tau: 0 })).toThrow(RangeError)
    // biome-ignore lint/suspicious/noExplicitAny: an out-of-range score on purpose
    const bad = [{ opponent: { rating: 1500, rd: 50 }, score: 0.7 as any }]
    expect(() => updateRating(PLAYER, bad)).toThrow(RangeError)
  })
})

describe('scoreFromPoints', () => {
  it('maps more / same / fewer points to W / T / L', () => {
    expect(scoreFromPoints(30, 0)).toBe(1)
    expect(scoreFromPoints(10, 10)).toBe(0.5)
    expect(scoreFromPoints(3, 27)).toBe(0)
  })
})

describe('rateMatches', () => {
  it("reproduces Glickman's example from match points", () => {
    const ratings: Rating[] = [
      PLAYER,
      { rating: 1400, rd: 30, volatility: 0.06 },
      { rating: 1550, rd: 100, volatility: 0.06 },
      { rating: 1700, rd: 300, volatility: 0.06 },
    ]
    const out = rateMatches(ratings, [
      { entrants: [0, 1], result: fake([30, 0]) },
      { entrants: [2, 0], result: fake([20, 10]) },
      { entrants: [0, 3], result: fake([0, 30]) },
    ])
    expect(out[0]?.rating).toBeCloseTo(1464.0507, 4)
    expect(out[0]?.rd).toBeCloseTo(151.52, 2)
    expect(out[0]?.volatility).toBeCloseTo(0.059996, 6)
    // The opponents use the start-of-period ratings, so each equals its own one-game update.
    expect(out[1]).toEqual(
      updateRating(ratings[1] as Rating, [{ opponent: PLAYER, score: 0 }]),
    )
  })

  it('pairs every entrant of a k-way match and updates the idle', () => {
    const ratings = [DEFAULT_RATING, DEFAULT_RATING, DEFAULT_RATING, PLAYER]
    const out = rateMatches(ratings, [{ entrants: [0, 1, 2], result: fake([8, 4, 4]) }])
    expect(out[0]?.rating).toBeGreaterThan(1500)
    expect(out[1]?.rating).toBeLessThan(1500)
    expect(out[1]).toEqual(out[2] as Rating)
    expect(out[0]).toEqual(
      updateRating(DEFAULT_RATING, [
        { opponent: DEFAULT_RATING, score: 1 },
        { opponent: DEFAULT_RATING, score: 1 },
      ]),
    )
    expect(out[3]).toEqual(updateRating(PLAYER, []))
  })

  it('rejects unknown entrants and mismatched points', () => {
    const unknown = [{ entrants: [0, 1], result: fake([1, 1]) }]
    expect(() => rateMatches([DEFAULT_RATING], unknown)).toThrow(RangeError)
    expect(() =>
      rateMatches([DEFAULT_RATING, DEFAULT_RATING], [{ entrants: [0, 1], result: fake([1]) }]),
    ).toThrow(RangeError)
  })
})
