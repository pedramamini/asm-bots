/**
 * The x16c v1 instruction model (docs/ISA_SPEC.md). The assembler, disassembler, engine, and
 * debugger all speak these types; none of them define their own.
 */

/** 16-bit register codes, x86 order (ISA §1): ModR/M `reg`/`rm` values and `+r` offsets. */
export const Reg16 = { ax: 0, cx: 1, dx: 2, bx: 3, sp: 4, bp: 5, si: 6, di: 7 } as const
export type Reg16 = (typeof Reg16)[keyof typeof Reg16]

/** 8-bit register codes, x86 order (ISA §1). */
export const Reg8 = { al: 0, cl: 1, dl: 2, bl: 3, ah: 4, ch: 5, dh: 6, bh: 7 } as const
export type Reg8 = (typeof Reg8)[keyof typeof Reg8]

/** Register names indexed by code. */
export const REG16_NAMES = ['ax', 'cx', 'dx', 'bx', 'sp', 'bp', 'si', 'di'] as const
export const REG8_NAMES = ['al', 'cl', 'dl', 'bl', 'ah', 'ch', 'dh', 'bh'] as const

/**
 * Canonical mnemonics, the spelling the disassembler prints. Where ISA §3 lists several
 * spellings, the canonical one is ndisasm's (`jnz`, `jc`, `jpe`, `loopne`, `shl`); the others
 * are `ALIASES`.
 */
export type Mnemonic =
  // §3.1 data movement
  | 'mov'
  | 'lea'
  | 'xchg'
  | 'push'
  | 'pop'
  | 'pushf'
  | 'popf'
  | 'sahf'
  | 'lahf'
  | 'cbw'
  | 'cwd'
  // §3.2 arithmetic and logic
  | 'add'
  | 'or'
  | 'adc'
  | 'sbb'
  | 'and'
  | 'sub'
  | 'xor'
  | 'cmp'
  | 'test'
  | 'not'
  | 'neg'
  | 'mul'
  | 'imul'
  | 'div'
  | 'idiv'
  | 'inc'
  | 'dec'
  | 'rol'
  | 'ror'
  | 'rcl'
  | 'rcr'
  | 'shl'
  | 'shr'
  | 'sar'
  // §3.3 control flow
  | 'jmp'
  | 'call'
  | 'ret'
  | 'jo'
  | 'jno'
  | 'jc'
  | 'jnc'
  | 'jz'
  | 'jnz'
  | 'jna'
  | 'ja'
  | 'js'
  | 'jns'
  | 'jpe'
  | 'jpo'
  | 'jl'
  | 'jnl'
  | 'jng'
  | 'jg'
  | 'loopne'
  | 'loope'
  | 'loop'
  | 'jcxz'
  // §3.4 string
  | 'movsb'
  | 'movsw'
  | 'cmpsb'
  | 'cmpsw'
  | 'stosb'
  | 'stosw'
  | 'lodsb'
  | 'lodsw'
  | 'scasb'
  | 'scasw'
  | 'cld'
  | 'std'
  // §3.5 flags and misc
  | 'clc'
  | 'stc'
  | 'cmc'
  | 'nop'
  // §3.6 process control
  | 'dat'
  | 'spl'
  | 'hlt'
  | 'int3'

/** REP-family prefix (ISA §2.1, §3.4). */
export type Prefix = 'rep' | 'repe' | 'repne'

/** Register operand; `reg` is the register code. */
export type RegOperand = { kind: 'reg16'; reg: Reg16 } | { kind: 'reg8'; reg: Reg8 }

/**
 * Immediate. When `signed`, the field is an imm8 the CPU sign-extends (`83 /n ib`) and `value`
 * is -128..127; otherwise `value` is the raw unsigned field.
 */
export interface ImmOperand {
  kind: 'imm'
  value: number
  size: 8 | 16
  signed: boolean
}

/**
 * ModR/M memory operand (ISA §2.2). No base and no index with `dispSize: 16` is `[disp16]`.
 * `size` is the data size: undefined when the source did not specify it (encoder input) or the
 * instruction accesses no data (`lea`).
 */
export interface MemOperand {
  kind: 'mem'
  base?: 'bx' | 'bp' | undefined
  index?: 'si' | 'di' | undefined
  disp: number
  dispSize: 0 | 8 | 16
  size: 8 | 16 | undefined
}

/**
 * Relative branch target, measured from the start of this instruction (NASM `$+target`), so the
 * operand is position independent. The encoded displacement is `target - length`.
 */
export interface RelOperand {
  kind: 'rel'
  target: number
  size: 8 | 16
}

/** Direct address of `A0..A3` (`mov al, [moffs16]` and friends); `size` is the data size. */
export interface MoffsOperand {
  kind: 'moffs'
  addr: number
  size: 8 | 16
}

export type Operand = RegOperand | ImmOperand | MemOperand | RelOperand | MoffsOperand

export interface Instr {
  mnemonic: Mnemonic
  operands: Operand[]
  prefix?: Prefix | undefined
  /** Encoded length in bytes, prefix included (1..6). */
  length: number
}

/*
 * Encoder input. Each `Operand` kind is also an `OperandInput`, so a decoded `Instr` is an
 * `InstrInput`. A size the input leaves undefined is the encoder's choice; a size it gives pins
 * the encoding, which is how a decoded instruction re-encodes to its own form. Numbers are
 * integers in -0x10000..0xFFFF (16-bit values, signed or unsigned, and address differences);
 * 16-bit fields keep the low 16 bits.
 */

/**
 * Immediate. `size` pins the width of the immediate field, like NASM `strict byte` and
 * `strict word`; undefined picks the shortest field that holds `value`.
 */
export interface ImmInput {
  kind: 'imm'
  value: number
  size?: 8 | 16 | undefined
}

/**
 * ModR/M memory operand. `size` is the data size; undefined takes it from the other operand.
 * `dispSize` pins the displacement field; undefined picks the shortest, and lets a bare
 * `[disp16]` use the `A0..A3` moffs forms.
 */
export interface MemInput {
  kind: 'mem'
  base?: 'bx' | 'bp' | undefined
  index?: 'si' | 'di' | undefined
  disp: number
  dispSize?: 0 | 8 | 16 | undefined
  size?: 8 | 16 | undefined
}

/** Relative target from the start of this instruction; undefined `size` prefers rel8. */
export interface RelInput {
  kind: 'rel'
  target: number
  size?: 8 | 16 | undefined
}

/** Direct address of `A0..A3`; undefined `size` takes it from AL or AX. */
export interface MoffsInput {
  kind: 'moffs'
  addr: number
  size?: 8 | 16 | undefined
}

export type OperandInput = RegOperand | ImmInput | MemInput | RelInput | MoffsInput

export interface InstrInput {
  /** Canonical mnemonic or an alias from `ALIASES`, in any case. */
  mnemonic: string
  operands: readonly OperandInput[]
  /** Canonical prefix or an alias from `PREFIX_ALIASES`, in any case. */
  prefix?: string | undefined
}
