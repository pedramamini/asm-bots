import { describe, expect, it } from 'bun:test'
import { decode, decodeInto, type Instr, instructionLength, type Reader } from '../src/index'

const hex = (bytes: ArrayLike<number>) =>
  Array.from(bytes, (b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')
const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i)
const reader =
  (bytes: ArrayLike<number>): Reader =>
  (addr) =>
    bytes[addr] ?? 0

/** A deterministic stream of bytes. */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0
    return s >>> 24
  }
}

describe('instructionLength', () => {
  it('matches decode().length for 10,000 random byte strings', () => {
    const next = lcg(0x1e46)
    const wrong: string[] = []
    const lengths = new Set<number>()
    for (let i = 0; i < 10_000; i++) {
      const bytes = Array.from({ length: 8 }, next)
      const read = reader(bytes)
      const [got, want] = [instructionLength(read, 0), decode(read, 0).length]
      if (got !== want) wrong.push(`${hex(bytes)}: ${got}, decode ${want}`)
      lengths.add(got)
    }
    expect(wrong.slice(0, 20)).toEqual([])
    expect([...lengths].sort()).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('matches decode().length on every two-byte start, which fixes the length', () => {
    const wrong: string[] = []
    for (const b0 of range(0, 255)) {
      for (const b1 of range(0, 255)) {
        const read = reader([b0, b1, 0, 0, 0, 0])
        const [got, want] = [instructionLength(read, 0), decode(read, 0).length]
        if (got !== want) wrong.push(`${hex([b0, b1])}: ${got}, decode ${want}`)
      }
    }
    expect(wrong.slice(0, 20)).toEqual([])
  })

  it('gives 1 for an undefined byte, 2 for DAT, and 1 for HLT and INT3', () => {
    const length = (bytes: number[]) => instructionLength(reader(bytes), 0)
    expect(length([0x0f, 0x00])).toBe(1)
    expect(length([0x8d, 0xc0])).toBe(1)
    expect(length([0xf3, 0x90])).toBe(1)
    expect(length([0x00, 0x41])).toBe(2)
    expect(length([0xf4, 0x00])).toBe(1)
    expect(length([0xcc, 0x00])).toBe(1)
  })

  it('reads what decode reads, through a reader that wraps', () => {
    const core = new Uint8Array(0x10000)
    // add word [bx+0x1234], 0x5678 across the end of the core.
    core.set([0x81, 0x87], 0xfffe)
    core.set([0x34, 0x12, 0x78, 0x56], 0)
    const logTo =
      (reads: number[]): Reader =>
      (addr) => {
        reads.push(addr)
        return core[addr & 0xffff] ?? 0
      }
    const ours: number[] = []
    const decodes: number[] = []
    expect(instructionLength(logTo(ours), 0xfffe)).toBe(6)
    expect(decode(logTo(decodes), 0xfffe).length).toBe(6)
    expect(ours).toEqual(decodes)
  })

  it('leaves the instruction of another decodeInto caller as it was', () => {
    const out: Instr = { mnemonic: 'nop', operands: [], length: 1 }
    expect(decodeInto(reader([0x8b, 0x47, 0x05]), 0, out)).toBe(3)
    const before = JSON.stringify(out)
    expect(instructionLength(reader([0xc6, 0x40, 0x04, 0x41]), 0)).toBe(4)
    expect(instructionLength(reader([0x00, 0x41]), 0)).toBe(2)
    expect(JSON.stringify(out)).toBe(before)
  })
})
