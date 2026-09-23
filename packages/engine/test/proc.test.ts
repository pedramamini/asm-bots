import { describe, expect, it } from 'bun:test'
import {
  AX,
  BP,
  BX,
  CX,
  DI,
  DX,
  FLAGS,
  getReg8,
  IP,
  PROC_FIELDS,
  ProcQueue,
  SI,
  SP,
  setReg8,
} from '../src/index'

/** A row holding AX..DI = 0x1122, 0x3344, ..., IP 0xABCD, FLAGS 0x0002. */
function sample(): Uint16Array {
  return Uint16Array.from([
    0x1122, 0x3344, 0x5566, 0x7788, 0x99aa, 0xbbcc, 0xddee, 0xff00, 0xabcd, 0x0002,
  ])
}

/** The queued rows, front first. */
function rows(q: ProcQueue): number[] {
  return Array.from({ length: q.size }, (_, i) => q.at(i))
}

/** The ring part of `data`: a permutation of the row numbers. */
function ring(q: ProcQueue): number[] {
  return Array.from(q.data.subarray(0, q.capacity))
}

/** The row part of `data`, copied. */
function fields(q: ProcQueue): number[] {
  return Array.from(q.data.subarray(q.capacity))
}

/** Pushes a process whose AX and IP carry `id`, so the test can tell processes apart. */
function spawn(q: ProcQueue, id: number): number {
  const r = q.push()
  const row = q.rows[r] as Uint16Array
  row.fill(0)
  row[AX] = id
  row[IP] = id ^ 0x5555
  return r
}

/** The ids of the queued processes, front first. */
function ids(q: ProcQueue): number[] {
  return rows(q).map((r) => {
    const row = q.rows[r] as Uint16Array
    expect(row[IP]).toBe((row[AX] as number) ^ 0x5555)
    return row[AX] as number
  })
}

describe('process rows', () => {
  it('put the registers in x86 order (ISA §1), then IP and FLAGS', () => {
    expect([AX, CX, DX, BX, SP, BP, SI, DI, IP, FLAGS]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(PROC_FIELDS).toBe(10)
  })

  it('read byte registers AL CL DL BL AH CH DH BH as halves of AX CX DX BX', () => {
    const row = sample()
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((code) => getReg8(row, code))).toEqual([
      0x22, 0x44, 0x66, 0x88, 0x11, 0x33, 0x55, 0x77,
    ])
  })

  it('write one half of a word and leave the rest of the row alone', () => {
    const cases = [
      [0, AX, 0x11ab],
      [1, CX, 0x33ab],
      [2, DX, 0x55ab],
      [3, BX, 0x77ab],
      [4, AX, 0xab22],
      [5, CX, 0xab44],
      [6, DX, 0xab66],
      [7, BX, 0xab88],
    ] as const
    for (const [code, field, word] of cases) {
      const row = sample()
      const want = Array.from(sample())
      want[field] = word
      setReg8(row, code, 0xab)
      expect([code, Array.from(row)]).toEqual([code, want])
      expect(getReg8(row, code)).toBe(0xab)
    }
  })

  it('keep the low 8 bits of a byte value', () => {
    const row = sample()
    for (const [v, want] of [
      [0x1ff, 0xff],
      [0x100, 0x00],
      [-1, 0xff],
      [-0x80, 0x80],
    ] as const) {
      setReg8(row, 4, v)
      expect([getReg8(row, 4), row[AX]]).toEqual([want, (want << 8) | 0x22])
      setReg8(row, 3, v)
      expect([getReg8(row, 3), row[BX]]).toEqual([want, 0x7700 | want])
    }
  })
})

describe('ProcQueue', () => {
  it('takes a capacity from 1 to 65536', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 0x10001]) {
      expect(() => new ProcQueue(bad)).toThrow(RangeError)
    }
    expect(new ProcQueue(1).capacity).toBe(1)
    const big = new ProcQueue(0x10000)
    expect([big.capacity, big.rows.length, ring(big)[0xffff]]).toEqual([0x10000, 0x10000, 0xffff])
  })

  it('starts empty, with a ring of free rows and zeroed fields', () => {
    const q = new ProcQueue(4)
    expect([q.size, q.head, q.data.length]).toEqual([0, 0, 4 * (PROC_FIELDS + 1)])
    expect(ring(q)).toEqual([0, 1, 2, 3])
    expect(fields(q).every((x) => x === 0)).toBe(true)
  })

  it('gives each row its own ten fields of data', () => {
    const q = new ProcQueue(3)
    for (let r = 0; r < 3; r++) {
      const row = q.rows[r] as Uint16Array
      expect([row.length, row.buffer === q.data.buffer]).toEqual([PROC_FIELDS, true])
      row.fill(r + 1)
    }
    expect(fields(q)).toEqual([...Array(10).fill(1), ...Array(10).fill(2), ...Array(10).fill(3)])
  })

  it('is first in, first out', () => {
    const q = new ProcQueue(8)
    for (let id = 1; id <= 5; id++) spawn(q, id)
    expect([q.size, ids(q)]).toEqual([5, [1, 2, 3, 4, 5]])
    const front = q.front()
    expect(q.shift()).toBe(front)
    expect(q.rows[front]?.[AX]).toBe(1)
    expect(ids(q)).toEqual([2, 3, 4, 5])
    spawn(q, 6)
    expect(ids(q)).toEqual([2, 3, 4, 5, 6])
  })

  it('rotates the front process to the back without moving any registers', () => {
    const q = new ProcQueue(4)
    for (let id = 1; id <= 3; id++) spawn(q, id)
    const before = fields(q)
    const r = q.front()
    q.rotate()
    expect(ids(q)).toEqual([2, 3, 1])
    expect(q.at(2)).toBe(r)
    expect(fields(q)).toEqual(before)
    q.rotate()
    q.rotate()
    expect(ids(q)).toEqual([1, 2, 3])
    expect(fields(q)).toEqual(before)
  })

  it('rotates a full queue by moving the head', () => {
    const q = new ProcQueue(3)
    for (let id = 1; id <= 3; id++) spawn(q, id)
    const before = ring(q)
    q.rotate()
    expect([ids(q), ring(q), q.head]).toEqual([[2, 3, 1], before, 1])
  })

  it('rotates a lone process', () => {
    const q = new ProcQueue(1)
    spawn(q, 7)
    q.rotate()
    q.rotate()
    expect([ids(q), q.head]).toEqual([[7], 0])
  })

  it('hands push only free rows, and a shifted row keeps its fields until push reuses it', () => {
    const q = new ProcQueue(3)
    spawn(q, 1)
    spawn(q, 2)
    const dead = q.shift()
    expect(Array.from(q.rows[dead] as Uint16Array)).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0x5554, 0])
    const r3 = spawn(q, 3)
    expect([r3 === dead, q.rows[dead]?.[AX]]).toEqual([false, 1])
    expect(spawn(q, 4)).toBe(dead)
    expect(ids(q)).toEqual([2, 3, 4])
  })

  it('refuses to push when full and to read, shift, or rotate when empty', () => {
    const q = new ProcQueue(2)
    expect(() => q.front()).toThrow(RangeError)
    expect(() => q.shift()).toThrow(RangeError)
    expect(() => q.rotate()).toThrow(RangeError)
    expect(() => q.at(0)).toThrow(RangeError)
    q.push()
    q.push()
    expect(() => q.push()).toThrow(RangeError)
    for (const i of [-1, 2, 0.5, Number.NaN]) expect(() => q.at(i)).toThrow(RangeError)
    q.shift()
    q.shift()
    expect(() => q.shift()).toThrow(RangeError)
    expect(q.size).toBe(0)
  })

  it('runs a turn at a time: the front runs, then rotates or shifts, and a spawn pushes', () => {
    // ISA §5.2 and §3.6. The running process counts, so SPL is a NOP when size === capacity.
    const q = new ProcQueue(3)
    spawn(q, 1)
    let next = 2
    const turn = (fate: 'live' | 'die' | 'split') => {
      const parent = q.rows[q.front()] as Uint16Array
      if (fate === 'die') {
        q.shift()
        return
      }
      q.rotate()
      if (fate === 'split' && q.size < q.capacity) {
        const child = q.rows[q.push()] as Uint16Array
        child.set(parent)
        child[AX] = next
        child[IP] = next++ ^ 0x5555
      }
    }
    turn('split')
    expect(ids(q)).toEqual([1, 2])
    turn('split')
    expect(ids(q)).toEqual([2, 1, 3])
    turn('split') // at the cap: SPL is a NOP
    expect(ids(q)).toEqual([1, 3, 2])
    turn('die')
    expect(ids(q)).toEqual([3, 2])
    turn('live')
    turn('split')
    expect(ids(q)).toEqual([3, 2, 4])
  })

  it('agrees with an array model over a long random run, for several capacities', () => {
    for (const capacity of [1, 2, 3, 7, 64]) {
      const q = new ProcQueue(capacity)
      const model: number[] = []
      let s = capacity
      let id = 0
      for (let step = 0; step < 20_000; step++) {
        s = (Math.imul(s, 1103515245) + 12345) >>> 0
        const pick = (s >>> 16) % 3
        if (pick === 0 && model.length < capacity) {
          spawn(q, ++id & 0xffff)
          model.push(id & 0xffff)
        } else if (pick === 1 && model.length > 0) {
          q.rotate()
          model.push(model.shift() as number)
        } else if (pick === 2 && model.length > 0) {
          const r = q.shift()
          expect(q.rows[r]?.[AX]).toBe(model.shift())
        }
        if (step % 97 === 0) {
          expect(ids(q)).toEqual(model)
          expect([...ring(q)].sort((a, b) => a - b)).toEqual(
            Array.from({ length: capacity }, (_, i) => i),
          )
        }
      }
      expect([q.size, ids(q)]).toEqual([model.length, model])
    }
  })

  it('is fully described by data, head, and size', () => {
    const q = new ProcQueue(5)
    for (let id = 1; id <= 4; id++) spawn(q, id)
    q.rotate()
    q.shift()
    q.rotate()
    const copy = new ProcQueue(5)
    copy.data.set(q.data)
    copy.head = q.head
    copy.size = q.size
    for (const x of [q, copy]) {
      spawn(x, 9)
      x.rotate()
      x.shift()
    }
    expect([ids(copy), fields(copy), ring(copy)]).toEqual([ids(q), fields(q), ring(q)])
  })
})
