import { describe, expect, it } from 'bun:test'
import {
  type Decoded,
  decode,
  EncodeError,
  encode,
  type FormatOptions,
  format,
  type InstrInput,
  type OperandInput,
  Reg8,
  Reg16,
} from '@asmbots/codec'
import type { InstrLine, OperandAst } from '../src/ast'
import { evaluate } from '../src/expr'
import { tokenize } from '../src/lexer'
import { parse } from '../src/parser'

/*
 * The disassembler (task 4) prints instructions with the codec's `format`, and the assembler
 * reads that text back. This checks the parser half: every text `format` writes parses without
 * a diagnostic, and the operands it yields encode to the bytes the instruction itself encodes to.
 */

const hex = (bytes: ArrayLike<number>) =>
  Array.from(bytes, (b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')

/** A deterministic stream of bytes (the codec fuzz test's generator, another seed). */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0
    return s >>> 24
  }
}

/** 100,000 random 8-byte strings, the same on every run. */
const STRINGS: readonly Uint8Array[] = (() => {
  const bytes = Uint8Array.from({ length: 100_000 * 8 }, lcg(0x7a5e))
  return Array.from({ length: 100_000 }, (_, i) => bytes.subarray(i * 8, i * 8 + 8))
})()

function value(op: { expr: Parameters<typeof evaluate>[0] }, here: number): number {
  const v = evaluate(op.expr, new Map(), here)
  if (typeof v !== 'number') throw new Error(v.message)
  return v
}

const SIZE = { short: 8, near: 16, auto: undefined } as const

/** The encoder input for an operand at address `here`, as the assembler will build it. */
function operandInput(op: OperandAst, here: number): OperandInput {
  switch (op.kind) {
    case 'reg':
      return op.name in Reg16
        ? { kind: 'reg16', reg: Reg16[op.name as keyof typeof Reg16] }
        : { kind: 'reg8', reg: Reg8[op.name as keyof typeof Reg8] }
    case 'imm':
      return { kind: 'imm', value: value(op, here), size: op.strict ? op.size : undefined }
    case 'mem': {
      const { base, index, size, dispSize } = op
      return { kind: 'mem', base, index, disp: value({ expr: op.disp }, here), dispSize, size }
    }
    case 'target':
      return { kind: 'rel', target: value(op, here) - here, size: SIZE[op.hint] }
    case 'str':
      throw new Error('a string operand')
  }
}

const instrInput = (line: InstrLine, here: number): InstrInput => ({
  mnemonic: line.mnemonic,
  prefix: line.prefix,
  operands: line.operands.map((op) => operandInput(op, here)),
})

const show = (r: Uint8Array | EncodeError) => (r instanceof EncodeError ? r.message : hex(r))

/** Why the text of `d` at `base` does not read back, or undefined. */
function mismatch(d: Decoded, opts: FormatOptions, base: number): string | undefined {
  const text = format(d, opts)
  const { lines, diags } = parse(tokenize(text))
  const [line] = lines
  if (diags.length > 0 || lines.length !== 1 || line === undefined) {
    return `${text}: ${diags.map((x) => x.message).join('; ')}`
  }
  if (!('instr' in d)) {
    const byte =
      line.kind === 'data' && line.operands[0]?.kind === 'imm' && value(line.operands[0], base)
    return line.kind === 'data' && line.mnemonic === 'db' && byte === d.byte ? undefined : text
  }
  if (line.kind !== 'instr') return `${text}: a ${line.kind} line`
  const want = show(encode(d.instr))
  const got = show(encode(instrInput(line, base)))
  return got === want ? undefined : `${text}: ${got}, want ${want}`
}

describe('parse: codec format output', () => {
  const styles: [string, FormatOptions][] = [
    ['default', {}],
    ['uppercase', { upper: true }],
    ['h-suffix hex', { hexStyle: 'h' }],
  ]
  for (const [name, opts] of styles) {
    it(`reads back ${name} text of 100,000 random instructions`, () => {
      const wrong: string[] = []
      for (const bytes of STRINGS) {
        const d = decode((addr) => bytes[addr] ?? 0, 0)
        const why = mismatch(d, opts, 0)
        if (why !== undefined) wrong.push(`${hex(bytes.subarray(0, d.length))}: ${why}`)
      }
      expect(wrong.slice(0, 20)).toEqual([])
    })
  }

  it('reads back absolute targets printed for a base address', () => {
    const wrong: string[] = []
    for (const [i, bytes] of STRINGS.entries()) {
      const base = (i * 0x9e37) & 0xffff
      const d = decode((addr) => bytes[addr] ?? 0, 0)
      const why = mismatch(d, { base }, base)
      if (why !== undefined) wrong.push(`${hex(bytes.subarray(0, d.length))} at ${base}: ${why}`)
    }
    expect(wrong.slice(0, 20)).toEqual([])
  })

  it('covers every kind of decoded instruction and operand', () => {
    const seen = new Set<string>()
    for (const bytes of STRINGS) {
      const d = decode((addr) => bytes[addr] ?? 0, 0)
      const [line] = parse(tokenize(format(d))).lines
      seen.add(d.ok ? 'ok' : d.reason)
      for (const op of line?.operands ?? []) {
        seen.add(op.kind)
        if (op.kind === 'imm' && op.strict) seen.add(`strict ${op.size}`)
        if (op.kind === 'mem' && op.dispSize !== undefined) seen.add(`disp ${op.dispSize}`)
        if (op.kind === 'target') seen.add(op.hint)
      }
      if (line?.kind === 'instr' && line.prefix !== undefined) seen.add(line.prefix)
    }
    expect([...seen].sort()).toEqual(
      [
        ...['ok', 'dat', 'hlt', 'int3', 'undefined'],
        ...['reg', 'imm', 'mem', 'target', 'strict 16', 'disp 8', 'disp 16'],
        ...['short', 'near', 'auto', 'rep', 'repe', 'repne'],
      ].sort(),
    )
  })
})
