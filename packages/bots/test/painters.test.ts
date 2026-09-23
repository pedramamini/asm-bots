import { describe, expect, it } from 'bun:test'
import { Battle, type Bot, CORE_SIZE, NullSink } from '@asmbots/engine'
import { bytesAt, fighter, seeds, symbolOf } from './fight'

/** Marks every byte a battle's bots write, and keeps where each write starts, in order. */
class Writes extends NullSink {
  readonly marked = new Uint8Array(CORE_SIZE)
  readonly starts: number[] = []

  override write(_cycle: number, _bot: number, addr: number, len: number): void {
    for (let k = 0; k < len; k++) this.marked[(addr + k) & 0xffff] = 1
    this.starts.push(addr)
  }
}

/** The marked bytes of `marked`. */
const count = (marked: Uint8Array) => marked.reduce((n, m) => n + m, 0)

/** The painter `slug` alone in the core, placed by `seed`, after `cycles` cycles, and its writes. */
function paint(slug: string, cycles: number, seed: number) {
  const writes = new Writes()
  const battle = new Battle([fighter(slug)], { seed, maxCycles: cycles }, writes)
  battle.run()
  expect(battle.cycle).toBe(cycles)
  return { battle, bot: battle.bots[0] as Bot, writes }
}

/** The painters and the byte each paints. */
const PAINTERS = [
  ['painter-lcg', 0xaa],
  ['painter-spiral', 0x55],
] as const

describe('roster: painters', () => {
  for (const [slug, byte] of PAINTERS) {
    it(`${slug} writes 4,000 distinct bytes or more in 50,000 cycles`, () => {
      for (const seed of seeds(1, 3)) {
        const distinct = count(paint(slug, 50_000, seed).writes.marked)
        expect({ seed, enough: distinct >= 4000 }).toEqual({ seed, enough: true })
      }
    })

    it(`${slug} paints only 0x${byte.toString(16)}, and never its own body`, () => {
      // 600,000 cycles hold a whole period of the LCG (65,536 writes of 8 cycles), and more
      // than a whole spiral (legs of 1 to 254 cells, 5 cycles a cell).
      for (const seed of seeds(1, 3)) {
        const { battle, bot, writes } = paint(slug, 600_000, seed)
        const image = bytesAt(battle, bot.base, bot.size)
        // The two bytes under the base hold the return address of the base idiom's call.
        const painted = new Set<number>()
        writes.marked.forEach((m, a) => {
          const under = (bot.base - a) & 0xffff
          if (m === 1 && under !== 1 && under !== 2) painted.add(battle.core.read8(a))
        })
        expect({ seed, alive: bot.alive, image, painted: [...painted] }).toEqual({
          seed,
          alive: true,
          image: [...fighter(slug).bytes],
          painted: [byte],
        })
      }
    })
  }
})

describe('roster: painter-lcg', () => {
  const MULT = symbolOf('painter-lcg', 'MULT')
  const ADDEND = symbolOf('painter-lcg', 'ADDEND')

  /**
   * One pass of the paint loop from state `s`, as the bot runs it: `mul` makes the product, the
   * add makes the next state and a carry that walks the square, and a high word whose low byte
   * is zero makes a jump. The product is less than 2^32, so a double holds it exactly.
   */
  const step = (s: number) => {
    const product = s * MULT
    const low = (product % 0x10000) + ADDEND
    const high = Math.floor(product / 0x10000)
    return { next: low & 0xffff, walks: low > 0xffff, jumps: high % 256 === 0 }
  }

  it('has an LCG of all 65,536 states, and WALK is the longest walk between two jumps', () => {
    // Start just after a jump, so that each gap between two jumps counts whole.
    let s = 0
    while (!step(s).jumps) s = step(s).next
    const first = step(s).next
    const seen = new Set<number>()
    let walk = 0
    let longest = 0
    let jumps = 0
    for (s = first; !seen.has(s); ) {
      seen.add(s)
      const { next, walks, jumps: jump } = step(s)
      if (walks) walk++
      longest = Math.max(longest, walk)
      if (jump) {
        jumps++
        walk = 0
      }
      s = next
    }
    expect({ states: seen.size, back: s === first, longest }).toEqual({
      states: 0x10000,
      back: true,
      longest: symbolOf('painter-lcg', 'WALK'),
    })
    // The header says: about once in 250 writes.
    expect(0x10000 / jumps).toBeGreaterThan(200)
    expect(0x10000 / jumps).toBeLessThan(300)
  })

  it('moves a jump that could bring a cloud onto its body far enough to clear it', () => {
    const size = fighter('painter-lcg').bytes.length
    const reach = symbolOf('painter-lcg', 'REACH')
    expect(reach + size - 1).toBeLessThanOrEqual(symbolOf('painter-lcg', 'HALF'))
  })

  it('spreads its clouds: 56 or more of the 64 1 KB blocks of the core get paint in 80,000 cycles', () => {
    for (const seed of seeds(1, 3)) {
      const { marked } = paint('painter-lcg', 80_000, seed).writes
      let blocks = 0
      for (let b = 0; b < 64; b++) {
        if (count(marked.subarray(b * 1024, (b + 1) * 1024)) >= 16) blocks++
      }
      expect({ seed, spread: blocks >= 56 }).toEqual({ seed, spread: true })
    }
  })
})

describe('roster: painter-spiral', () => {
  const LAST = symbolOf('painter-spiral', 'LAST')
  const SIZE = fighter('painter-spiral').bytes.length

  /**
   * The offsets from the base that a square spiral of `legs` legs paints: legs of 1, 2, 3, ...
   * cells that step right, down, left, and up in turn, less the offsets of the body.
   */
  function spiral(legs: number): number[] {
    const STEPS = [1, 256, -1, -256]
    const out: number[] = []
    let at = 0
    for (let leg = 1; leg <= legs; leg++) {
      const step = STEPS[(leg - 1) % 4] as number
      for (let k = 0; k < leg; k++) {
        at = (at + step) & 0xffff
        if (at >= SIZE) out.push(at)
      }
    }
    return out
  }

  it('paints a square spiral out from its base, one cell at a time, around its body', () => {
    for (const seed of seeds(1, 3)) {
      const { bot, writes } = paint('painter-spiral', 30_000, seed)
      // The first write is the return address of the base idiom's call.
      const cells = writes.starts.slice(1).map((a) => (a - bot.base) & 0xffff)
      expect(cells.length).toBeGreaterThan(5000)
      expect({ seed, cells }).toEqual({ seed, cells: spiral(LAST).slice(0, cells.length) })
    }
  })

  it('paints no cell twice in a pass: the spiral of LAST legs fits the core', () => {
    const cells = spiral(LAST)
    expect(new Set(cells).size).toBe(cells.length)
  })
})
