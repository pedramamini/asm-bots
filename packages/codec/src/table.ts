import type { Mnemonic, Prefix } from './types'

/**
 * Operand template, Intel notation (ISA §3).
 * - `r/m8`, `r/m16`: ModR/M `rm` field, register or memory.
 * - `m`: ModR/M memory only; `mod=11` is undefined (`lea`).
 * - `r8`, `r16`: ModR/M `reg` field register.
 * - `+r8`, `+r16`: register in the low 3 bits of the opcode (`opcode & 7`).
 * - `AL`, `AX`, `CL`: fixed register. `1`: the implicit shift count.
 * - `imm8`, `imm16`: immediate field.
 * - `moffs8`, `moffs16`: 16-bit direct address of byte or word data.
 * - `rel8`, `rel16`: signed displacement from the next instruction.
 */
export type OperandTemplate =
  | 'r/m8'
  | 'r/m16'
  | 'm'
  | 'r8'
  | 'r16'
  | '+r8'
  | '+r16'
  | 'AL'
  | 'AX'
  | 'CL'
  | '1'
  | 'imm8'
  | 'imm16'
  | 'moffs8'
  | 'moffs16'
  | 'rel8'
  | 'rel16'

export interface OpcodeRow {
  /** The exact opcode byte. A `+r` form is one row per register. */
  readonly opcode: number
  /** ModR/M `reg` field value (`/n`) that selects this row inside a group opcode. */
  readonly ext?: number
  readonly mnemonic: Mnemonic
  readonly operands: readonly OperandTemplate[]
  /** Bits in the field after ModR/M and displacement: `ib`/`cb` = 8, `iw`/`cw` = 16. */
  readonly immSize: 0 | 8 | 16
  /** The 8-bit field is signed and sign-extended (ISA §2.3). */
  readonly signExtend: boolean
  /** Other spellings of `mnemonic`; identical on every row of that mnemonic. */
  readonly aliases: readonly string[]
  /** REP prefixes this string instruction accepts (ISA §3.4). No other row takes a prefix. */
  readonly prefixes?: readonly Prefix[]
  /** Executing this row kills the process (ISA §3.6). */
  readonly kills?: true
}

interface RowOpts {
  ext?: number
  signExtend?: boolean
  aliases?: readonly string[]
  prefixes?: readonly Prefix[]
  kills?: true
}

const TRAILING_SIZE: Partial<Record<OperandTemplate, 8 | 16>> = {
  imm8: 8,
  rel8: 8,
  imm16: 16,
  rel16: 16,
  moffs8: 16,
  moffs16: 16,
}

function row(
  opcode: number,
  mnemonic: Mnemonic,
  operands: readonly OperandTemplate[],
  opts: RowOpts = {},
): OpcodeRow {
  const { signExtend = operands.includes('rel8'), aliases = [], ...rest } = opts
  let immSize: 0 | 8 | 16 = 0
  for (const t of operands) immSize = TRAILING_SIZE[t] ?? immSize
  return { opcode, mnemonic, operands, immSize, signExtend, aliases, ...rest }
}

/** One row per register code `first..7` at `base + r`. */
function plusR(
  base: number,
  mnemonic: Mnemonic,
  operands: readonly OperandTemplate[],
  first = 0,
): OpcodeRow[] {
  const rows: OpcodeRow[] = []
  for (let r = first; r < 8; r++) rows.push(row(base + r, mnemonic, operands))
  return rows
}

/** ISA §3.2 group pattern; op index n is the position in this list. */
const ALU_OPS = ['add', 'or', 'adc', 'sbb', 'and', 'sub', 'xor', 'cmp'] as const

function alu(): OpcodeRow[] {
  const rows: OpcodeRow[] = []
  for (const [n, m] of ALU_OPS.entries()) {
    const b = n << 3
    // `(n<<3)+00 /r` is `op r/m8, r8`, but 0x00 is DAT (ISA §9.1).
    if (b !== 0) rows.push(row(b, m, ['r/m8', 'r8']))
    rows.push(
      row(b + 1, m, ['r/m16', 'r16']),
      row(b + 2, m, ['r8', 'r/m8']),
      row(b + 3, m, ['r16', 'r/m16']),
      row(b + 4, m, ['AL', 'imm8']),
      row(b + 5, m, ['AX', 'imm16']),
      row(0x80, m, ['r/m8', 'imm8'], { ext: n }),
      row(0x81, m, ['r/m16', 'imm16'], { ext: n }),
      row(0x83, m, ['r/m16', 'imm8'], { ext: n, signExtend: true }),
    )
  }
  return rows
}

/** `F6 /n` and `F7 /n` single-operand group (ISA §3.2); `/0` is TEST and `/1` is undefined. */
function unary(): OpcodeRow[] {
  const ops = [
    [2, 'not'],
    [3, 'neg'],
    [4, 'mul'],
    [5, 'imul'],
    [6, 'div'],
    [7, 'idiv'],
  ] as const
  return ops.flatMap(([ext, m]) => [
    row(0xf6, m, ['r/m8'], { ext }),
    row(0xf7, m, ['r/m16'], { ext }),
  ])
}

/** Shift extensions `/0..7` (ISA §3.2); `/6` is undefined. */
const SHIFT_OPS = ['rol', 'ror', 'rcl', 'rcr', 'shl', 'shr', undefined, 'sar'] as const

function shifts(): OpcodeRow[] {
  const rows: OpcodeRow[] = []
  for (const [ext, m] of SHIFT_OPS.entries()) {
    if (m === undefined) continue
    const aliases = m === 'shl' ? ['sal'] : []
    rows.push(
      row(0xd0, m, ['r/m8', '1'], { ext, aliases }),
      row(0xd1, m, ['r/m16', '1'], { ext, aliases }),
      row(0xd2, m, ['r/m8', 'CL'], { ext, aliases }),
      row(0xd3, m, ['r/m16', 'CL'], { ext, aliases }),
    )
  }
  return rows
}

/** `70+cc cb` in condition-code order: canonical spelling first, then ISA §3.3 aliases. */
const JCC: readonly (readonly [Mnemonic, ...string[]])[] = [
  ['jo'],
  ['jno'],
  ['jc', 'jb', 'jnae'],
  ['jnc', 'jae', 'jnb'],
  ['jz', 'je'],
  ['jnz', 'jne'],
  ['jna', 'jbe'],
  ['ja', 'jnbe'],
  ['js'],
  ['jns'],
  ['jpe', 'jp'],
  ['jpo', 'jnp'],
  ['jl', 'jnge'],
  ['jnl', 'jge'],
  ['jng', 'jle'],
  ['jg', 'jnle'],
]

function jcc(): OpcodeRow[] {
  return JCC.map(([m, ...aliases], cc) => row(0x70 + cc, m, ['rel8'], { aliases }))
}

const REP: readonly Prefix[] = ['rep']
const REPE: readonly Prefix[] = ['repe', 'repne']

/**
 * The x16c v1 opcode table, in ISA §3 order: every row of §3.1..§3.6 and nothing else. Any
 * `(opcode, ext)` not listed here is undefined and kills the process (ISA §3.7).
 */
export const TABLE: readonly OpcodeRow[] = Object.freeze([
  // §3.1 Data movement
  row(0x88, 'mov', ['r/m8', 'r8']),
  row(0x89, 'mov', ['r/m16', 'r16']),
  row(0x8a, 'mov', ['r8', 'r/m8']),
  row(0x8b, 'mov', ['r16', 'r/m16']),
  row(0x8d, 'lea', ['r16', 'm']),
  row(0xa0, 'mov', ['AL', 'moffs8']),
  row(0xa1, 'mov', ['AX', 'moffs16']),
  row(0xa2, 'mov', ['moffs8', 'AL']),
  row(0xa3, 'mov', ['moffs16', 'AX']),
  ...plusR(0xb0, 'mov', ['+r8', 'imm8']),
  ...plusR(0xb8, 'mov', ['+r16', 'imm16']),
  row(0xc6, 'mov', ['r/m8', 'imm8'], { ext: 0 }),
  row(0xc7, 'mov', ['r/m16', 'imm16'], { ext: 0 }),
  row(0x86, 'xchg', ['r/m8', 'r8']),
  row(0x87, 'xchg', ['r/m16', 'r16']),
  // 0x90 would be `xchg ax, ax`; it is NOP (§3.5).
  ...plusR(0x90, 'xchg', ['AX', '+r16'], 1),
  ...plusR(0x50, 'push', ['+r16']),
  ...plusR(0x58, 'pop', ['+r16']),
  row(0xff, 'push', ['r/m16'], { ext: 6 }),
  row(0x8f, 'pop', ['r/m16'], { ext: 0 }),
  row(0x9c, 'pushf', []),
  row(0x9d, 'popf', []),
  row(0x9e, 'sahf', []),
  row(0x9f, 'lahf', []),
  row(0x98, 'cbw', []),
  row(0x99, 'cwd', []),

  // §3.2 Arithmetic and logic
  ...alu(),
  row(0x84, 'test', ['r/m8', 'r8']),
  row(0x85, 'test', ['r/m16', 'r16']),
  row(0xa8, 'test', ['AL', 'imm8']),
  row(0xa9, 'test', ['AX', 'imm16']),
  row(0xf6, 'test', ['r/m8', 'imm8'], { ext: 0 }),
  row(0xf7, 'test', ['r/m16', 'imm16'], { ext: 0 }),
  ...unary(),
  ...plusR(0x40, 'inc', ['+r16']),
  ...plusR(0x48, 'dec', ['+r16']),
  row(0xfe, 'inc', ['r/m8'], { ext: 0 }),
  row(0xff, 'inc', ['r/m16'], { ext: 0 }),
  row(0xfe, 'dec', ['r/m8'], { ext: 1 }),
  row(0xff, 'dec', ['r/m16'], { ext: 1 }),
  ...shifts(),

  // §3.3 Control flow
  row(0xeb, 'jmp', ['rel8']),
  row(0xe9, 'jmp', ['rel16']),
  row(0xff, 'jmp', ['r/m16'], { ext: 4 }),
  row(0xe8, 'call', ['rel16']),
  row(0xff, 'call', ['r/m16'], { ext: 2 }),
  row(0xc3, 'ret', []),
  row(0xc2, 'ret', ['imm16']),
  ...jcc(),
  row(0xe0, 'loopne', ['rel8'], { aliases: ['loopnz'] }),
  row(0xe1, 'loope', ['rel8'], { aliases: ['loopz'] }),
  row(0xe2, 'loop', ['rel8']),
  row(0xe3, 'jcxz', ['rel8']),

  // §3.4 String instructions
  row(0xa4, 'movsb', [], { prefixes: REP }),
  row(0xa5, 'movsw', [], { prefixes: REP }),
  row(0xa6, 'cmpsb', [], { prefixes: REPE }),
  row(0xa7, 'cmpsw', [], { prefixes: REPE }),
  row(0xaa, 'stosb', [], { prefixes: REP }),
  row(0xab, 'stosw', [], { prefixes: REP }),
  row(0xac, 'lodsb', [], { prefixes: REP }),
  row(0xad, 'lodsw', [], { prefixes: REP }),
  row(0xae, 'scasb', [], { prefixes: REPE }),
  row(0xaf, 'scasw', [], { prefixes: REPE }),
  row(0xfc, 'cld', []),
  row(0xfd, 'std', []),

  // §3.5 Flags and misc
  row(0xf8, 'clc', []),
  row(0xf9, 'stc', []),
  row(0xf5, 'cmc', []),
  row(0x90, 'nop', []),

  // §3.6 Process control. DAT is 2 bytes: `00` plus any byte (`dat` = `dat 0`).
  row(0x00, 'dat', ['imm8'], { kills: true }),
  row(0x60, 'spl', ['rel8']),
  row(0x61, 'spl', ['rel16']),
  row(0x62, 'spl', ['r/m16'], { ext: 0 }),
  row(0xf4, 'hlt', [], { kills: true }),
  row(0xcc, 'int3', [], { kills: true }),
])

/** Sorted unique canonical mnemonics. */
export const MNEMONICS: readonly Mnemonic[] = Object.freeze(
  [...new Set(TABLE.map((r) => r.mnemonic))].sort(),
)

/** Alternate spelling → canonical mnemonic (`je` → `jz`, `sal` → `shl`, ...). */
export const ALIASES: ReadonlyMap<string, Mnemonic> = new Map(
  TABLE.flatMap((r) => r.aliases.map((a) => [a, r.mnemonic] as const)),
)

/** Prefix byte per canonical prefix. F3 reads as `rep` or `repe` depending on the string op. */
export const PREFIX_BYTE: Readonly<Record<Prefix, number>> = Object.freeze({
  rep: 0xf3,
  repe: 0xf3,
  repne: 0xf2,
})

/** Alternate prefix spelling → canonical prefix. */
export const PREFIX_ALIASES: ReadonlyMap<string, Prefix> = new Map([
  ['repz', 'repe'],
  ['repnz', 'repne'],
])
