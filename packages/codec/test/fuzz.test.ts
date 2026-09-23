import { describe, expect, it } from 'bun:test'
import { spell } from '../src/format'
import {
  DECODE_DAT,
  DECODE_HLT,
  DECODE_INT3,
  DECODE_UNDEFINED,
  type Decoded,
  decode,
  decodeInto,
  EncodeError,
  encode,
  format,
  type Instr,
  instructionLength,
  type Operand,
  type Reader,
} from '../src/index'

const hex = (bytes: ArrayLike<number>) =>
  Array.from(bytes, (b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')
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

/** 100,000 random 8-byte strings, the same on every run. */
const STRINGS: readonly Uint8Array[] = (() => {
  const bytes = Uint8Array.from({ length: 100_000 * 8 }, lcg(0xf022))
  return Array.from({ length: 100_000 }, (_, i) => bytes.subarray(i * 8, i * 8 + 8))
})()

/** One line per operand with only the fields its kind defines, so scratch operands compare. */
function text(op: Operand): string {
  switch (op.kind) {
    case 'reg16':
    case 'reg8':
      return `${op.kind} ${op.reg}`
    case 'imm':
      return `imm ${op.value} ${op.size} ${op.signed}`
    case 'mem':
      return `mem ${op.base} ${op.index} ${op.disp} ${op.dispSize} ${op.size}`
    case 'rel':
      return `rel ${op.target} ${op.size}`
    case 'moffs':
      return `moffs ${op.addr} ${op.size}`
  }
}
const instrText = (i: Instr) =>
  `${i.prefix ?? ''} ${i.mnemonic} [${i.operands.map(text).join(', ')}] ${i.length}`

/** The bytes in hex, or the error code. */
const show = (r: Uint8Array | EncodeError) => (r instanceof EncodeError ? r.code : hex(r))

/** What `decodeInto` returns for a result of `decode`. */
const CODE = {
  dat: DECODE_DAT,
  hlt: DECODE_HLT,
  int3: DECODE_INT3,
  undefined: DECODE_UNDEFINED,
} as const

describe('fuzz: 100,000 random 8-byte strings', () => {
  it('decode never throws, and every length is 1..6', () => {
    const wrong: string[] = []
    const lengths = new Set<number>()
    for (const bytes of STRINGS) {
      let d: Decoded
      try {
        d = decode(reader(bytes), 0)
      } catch (e) {
        wrong.push(`${hex(bytes)}: threw ${e}`)
        continue
      }
      lengths.add(d.length)
      const ofInstr = 'instr' in d ? d.instr.length : d.length
      if (!(d.length >= 1 && d.length <= 6) || ofInstr !== d.length) {
        wrong.push(`${hex(bytes)}: length ${d.length}, instr.length ${ofInstr}`)
      }
    }
    expect(wrong.slice(0, 20)).toEqual([])
    expect([...lengths].sort()).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('reads the bytes of the instruction in order, once each, and no further', () => {
    const wrong: string[] = []
    const out: Instr = { mnemonic: 'nop', operands: [], length: 1 }
    // An undefined byte stops by the second byte: a ModR/M without a row, or a prefix without a
    // string instruction.
    const fine = (reads: number[], d: Decoded) =>
      (d.ok || d.reason !== 'undefined' ? reads.length === d.length : reads.length <= 2) &&
      reads.every((addr, i) => addr === i)
    for (const bytes of STRINGS) {
      const reads: number[] = []
      const read: Reader = (addr) => {
        reads.push(addr)
        return bytes[addr] ?? 0
      }
      const d = decode(read, 0)
      if (!fine(reads, d)) wrong.push(`${hex(bytes)}: decode read ${reads.join(' ')}`)
      reads.length = 0
      decodeInto(read, 0, out)
      if (!fine(reads, d)) wrong.push(`${hex(bytes)}: decodeInto read ${reads.join(' ')}`)
    }
    expect(wrong.slice(0, 20)).toEqual([])
  })

  it('decodeInto and instructionLength agree with decode', () => {
    const wrong: string[] = []
    const out: Instr = { mnemonic: 'nop', operands: [], length: 1 }
    for (const bytes of STRINGS) {
      const read = reader(bytes)
      const d = decode(read, 0)
      const code = decodeInto(read, 0, out)
      const want = d.ok ? d.length : CODE[d.reason]
      // On a kill, `out` holds the instruction; on an undefined byte, whatever it held before.
      const [ours, theirs] = 'instr' in d ? [instrText(out), instrText(d.instr)] : ['', '']
      if (code !== want || ours !== theirs) {
        wrong.push(`${hex(bytes)}: decodeInto ${code} \`${ours}\`, decode ${want} \`${theirs}\``)
      }
      const length = instructionLength(read, 0)
      if (length !== d.length) {
        wrong.push(`${hex(bytes)}: instructionLength ${length}, decode ${d.length}`)
      }
    }
    expect(wrong.slice(0, 20)).toEqual([])
  })

  it('format never throws, and never writes undefined or NaN', () => {
    const wrong: string[] = []
    for (const bytes of STRINGS) {
      const d = decode(reader(bytes), 0)
      for (const opts of [{}, { base: 0xfff0, upper: true, hexStyle: 'h' } as const]) {
        try {
          const t = format(d, opts)
          if (/undefined|NaN/i.test(t)) wrong.push(`${hex(bytes)}: \`${t}\``)
        } catch (e) {
          wrong.push(`${hex(bytes)}: threw ${e}`)
        }
      }
    }
    expect(wrong.slice(0, 20)).toEqual([])
  })

  // The codec's half of the text round trip: the input that format(x) spells encodes as x does.
  it('encodes spell(x), the input format(x) spells, as encode(x) for every ok result', () => {
    const wrong: string[] = []
    let checked = 0
    for (const bytes of STRINGS) {
      const d = decode(reader(bytes), 0)
      if (!d.ok) continue
      checked++
      const want = encode(d.instr)
      const got = encode(spell(d.instr))
      if (want instanceof EncodeError || show(got) !== show(want)) {
        const tag = `${hex(bytes.subarray(0, d.length))} \`${format(d)}\``
        wrong.push(`${tag}: ${show(got)}, not ${show(want)}`)
      }
    }
    expect(checked).toBeGreaterThan(60_000)
    expect(wrong.slice(0, 20)).toEqual([])
  })

  // The other half needs the assembler: its parser must read format(x) back as spell(x). Then
  // this becomes `encode(parse(format(x)))` equals `encode(x)` over the same strings.
  it.todo('assembles format(x) to the bytes of encode(x) for every ok result: deferred to 1.3')
})
