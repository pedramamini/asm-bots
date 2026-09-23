import type { Decoded } from './decode'
import type { OpcodeRow } from './table'
import { TABLE } from './table'
import type {
  Instr,
  InstrInput,
  MemInput,
  MemOperand,
  Mnemonic,
  Operand,
  OperandInput,
  RegOperand,
} from './types'
import { REG8_NAMES, REG16_NAMES } from './types'

/** How `format` writes an instruction. */
export interface FormatOptions {
  /** Mnemonics, prefixes, registers, and keywords in uppercase. Hex digits are always uppercase. */
  upper?: boolean | undefined
  /** NASM hex notation: `0x1F` (default) or `1Fh`. */
  hexStyle?: '0x' | 'h' | undefined
  /**
   * The address of the instruction. With it, relative targets print as absolute addresses
   * (`0x1A2F`), which re-assemble to the same bytes only at that address. Without it, they print
   * as `$`, `$ + N`, or `$ - N`, which re-assemble anywhere. NASM never makes a conditional jump
   * to a bare number rel8; it needs `$$ + 0x1A2F` for the same bytes.
   */
  base?: number | undefined
}

function mnemonicsWith(has: (row: OpcodeRow) => boolean): ReadonlySet<Mnemonic> {
  return new Set(TABLE.filter(has).map((r) => r.mnemonic))
}

/** Shifts and rotates. Their `CL` operand is a count, so it does not give the data size. */
const COUNTS = mnemonicsWith((r) => r.operands.includes('CL'))

/** The ALU ops. Left to choose, the encoder puts an immediate that fits a signed byte in `83`. */
const SIGN_EXTENDS = mnemonicsWith((r) => r.signExtend && r.operands.includes('imm8'))

/** Left to choose, the encoder takes rel8 for a target in range. `jmp` and `spl` have rel16 too. */
const REL8 = mnemonicsWith((r) => r.operands.includes('rel8'))

/** `mov`. Left to choose, the encoder takes `A0..A3` for AL or AX with a bare address. */
const MOFFS = mnemonicsWith((r) => r.operands.includes('moffs8') || r.operands.includes('moffs16'))

const fitsByte = (n: number) => n >= -128 && n <= 127

/** The low 16 bits of `n`, read as signed. */
const s16 = (n: number) => ((n & 0xffff) << 16) >> 16

function isReg(op: Operand | undefined): op is RegOperand {
  return op?.kind === 'reg8' || op?.kind === 'reg16'
}

/**
 * The encoder input that `format(instr)` writes out, which is what the assembler reads back. A
 * size the encoder would choose anyway is left open; a size it would choose differently is
 * pinned, so `encode(spell(instr))` gives the bytes of `encode(instr)`. Two sizes are spelled out
 * even though the encoder would choose them: the data size of memory when no register gives it
 * (ISA §6.3, and NASM needs it: `push word [bx]`), and rel8 on `jmp` (`jmp short`, ISA §8).
 */
export function spell(instr: Instr): InstrInput {
  const { mnemonic, operands, prefix } = instr
  const [first] = operands
  // `dat` alone is `dat 0` (ISA §3.6).
  if (mnemonic === 'dat' && first?.kind === 'imm' && first.value === 0) {
    return { mnemonic, operands: [], prefix }
  }
  // A register gives the data size, except the count of a shift (`shl byte [bx], cl`).
  const sized = operands.some((op, i) => isReg(op) && !(i === 1 && COUNTS.has(mnemonic)))
  return {
    mnemonic,
    operands: operands.map((op, i) => spellOperand(mnemonic, op, operands[1 - i], sized)),
    prefix,
  }
}

function spellOperand(
  mnemonic: Mnemonic,
  op: Operand,
  other: Operand | undefined,
  sized: boolean,
): OperandInput {
  switch (op.kind) {
    case 'reg8':
      return { kind: 'reg8', reg: op.reg }
    case 'reg16':
      return { kind: 'reg16', reg: op.reg }
    case 'imm': {
      // `81 /n iw` or `05 iw` holding a value `83 /n ib` holds: `add ax, strict word 5`.
      const strict = op.size === 16 && SIGN_EXTENDS.has(mnemonic) && fitsByte(s16(op.value))
      return { kind: 'imm', value: op.value, size: strict ? 16 : undefined }
    }
    case 'rel': {
      // rel16 where the 2-byte rel8 form reaches the target too: `jmp near $ + 5`.
      const near = op.size === 16 && REL8.has(mnemonic) && fitsByte(s16(op.target - 2))
      const short = op.size === 8 && mnemonic === 'jmp'
      return { kind: 'rel', target: op.target, size: near || short ? op.size : undefined }
    }
    case 'moffs':
      return { kind: 'mem', disp: op.addr & 0xffff, size: sized ? undefined : op.size }
    case 'mem':
      return spellMem(mnemonic, op, other, sized ? undefined : op.size)
  }
}

function spellMem(
  mnemonic: Mnemonic,
  op: MemOperand,
  other: Operand | undefined,
  size: 8 | 16 | undefined,
): MemInput {
  const { base, index } = op
  if (base === undefined && index === undefined) {
    // ModR/M [disp16]. With AL or AX, `mov` would take A0..A3: `mov ax, [word 0x0100]`.
    const pin = MOFFS.has(mnemonic) && isReg(other) && other.reg === 0
    return { kind: 'mem', disp: op.disp & 0xffff, dispSize: pin ? 16 : undefined, size }
  }
  // The shortest displacement (ISA §2.2): none for 0, except [bp], which takes disp8 0; disp8 for
  // -128..127; else disp16. A longer one is pinned: `[byte bx+0]`, `[word bx-2]`.
  const disp = s16(op.disp)
  const bp = base === 'bp' && index === undefined
  const shortest = disp === 0 && !bp ? 0 : fitsByte(disp) ? 8 : 16
  const dispSize = op.dispSize === shortest ? undefined : op.dispSize
  return { kind: 'mem', base, index, disp, dispSize, size }
}

type HexStyle = '0x' | 'h'

interface Style {
  /** A mnemonic, prefix, register, or keyword in the chosen case. */
  readonly word: (s: string) => string
  readonly hex: HexStyle
  readonly base: number | undefined
}

const SIZE = { 8: 'byte', 16: 'word' } as const

function hex(n: number, digits: number, style: HexStyle): string {
  const text = n.toString(16).toUpperCase().padStart(digits, '0')
  if (style === '0x') return `0x${text}`
  // NASM reads `FFh` as a name, so a leading letter needs a 0: `0FFh`.
  return /^[A-F]/.test(text) ? `0${text}h` : `${text}h`
}

/** Magnitudes below 16 in decimal, larger ones in hex: `4`, `-10`, `0x41`, `-0x80`. */
function num(n: number, style: HexStyle): string {
  const m = Math.abs(n)
  const text = m < 16 ? String(m) : hex(m, 1, style)
  return n < 0 ? `-${text}` : text
}

/** A 16-bit address as 4 hex digits: `[0x0100]`, `jmp short 0x1A2F`. */
function address(n: number, style: HexStyle): string {
  return hex(n & 0xffff, 4, style)
}

/** A target relative to the instruction: `$`, `$ + 3`, `$ - 10`, `$ + 0x200`. */
function relative(target: number, style: HexStyle): string {
  if (target === 0) return '$'
  return target < 0 ? `$ - ${num(-target, style)}` : `$ + ${num(target, style)}`
}

/** `word [bx+si+4]`: data size, then `[`, displacement size, registers, displacement. */
function memText(op: MemInput, st: Style): string {
  const size = op.size === undefined ? '' : `${st.word(SIZE[op.size])} `
  const pin = op.dispSize === 8 || op.dispSize === 16 ? `${st.word(SIZE[op.dispSize])} ` : ''
  const regs = [op.base, op.index].flatMap((r) => (r === undefined ? [] : [st.word(r)])).join('+')
  let ea: string
  if (regs === '') ea = address(op.disp, st.hex)
  else if (op.disp === 0 && pin === '') ea = regs
  else ea = `${regs}${op.disp < 0 ? '-' : '+'}${num(Math.abs(op.disp), st.hex)}`
  return `${size}[${pin}${ea}]`
}

function operandText(op: OperandInput, st: Style): string {
  switch (op.kind) {
    case 'reg8':
      return st.word(REG8_NAMES[op.reg])
    case 'reg16':
      return st.word(REG16_NAMES[op.reg])
    case 'imm': {
      const value = num(op.value, st.hex)
      if (op.size === undefined) return value
      return `${st.word('strict')} ${st.word(SIZE[op.size])} ${value}`
    }
    case 'rel': {
      const target =
        st.base === undefined ? relative(op.target, st.hex) : address(st.base + op.target, st.hex)
      if (op.size === undefined) return target
      return `${st.word(op.size === 8 ? 'short' : 'near')} ${target}`
    }
    case 'mem':
      return memText(op, st)
    case 'moffs':
      return memText({ kind: 'mem', disp: op.addr, size: op.size }, st)
  }
}

function render(x: InstrInput, st: Style): string {
  const name = st.word(x.mnemonic)
  const head = x.prefix === undefined ? name : `${st.word(x.prefix)} ${name}`
  if (x.operands.length === 0) return head
  return `${head} ${x.operands.map((op) => operandText(op, st)).join(', ')}`
}

/**
 * NASM text for an instruction (ISA §6, §7) that the assembler reads back as `spell(instr)`, so
 * it re-assembles to the same bytes wherever any text can. Some encodings have a twin that the
 * encoder prefers (`FF C3` and `43` are both `inc bx`, `8B D8` and `89 C3` both `mov bx, ax`);
 * their text re-assembles to the twin. Memory prints as `[bp]`, `[bx+di-2]`, and `[0x0100]`;
 * values below 16 in decimal, larger ones in hex. Kills print as `dat`, `dat 0x41`, `hlt`, and
 * `int3`, and an undefined byte as `db 0xNN`.
 */
export function format(x: Instr | Decoded, opts: FormatOptions = {}): string {
  const st: Style = {
    word: opts.upper === true ? (s) => s.toUpperCase() : (s) => s,
    hex: opts.hexStyle ?? '0x',
    base: opts.base,
  }
  if (!('ok' in x)) return render(spell(x), st)
  if (x.ok || x.reason !== 'undefined') return render(spell(x.instr), st)
  return `${st.word('db')} ${hex(x.byte, 2, st.hex)}`
}
