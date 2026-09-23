import { describe, expect, it } from 'bun:test'
import { ADDR_MASK, CORE_SIZE, Core } from '../src/index'

type Write = [addr: number, len: number, owner: number]

/** A core whose `onWrite` records every call. */
function logged(): { core: Core; log: Write[] } {
  const core = new Core()
  const log: Write[] = []
  core.onWrite = (addr, len, owner) => log.push([addr, len, owner])
  return { core, log }
}

/** The addresses whose owner is not 0. */
function owned(core: Core): number[] {
  const out: number[] = []
  for (let a = 0; a < CORE_SIZE; a++) if (core.owner[a] !== 0) out.push(a)
  return out
}

describe('Core', () => {
  it('is 64 KB of zeroed memory owned by nobody', () => {
    const core = new Core()
    expect([CORE_SIZE, ADDR_MASK]).toEqual([0x10000, 0xffff])
    expect(core.bytes.length).toBe(CORE_SIZE)
    expect(core.owner.length).toBe(CORE_SIZE)
    expect(core.bytes.every((b) => b === 0)).toBe(true)
    expect(owned(core)).toEqual([])
    expect(core.onWrite).toBeUndefined()
  })

  it('wraps byte addresses mod 64 KB', () => {
    const core = new Core()
    core.write8(0x10005, 0xab, 1)
    core.write8(-1, 0xcd, 1)
    core.write8(0x3ffff, 0xef, 2)
    expect([core.bytes[5], core.bytes[0xffff]]).toEqual([0xab, 0xef])
    expect([core.read8(5), core.read8(0x10005), core.read8(-0xfffb)]).toEqual([0xab, 0xab, 0xab])
    expect([core.read8(0xffff), core.read8(-1), core.read8(0x1ffff)]).toEqual([0xef, 0xef, 0xef])
    expect(owned(core)).toEqual([5, 0xffff])
  })

  it('keeps the low 8 bits of a byte value', () => {
    const core = new Core()
    const cases = [
      [0x1ff, 0xff],
      [0x100, 0x00],
      [-1, 0xff],
      [-0x80, 0x80],
    ] as const
    for (const [v, want] of cases) {
      core.write8(0x40, v, 1)
      expect(core.read8(0x40)).toBe(want)
    }
  })

  it('stores words little-endian', () => {
    const core = new Core()
    core.write16(0x100, 0x1234, 1)
    expect([core.bytes[0x100], core.bytes[0x101]]).toEqual([0x34, 0x12])
    expect(core.read16(0x100)).toBe(0x1234)
    expect(core.read16(0x101)).toBe(0x0012)
    core.write8(0x102, 0x56, 1)
    expect(core.read16(0x101)).toBe(0x5612)
    expect([core.bytes[0xff], core.bytes[0x103]]).toEqual([0, 0])
  })

  it('writes a word at 0xFFFF across the wrap to 0x0000', () => {
    const core = new Core()
    core.write16(0xffff, 0xbeef, 3)
    expect([core.bytes[0xffff], core.bytes[0x0000]]).toEqual([0xef, 0xbe])
    expect([core.owner[0xffff], core.owner[0x0000]]).toEqual([3, 3])
    expect(owned(core)).toEqual([0, 0xffff])
    expect([core.bytes[0xfffe], core.bytes[0x0001]]).toEqual([0, 0])
  })

  it('reads a word at 0xFFFF across the wrap, from any alias of the address', () => {
    const core = new Core()
    core.write8(0xffff, 0x34, 1)
    core.write8(0x0000, 0x12, 1)
    for (const a of [0xffff, -1, 0x1ffff, 0xffffffff]) expect(core.read16(a)).toBe(0x1234)
    expect(core.read16(0xfffe)).toBe(0x3400)
    expect(core.read16(0x0000)).toBe(0x0012)
  })

  it('writes a word through any alias of 0xFFFF', () => {
    for (const a of [0xffff, -1, 0x1ffff, 0xffffffff]) {
      const core = new Core()
      core.write16(a, 0xa55a, 1)
      expect([core.bytes[0xffff], core.bytes[0], owned(core)]).toEqual([0x5a, 0xa5, [0, 0xffff]])
    }
  })

  it('keeps the low 16 bits of a word value', () => {
    const core = new Core()
    const cases = [
      [0x12345, 0x2345],
      [0x10000, 0x0000],
      [-1, 0xffff],
      [-2, 0xfffe],
      [-0x8000, 0x8000],
      [0x8000, 0x8000],
    ] as const
    for (const [v, want] of cases) {
      core.write16(0x200, v, 1)
      core.write16(0xffff, v, 1)
      expect([core.read16(0x200), core.read16(0xffff)]).toEqual([want, want])
    }
  })

  it('tags every byte a write touches with its owner and leaves the rest alone', () => {
    const core = new Core()
    core.write8(0x10, 0, 1)
    expect(owned(core)).toEqual([0x10])
    core.write16(0x20, 0, 2)
    expect(owned(core)).toEqual([0x10, 0x20, 0x21])
    expect([core.owner[0x10], core.owner[0x20], core.owner[0x21]]).toEqual([1, 2, 2])
  })

  it('tags on a write of an unchanged value', () => {
    const core = new Core()
    core.write8(0x30, 0, 4)
    core.write16(0x40, 0, 5)
    expect([core.owner[0x30], core.owner[0x40], core.owner[0x41]]).toEqual([4, 5, 5])
  })

  it('retags on overwrite, including owner 0 and half of a word', () => {
    const core = new Core()
    core.write16(0x50, 0x1111, 1)
    core.write8(0x51, 0x22, 2)
    expect([core.owner[0x50], core.owner[0x51], core.read16(0x50)]).toEqual([1, 2, 0x2211])
    core.write16(0x4f, 0x3333, 3)
    expect([core.owner[0x4f], core.owner[0x50], core.owner[0x51]]).toEqual([3, 3, 2])
    core.write8(0x4f, 0x44, 0)
    expect([core.owner[0x4f], core.bytes[0x4f]]).toEqual([0, 0x44])
  })

  it('does not tag or log on reads', () => {
    const { core, log } = logged()
    for (const a of [0, 0x1234, 0xffff, -1]) {
      core.read8(a)
      core.read16(a)
    }
    expect(owned(core)).toEqual([])
    expect(log).toEqual([])
  })

  it('fills bytes at an address with one owner', () => {
    const core = new Core()
    core.fill(0x1000, Uint8Array.of(0xa4, 0xeb, 0xfd), 2)
    expect([...core.bytes.subarray(0xfff, 0x1004)]).toEqual([0, 0xa4, 0xeb, 0xfd, 0])
    expect(owned(core)).toEqual([0x1000, 0x1001, 0x1002])
    expect(core.owner[0x1000]).toBe(2)
  })

  it('fills across 0xFFFF into 0x0000, and from an aliased address', () => {
    const core = new Core()
    core.fill(0x1fffe, [1, 2, 3, 4], 7)
    expect([core.bytes[0xfffe], core.bytes[0xffff], core.bytes[0], core.bytes[1]]).toEqual([
      1, 2, 3, 4,
    ])
    expect(owned(core)).toEqual([0, 1, 0xfffe, 0xffff])
    expect(core.bytes[2]).toBe(0)
  })

  it('fills values by their low 8 bits', () => {
    const core = new Core()
    core.fill(0, [0x1ff, -1, 0x100], 1)
    expect([...core.bytes.subarray(0, 3)]).toEqual([0xff, 0xff, 0x00])
  })

  it('fills past 64 KB as a run of write8 would: the later bytes win', () => {
    const core = new Core()
    const src = Uint8Array.from({ length: CORE_SIZE + 2 }, (_, i) => i % 251)
    core.fill(0x10, src, 1)
    expect([core.bytes[0x10], core.bytes[0x11], core.bytes[0x12]]).toEqual([
      CORE_SIZE % 251,
      (CORE_SIZE + 1) % 251,
      2,
    ])
    expect(core.owner.every((o) => o === 1)).toBe(true)
  })

  it('treats an empty fill as no write', () => {
    const { core, log } = logged()
    core.fill(0x10, [], 1)
    expect(owned(core)).toEqual([])
    expect(log).toEqual([])
  })

  it('reports each write to onWrite once, as (masked addr, len, owner)', () => {
    const { core, log } = logged()
    core.write8(0x10005, 1, 1)
    core.write16(-1, 2, 2)
    core.write16(0x1234, 3, 3)
    core.fill(0x2fffe, [1, 2, 3], 4)
    expect(log).toEqual([
      [0x0005, 1, 1],
      [0xffff, 2, 2],
      [0x1234, 2, 3],
      [0xfffe, 3, 4],
    ])
  })

  it('calls onWrite after the bytes and owners change', () => {
    const core = new Core()
    const seen: number[] = []
    core.onWrite = (addr, len) => {
      for (let k = 0; k < len; k++) {
        const a = (addr + k) & ADDR_MASK
        seen.push(core.read8(a), core.owner[a] as number)
      }
    }
    core.write8(0x10, 0x11, 1)
    core.write16(0xffff, 0x3322, 2)
    core.fill(0x20, [0x44], 3)
    expect(seen).toEqual([0x11, 1, 0x22, 2, 0x33, 2, 0x44, 3])
  })

  it('stops reporting when onWrite is cleared', () => {
    const { core, log } = logged()
    core.write8(0, 1, 1)
    core.onWrite = undefined
    core.write8(1, 1, 1)
    core.write16(2, 1, 1)
    core.fill(4, [1], 1)
    expect(log).toEqual([[0, 1, 1]])
    expect(owned(core)).toEqual([0, 1, 2, 3, 4])
  })

  it('keeps separate cores separate', () => {
    const a = new Core()
    const b = new Core()
    a.write16(0x10, 0xffff, 1)
    expect([b.read16(0x10), b.owner[0x10]]).toEqual([0, 0])
  })
})
