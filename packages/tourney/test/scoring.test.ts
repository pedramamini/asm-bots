import { describe, expect, it } from 'bun:test'
import { pmarsPoints as enginePoints } from '@asmbots/engine'
import {
  CSV_HEADER,
  csv,
  type MatchResult,
  pmarsPoints,
  type Standing,
  standingsFromMatches,
} from '../src/index'

/** A made-up finished match with the given points. */
const fake = (points: number[]): MatchResult => ({
  key: 'fake',
  names: points.map((_, i) => `e${i}`),
  of: 1,
  rounds: [],
  points,
})

const row = (entrant: number, name: string, points = 0): Standing => ({
  entrant,
  name,
  points,
  wins: 0,
  ties: 0,
  losses: 0,
  matches: 0,
})

describe('pmarsPoints', () => {
  it('matches the ISA §5.5 table', () => {
    expect(pmarsPoints(2, 1)).toBe(3)
    expect(pmarsPoints(2, 2)).toBe(1)
    expect(pmarsPoints(2, 0)).toBe(0)
    expect(pmarsPoints(3, 1)).toBe(8)
    expect(pmarsPoints(3, 2)).toBe(4)
    expect(pmarsPoints(3, 3)).toBe(2)
    expect(pmarsPoints(8, 3)).toBe(21)
  })

  it('is the engine function', () => {
    expect(pmarsPoints).toBe(enginePoints)
  })
})

describe('csv', () => {
  it('writes a header and one ranked row per standing, CRLF', () => {
    const names = ['imp', 'dwarf', 'paper']
    const out = csv(
      standingsFromMatches(names, [
        { entrants: [0, 1], result: fake([30, 0]) },
        { entrants: [0, 2], result: fake([10, 10]) },
        { entrants: [1, 2], result: fake([3, 27]) },
      ]),
    )
    expect(out).toBe(
      [
        CSV_HEADER,
        '1,0,imp,40,1,1,0',
        '2,2,paper,37,1,1,0',
        '3,1,dwarf,3,0,0,2',
        '',
      ].join('\r\n'),
    )
  })

  it('quotes commas, quotes, and line breaks', () => {
    const lines = csv([row(0, 'a,b'), row(1, 'say "hi"'), row(2, 'two\nlines')]).split('\r\n')
    expect(lines[1]).toBe('1,0,"a,b",0,0,0,0')
    expect(lines[2]).toBe('2,1,"say ""hi""",0,0,0,0')
    expect(lines[3]).toBe('3,2,"two\nlines",0,0,0,0')
  })

  it('defuses spreadsheet formulas in names', () => {
    const lines = csv([
      row(0, '=1+1'),
      row(1, '+x'),
      row(2, '-x'),
      row(3, '@x'),
      row(4, '=HYPERLINK("a","b")'),
    ]).split('\r\n')
    expect(lines.slice(1, 6)).toEqual([
      "1,0,'=1+1,0,0,0,0",
      "2,1,'+x,0,0,0,0",
      "3,2,'-x,0,0,0,0",
      "4,3,'@x,0,0,0,0",
      `5,4,"'=HYPERLINK(""a"",""b"")",0,0,0,0`,
    ])
  })

  it('takes melee standings too', () => {
    const melee = [{ entrant: 1, name: 'm', points: 9, wins: 1, ties: 2, losses: 3, survival: [] }]
    expect(csv(melee)).toBe(`${CSV_HEADER}\r\n1,1,m,9,1,2,3\r\n`)
  })

  it('writes only the header for no standings', () => {
    expect(csv([])).toBe(`${CSV_HEADER}\r\n`)
  })
})
