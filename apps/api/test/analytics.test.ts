/**
 * The Analytics Engine data point of a match (`analytics.ts`): its columns, and a write that can
 * never fail the job. The Runner's writes are checked in `runner.test.ts`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type MatchPoint, matchDataPoint, recordMatch } from '../src/analytics'

const POINT: MatchPoint = {
  kind: 'bracket',
  job: 'tournament:t1',
  match: 't1-4',
  reused: false,
  bots: 2,
  rounds: 10,
  cycles: 412_345,
  ms: 87,
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('matchDataPoint', () => {
  it('indexes by kind, and puts the count, time, bots, rounds, and cycles in the doubles', () => {
    expect(matchDataPoint(POINT)).toEqual({
      indexes: ['bracket'],
      blobs: ['bracket', 'played', 'tournament:t1', 't1-4'],
      doubles: [1, 87, 2, 10, 412_345],
    })
    expect(matchDataPoint({ ...POINT, reused: true }).blobs?.[1]).toBe('reused')
  })
})

describe('recordMatch', () => {
  it('writes the point, and only logs a write that throws', () => {
    const written: unknown[] = []
    recordMatch({ MATCH_ANALYTICS: { writeDataPoint: (point) => void written.push(point) } }, POINT)
    expect(written).toEqual([matchDataPoint(POINT)])

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const broken = {
      writeDataPoint: () => {
        throw new Error('too many blobs')
      },
    }
    expect(() => recordMatch({ MATCH_ANALYTICS: broken }, POINT)).not.toThrow()
    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toEqual({
      level: 'warn',
      msg: 'analytics.match',
      job: 'tournament:t1',
      match: 't1-4',
      error: 'too many blobs',
    })
    // No binding (a Worker set up without one): nothing to write.
    expect(() => recordMatch({}, POINT)).not.toThrow()
  })
})
