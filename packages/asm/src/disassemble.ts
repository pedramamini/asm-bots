import {
  type Decoded,
  decode,
  EncodeError,
  encode,
  format,
  type Instr,
  type KillReason,
  type RelOperand,
} from '@asmbots/codec'
import { bytesHex, hexByte } from './hex'
import { isReserved } from './keywords'

/** One line of a disassembly (ISA §7): an instruction, or one byte that does not start one. */
export interface DisLine {
  /** The address of the first byte: `base` plus the offset in `bytes`, wrapping at 64 KB. */
  address: number
  /** The bytes the line covers: 1..6. */
  length: number
  /** NASM text that assembles to the bytes of the line at `address`. */
  text: string
  /** The bytes as uppercase hex pairs, as in the listing: `C7 07 00 00`. */
  bytesHex: string
  /** `instr` for an instruction that executes; otherwise why it kills (ISA §3.6, §3.7). */
  kind: 'instr' | KillReason
}

export interface DisassembleOptions {
  /** Names of addresses. A relative target at a named address prints as the name. */
  symbols?: ReadonlyMap<number, string> | undefined
}

/**
 * Disassembles `bytes` loaded at `base` (ISA §7) in a linear sweep: each line starts where the
 * line before it ends. Without `symbols`, the texts assemble back to `bytes` when the first one is
 * at address `base`: a bot starts at 0, so for another base they go after `resb base`.
 *
 * - An instruction prints as the codec's `format` writes it at its address, so a relative target
 *   is an absolute address (`jmp short 0x0100`). With `symbols`, a target at a named address
 *   prints as the name, with a `$` before a reserved word (`jmp $ax`), as the source writes it.
 * - DAT, HLT, and INT3 print as `dat`, `dat 0x41`, `hlt`, and `int3`.
 * - A byte that does not start an instruction prints as `db 0xNN`, and the sweep goes on at the
 *   next byte. So does the first byte of an instruction that runs past the end of `bytes`.
 * - Some instructions have two encodings (`01 C3` and `03 D8` are both `add bx, ax`), and NASM
 *   text assembles to only one of them, the one the codec's `encode` gives. An instruction in the
 *   other encoding prints as its bytes, with the instruction as a comment:
 *   `db 0x03, 0xD8 ; add bx, ax`.
 *
 * @throws RangeError when `base` is not an integer in 0..0xFFFF.
 */
export function disassemble(bytes: Uint8Array, base = 0, opts: DisassembleOptions = {}): DisLine[] {
  if (!Number.isInteger(base) || base < 0 || base > 0xffff) {
    throw new RangeError(`base must be an integer in 0..0xFFFF, not ${base}`)
  }
  const read = (offset: number) => bytes[offset] ?? 0
  const lines: DisLine[] = []
  for (let offset = 0; offset < bytes.length; ) {
    const address = (base + offset) & 0xffff
    const d = decode(read, offset)
    const whole = offset + d.length <= bytes.length
    const own = bytes.subarray(offset, offset + (whole ? d.length : 1))
    const { text, kind } =
      whole && 'instr' in d
        ? instrLine(d, own, address, opts.symbols)
        : { text: db(own), kind: 'undefined' as const }
    lines.push({ address, length: own.length, text, bytesHex: bytesHex(own), kind })
    offset += own.length
  }
  return lines
}

/** The text and kind of an instruction or a kill whose bytes are `own`. */
function instrLine(
  d: Extract<Decoded, { instr: Instr }>,
  own: Uint8Array,
  address: number,
  symbols: ReadonlyMap<number, string> | undefined,
): Pick<DisLine, 'text' | 'kind'> {
  const text = named(format(d, { base: address }), d.instr, address, symbols)
  const kind = d.ok ? 'instr' : d.reason
  return { text: encodesAs(d.instr, own) ? text : `${db(own)} ; ${text}`, kind }
}

/**
 * The encoder gives `instr` the bytes `own`. The assembler reads the text of `instr` back as an
 * input that encodes the same way (`test/roundtrip.test.ts`), so it then gives `own` too.
 */
function encodesAs(instr: Instr, own: Uint8Array): boolean {
  const bytes = encode(instr)
  if (bytes instanceof EncodeError || bytes.length !== own.length) return false
  return bytes.every((b, i) => b === own[i])
}

/** `db 0x03, 0xD8`. */
const db = (own: Uint8Array) => `db ${Array.from(own, (b) => `0x${hexByte(b)}`).join(', ')}`

/**
 * `text` with the name `symbols` gives the target of its relative operand, if it gives one. The
 * operand is the last one, and `format` writes it as a 4-digit address: `jmp short 0x000A`.
 */
function named(
  text: string,
  instr: Instr,
  address: number,
  symbols: ReadonlyMap<number, string> | undefined,
): string {
  const rel = instr.operands.find((op): op is RelOperand => op.kind === 'rel')
  if (symbols === undefined || rel === undefined) return text
  const target = (address + rel.target) & 0xffff
  const name = symbols.get(target)
  const printed = `0x${target.toString(16).toUpperCase().padStart(4, '0')}`
  if (name === undefined || !text.endsWith(printed)) return text
  return `${text.slice(0, -printed.length)}${isReserved(name.toLowerCase()) ? '$' : ''}${name}`
}
