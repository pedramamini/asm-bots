import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type Decoded,
  decode,
  EncodeError,
  encode,
  type FormatOptions,
  format,
  type Reader,
} from '@asmbots/codec'
import { assemble } from '../src/assemble'
import { disassemble } from '../src/disassemble'
import { tokenize } from '../src/lexer'
import { parse } from '../src/parser'

/*
 * ISA §7: the text of a disassembly assembles back to the same bytes. The codec's `format` writes
 * the text of an instruction; its fuzz test checks that the input the text spells encodes as the
 * instruction does. This checks the whole trip, text to bytes, through `assemble`.
 */

const hex = (bytes: ArrayLike<number>) =>
  Array.from(bytes, (b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')
const reader =
  (bytes: ArrayLike<number>): Reader =>
  (addr) =>
    bytes[addr] ?? 0

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

/** What each string starts with. */
const DECODED: readonly Decoded[] = STRINGS.map((bytes) => decode(reader(bytes), 0))

/** The bytes of the instruction each string starts with, for the `ok` ones. */
const OK: readonly Uint8Array[] = DECODED.flatMap((d, i) =>
  d.ok ? [(STRINGS[i] as Uint8Array).subarray(0, d.length)] : [],
)

/** Lines per `assemble` call. A disassembly assembles as one bot: its targets are addresses. */
const BATCH = 1000

function batches<T>(items: readonly T[]): (readonly T[])[] {
  return Array.from({ length: Math.ceil(items.length / BATCH) }, (_, i) =>
    items.slice(i * BATCH, (i + 1) * BATCH),
  )
}

/**
 * Assembles `lines` as one bot from address 0, with the `%name` line last so the line numbers
 * stay. Returns the bytes, and the bytes of each line in hex. A diagnostic fails the test, with the
 * text of its line.
 */
function assembleLines(lines: readonly string[]): { bytes: Uint8Array; each: string[] } {
  const { bytes, listing, diagnostics } = assemble(`${lines.join('\n')}\n%name "x"`, {
    maxBytes: 0x10000,
  })
  expect(diagnostics.slice(0, 20).map((d) => `\`${lines[d.line - 1]}\`: ${d.message}`)).toEqual([])
  return { bytes, each: listing.slice(0, lines.length).map((l) => l.bytesHex) }
}

/** The bytes the assembler must make of `format(d)`: the codec's encoding, or the one byte. */
function encoded(d: Decoded): string {
  if (!('instr' in d)) return hex([d.byte])
  const bytes = encode(d.instr)
  return bytes instanceof EncodeError ? bytes.code : hex(bytes)
}

describe('round trip: format', () => {
  const styles: [string, FormatOptions][] = [
    ['default', {}],
    ['uppercase', { upper: true }],
    ['h-suffix hex', { hexStyle: 'h' }],
  ]
  for (const [name, opts] of styles) {
    it(`assembles the ${name} text of 100,000 random decodes to the codec's bytes`, () => {
      const wrong: string[] = []
      for (const batch of batches(DECODED)) {
        const texts = batch.map((d) => format(d, opts))
        const { each } = assembleLines(texts)
        for (const [i, d] of batch.entries()) {
          const want = encoded(d)
          if (each[i] !== want) wrong.push(`\`${texts[i]}\`: ${each[i]}, want ${want}`)
        }
      }
      expect(wrong.slice(0, 20)).toEqual([])
    })
  }

  // The codec encodes an instruction as NASM does, so the text of an instruction in the other
  // encoding of a pair (`03 D8` for `01 C3`, `add bx, ax`) assembles to the encoder's one.
  it('gives the bytes of every ok instruction back, except the other encoding of a pair', () => {
    const wrong: string[] = []
    let same = 0
    let twins = 0
    for (const [i, d] of DECODED.entries()) {
      if (!d.ok) continue
      const original = (STRINGS[i] as Uint8Array).subarray(0, d.length)
      const bytes = encode(d.instr)
      if (bytes instanceof EncodeError) {
        wrong.push(`${hex(original)}: ${bytes.message}`)
      } else if (hex(bytes) === hex(original)) {
        same++
      } else {
        twins++
        // The same instruction, never longer. `xchg r16, ax` comes back as `xchg ax, r16` (`90+r`).
        const again = format(decode(reader(bytes), 0))
        const swapped =
          d.instr.mnemonic === 'xchg'
            ? format({ ...d.instr, operands: [...d.instr.operands].reverse() })
            : undefined
        if ((again !== format(d) && again !== swapped) || bytes.length > original.length) {
          wrong.push(`${hex(original)} \`${format(d)}\`: ${hex(bytes)} \`${again}\``)
        }
      }
    }
    expect(wrong.slice(0, 20)).toEqual([])
    expect(same).toBeGreaterThan(60_000)
    expect(twins).toBeGreaterThan(1_000)
  })

  it('covers every kind of decoded instruction and operand', () => {
    const seen = new Set<string>()
    for (const d of DECODED) {
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

const concat = (parts: readonly Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

describe('round trip: disassemble', () => {
  it('assembles concatenations of instructions in the encoder form back, with no db line', () => {
    const forms = DECODED.flatMap((d) => {
      const bytes = 'instr' in d ? encode(d.instr) : undefined
      return bytes instanceof Uint8Array ? [bytes] : []
    })
    expect(forms.length).toBeGreaterThan(60_000)
    for (const batch of batches(forms)) {
      const bytes = concat(batch)
      const lines = disassemble(bytes)
      expect(lines.map((l) => l.bytesHex)).toEqual(batch.map(hex))
      expect(lines.filter((l) => l.text.startsWith('db ')).map((l) => l.text)).toEqual([])
      expect(hex(assembleLines(lines.map((l) => l.text)).bytes)).toBe(hex(bytes))
    }
  })

  it('assembles every ok instruction of 100,000 random strings back to its own bytes', () => {
    const next = lcg(0x0bad)
    let twins = 0
    for (const batch of batches(OK)) {
      const bytes = concat(batch)
      // Each batch at a random base, so relative targets print as addresses all over the core.
      const base = ((next() << 8) | next()) % (0x10000 - bytes.length)
      const lines = disassemble(bytes, base)
      expect(lines.map((l) => l.bytesHex)).toEqual(batch.map(hex))
      expect(lines.every((l) => l.kind === 'instr')).toBe(true)
      twins += lines.filter((l) => l.text.startsWith('db ')).length
      const out = assembleLines([`resb ${base}`, ...lines.map((l) => l.text)]).bytes
      expect(hex(out.subarray(base))).toBe(hex(bytes))
    }
    expect(twins).toBeGreaterThan(1_000)
  })

  it('assembles any bytes back, and covers them with lines end to end', () => {
    const next = lcg(0xd15a)
    for (let n = 0; n < 64; n++) {
      const bytes = Uint8Array.from({ length: 4096 }, next)
      const lines = disassemble(bytes)
      const offsets = lines.map((l) => l.address)
      const ends = lines.map((l) => l.address + l.length)
      expect(offsets.slice(1)).toEqual(ends.slice(0, -1))
      expect(lines.every((l) => l.length === l.bytesHex.split(' ').length)).toBe(true)
      expect(lines.map((l) => l.bytesHex).join(' ')).toBe(hex(bytes))
      expect(hex(assembleLines(lines.map((l) => l.text)).bytes)).toBe(hex(bytes))
    }
  })

  it('assembles bytes disassembled at any base back, at that address', () => {
    const next = lcg(0xba5e)
    const size = 1024
    const top = 0x10000 - size
    const random = Array.from({ length: 62 }, () => ((next() << 8) | next()) % top)
    for (const base of [0, top, ...random]) {
      const bytes = Uint8Array.from({ length: size }, next)
      const lines = disassemble(bytes, base)
      const out = assembleLines([`resb ${base}`, ...lines.map((l) => l.text)]).bytes
      expect(hex(out.subarray(base))).toBe(hex(bytes))
    }
  })

  // A stand-in for ISA §7's roster bots until packages/bots has some.
  it('assembles every fixture bot back', () => {
    const dir = join(import.meta.dir, 'fixtures', 'parse')
    let bots = 0
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.asm'))) {
      const source = readFileSync(join(dir, file), 'utf8')
      const named = /%name/i.test(source) ? source : `${source}\n%name "x"`
      const { bytes, diagnostics } = assemble(named, { maxBytes: 0x10000 })
      if (diagnostics.length > 0 || bytes.length === 0) continue
      bots++
      const lines = disassemble(bytes)
      expect(hex(assembleLines(lines.map((l) => l.text)).bytes)).toBe(hex(bytes))
    }
    expect(bots).toBeGreaterThanOrEqual(5)
  })
})
