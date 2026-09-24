import { describe, expect, it } from 'bun:test'
import {
  advance,
  type Bracket,
  bracketLayout,
  bracketSvg,
  createBracket,
  escapeXml,
  type MatchResult,
  NODE_HEIGHT,
  NODE_WIDTH,
  nextMatches,
  roundTitle,
} from '../src/index'

const named = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `e${i}` }))

const fake = (names: string[], points: number[]): MatchResult => ({
  key: `fake:${names.join(',')}`,
  names,
  of: 1,
  rounds: [
    {
      round: 0,
      seed: 0,
      order: [0, 1],
      resultHash: '',
      durationCycles: 0,
      points,
      survivors: [],
      survival: [0, 0],
    },
  ],
  points,
})

/** Plays every ready match: the lower entrant index wins 3 to 0. */
function playOut(b: Bracket): Bracket {
  let current = b
  for (;;) {
    const next = nextMatches(current)[0]
    if (next === undefined) return current
    const [x, y] = next.slots.map((s) => s.entrant as number) as [number, number]
    const names = [current.names[x] as string, current.names[y] as string]
    current = advance(current, next.id, fake(names, x < y ? [3, 0] : [0, 3]))
  }
}

const matchIds = (svg: string) =>
  [...svg.matchAll(/data-match-id="(\d+)"/g)].map((m) => Number(m[1]))

describe('bracketSvg', () => {
  it('draws one node per match: 7 for 8 entrants, 15 for 13', () => {
    const eight = bracketSvg(createBracket(named(8), { seeding: 'given' }))
    expect(matchIds(eight)).toEqual([0, 1, 2, 3, 4, 5, 6])
    const thirteen = createBracket(named(13), { seeding: 'given' })
    const svg = bracketSvg(thirteen)
    expect(matchIds(svg)).toHaveLength(15)
    // Seeds 14..16 are byes: the top three seeds walk over.
    expect(svg.match(/data-status="walkover"/g)).toHaveLength(3)
    expect(svg.match(/>bye</g)).toHaveLength(3)
  })

  it('adds the third-place match under the final', () => {
    const b = createBracket(named(8), { seeding: 'given', thirdPlace: true })
    const svg = bracketSvg(b)
    expect(matchIds(svg)).toHaveLength(8)
    expect(svg).toContain('THIRD PLACE')
    const { nodes } = bracketLayout(b)
    const final = nodes[b.final]
    const third = nodes[b.thirdPlace as number]
    expect(third?.x).toBe(final?.x as number)
    expect(third?.y).toBeGreaterThan((final?.y as number) + NODE_HEIGHT)
  })

  it('centers each later match between the two it takes its entrants from', () => {
    const b = createBracket(named(16), { seeding: 'given' })
    const { nodes, width, height } = bracketLayout(b)
    for (const m of b.matches.filter((x) => x.round > 0)) {
      const feeders = m.slots.map((s) => ('winnerOf' in s.source ? s.source.winnerOf : -1))
      const [a, c] = feeders.map((f) => nodes[f]?.y as number) as [number, number]
      expect(nodes[m.id]?.y).toBe((a + c) / 2)
      expect(nodes[m.id]?.x).toBeGreaterThan(nodes[feeders[0] as number]?.x as number)
    }
    for (const n of nodes) {
      expect(n.x + NODE_WIDTH).toBeLessThanOrEqual(width)
      expect(n.y + NODE_HEIGHT).toBeLessThanOrEqual(height)
    }
  })

  it('marks live and selected matches, and shows points and the champion once played', () => {
    const b = createBracket(named(4), { seeding: 'given' })
    const live = bracketSvg(b, { live: [0], selected: 1, interactive: true })
    expect(live).toMatch(/data-match-id="0"[^>]*data-live="true"/)
    expect(live).toMatch(/data-match-id="1"[^>]*data-selected="true"/)
    expect(live).toMatch(/data-match-id="1"[^>]*role="button"[^>]*tabindex="0"/)
    expect(live).not.toContain('data-champion')

    const done = playOut(b)
    const svg = bracketSvg(done)
    expect(svg).toContain('data-champion="0"')
    expect(svg).toMatch(/font-weight="bold"[^>]*>3</)
    expect(svg).not.toContain('role="button"')
  })

  it('escapes names and takes a palette', () => {
    const b = createBracket([{ name: '<script>"x"&\'y\'' }, { name: 'ok' }], { seeding: 'given' })
    const svg = bracketSvg(b, { palette: { accent: '#123456', background: 'none' }, live: [0] })
    expect(svg).not.toContain('<script>')
    expect(svg).toContain(escapeXml('<script>"x"&\'y\''))
    expect(svg).toContain('stroke="#123456"')
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    // No background rect when the background is none: the first element is the round title.
    expect(svg).toMatch(/^<svg[^>]*><text/)
  })

  it('names the rounds', () => {
    expect([0, 1, 2, 3, 4].map((r) => roundTitle(r, 5))).toEqual([
      'round 1',
      'round 2',
      'quarterfinals',
      'semifinals',
      'final',
    ])
  })
})
