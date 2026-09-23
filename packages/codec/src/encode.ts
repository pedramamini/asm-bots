import type { OpcodeRow, OperandTemplate } from './table'
import {
  ALIASES,
  EA_BASE,
  EA_INDEX,
  hasModrm,
  isRm,
  PREFIX_ALIASES,
  PREFIX_BYTE,
  TABLE,
} from './table'
import type { InstrInput, MemInput, OperandInput, RegOperand } from './types'

/** Why `encode` refused an instruction; the assembler turns it into a diagnostic code. */
export type EncodeErrorCode =
  | 'unknown-mnemonic'
  | 'invalid-prefix'
  | 'invalid-operands'
  | 'size-not-specified'
  | 'size-mismatch'
  | 'dat-form'
  | 'jump-out-of-range'
  | 'out-of-range'
  | 'invalid-address'

/**
 * An instruction `encode` cannot encode. It is returned, not thrown. `operand` is the index of
 * the operand at fault, when there is one, so the assembler can point at its column.
 */
export class EncodeError {
  readonly code: EncodeErrorCode
  readonly message: string
  readonly operand: number | undefined

  constructor(code: EncodeErrorCode, message: string, operand?: number) {
    this.code = code
    this.message = message
    this.operand = operand
  }
}

/** A TABLE row as the encoder sees it. */
interface Form {
  readonly row: OpcodeRow
  /** Position in TABLE, the last tie-break: `89` (r/m first) beats `8B` for two registers. */
  readonly index: number
  readonly modrm: boolean
}

function forms(): Map<string, Form[]> {
  const byMnemonic = new Map<string, Form[]>()
  for (const [index, row] of TABLE.entries()) {
    const list = byMnemonic.get(row.mnemonic) ?? []
    list.push({ row, index, modrm: hasModrm(row) })
    byMnemonic.set(row.mnemonic, list)
  }
  return byMnemonic
}

/** The rows of each canonical mnemonic, in TABLE order. */
const FORMS: ReadonlyMap<string, readonly Form[]> = forms()

/** Prefix spelling, canonical or alias, → prefix byte. */
const PREFIXES: ReadonlyMap<string, number> = new Map([
  ...Object.entries(PREFIX_BYTE),
  ...[...PREFIX_ALIASES].map(([alias, prefix]) => [alias, PREFIX_BYTE[prefix]] as const),
])

/** `base+index` → ModR/M `rm`, the inverse of EA_BASE and EA_INDEX. A bare `[disp16]` has none. */
const RM: ReadonlyMap<string, number> = new Map(
  EA_BASE.map((base, rm) => [`${base ?? ''}+${EA_INDEX[rm] ?? ''}`, rm] as const),
)

/** Mnemonics whose register and memory operands may come in either order, as NASM allows. */
const COMMUTATIVE: ReadonlySet<string> = new Set(['xchg', 'test'])

/** `dat` alone is `dat 0`, encoded `00 00` so a bombed word reads as one DAT (ISA §3.6). */
const DAT_ZERO: readonly OperandInput[] = [{ kind: 'imm', value: 0 }]

/** The ISA §9.1 message for `add <mem8>, r8`. */
const DAT_FORM =
  'this form encodes as 0x00 (DAT) and is unavailable; use `add <mem8>, imm8` or a word operation'

/** The low 16 bits of `n`, read as signed. */
function s16(n: number): number {
  return ((n & 0xffff) << 16) >> 16
}

/** A little-endian 16-bit field holding the low 16 bits of `n`. */
function word(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff]
}

/** Rejects the first operand number that is not an integer in -0x10000..0xFFFF. */
function checkNumbers(operands: readonly OperandInput[]): EncodeError | undefined {
  for (const [i, op] of operands.entries()) {
    let n: number
    let what: string
    if (op.kind === 'imm') [n, what] = [op.value, 'immediate']
    else if (op.kind === 'mem') [n, what] = [op.disp, 'displacement']
    else if (op.kind === 'rel') [n, what] = [op.target, 'jump target']
    else if (op.kind === 'moffs') [n, what] = [op.addr, 'address']
    else continue
    if (!Number.isInteger(n)) {
      return new EncodeError('out-of-range', `${what} ${n} is not an integer`, i)
    }
    if (n < -0x10000 || n > 0xffff) {
      return new EncodeError('out-of-range', `${what} ${n} is out of range`, i)
    }
  }
  return undefined
}

/** `op` is a register of `kind`, or of either kind when `loose`. */
function isReg(op: OperandInput, kind: 'reg8' | 'reg16', loose: boolean): op is RegOperand {
  return op.kind === kind || (loose && (op.kind === 'reg8' || op.kind === 'reg16'))
}

function sized(size: 8 | 16 | undefined, want: 8 | 16, loose: boolean): boolean {
  return loose || size === undefined || size === want
}

/**
 * `op` has the kind, register, and size that template `t` of the row at `opcode` takes. Values
 * are checked when the row is encoded. `loose` ignores sizes, to tell a size mismatch from
 * operands that no row takes.
 */
function fits(t: OperandTemplate, op: OperandInput, opcode: number, loose: boolean): boolean {
  switch (t) {
    case 'r/m8':
      return isReg(op, 'reg8', loose) || (op.kind === 'mem' && sized(op.size, 8, loose))
    case 'r/m16':
      return isReg(op, 'reg16', loose) || (op.kind === 'mem' && sized(op.size, 16, loose))
    case 'm':
      return op.kind === 'mem'
    case 'r8':
      return isReg(op, 'reg8', loose)
    case 'r16':
      return isReg(op, 'reg16', loose)
    case '+r8':
      return isReg(op, 'reg8', loose) && op.reg === (opcode & 7)
    case '+r16':
      return isReg(op, 'reg16', loose) && op.reg === (opcode & 7)
    case 'AL':
      return isReg(op, 'reg8', loose) && op.reg === 0
    case 'AX':
      return isReg(op, 'reg16', loose) && op.reg === 0
    case 'CL':
      return isReg(op, 'reg8', loose) && op.reg === 1
    case '1':
      return op.kind === 'imm' && op.value === 1
    case 'imm8':
      return op.kind === 'imm' && sized(op.size, 8, loose)
    case 'imm16':
      return op.kind === 'imm' && sized(op.size, 16, loose)
    case 'moffs8':
    case 'moffs16': {
      const size = t === 'moffs8' ? 8 : 16
      if (op.kind === 'moffs') return sized(op.size, size, loose)
      // A bare [disp16] is a moffs unless the input pins its ModR/M displacement.
      return (
        op.kind === 'mem' &&
        op.base === undefined &&
        op.index === undefined &&
        op.dispSize === undefined &&
        sized(op.size, size, loose)
      )
    }
    case 'rel8':
      return op.kind === 'rel' && sized(op.size, 8, loose)
    case 'rel16':
      return op.kind === 'rel' && sized(op.size, 16, loose)
  }
}

/** A row whose templates fit the operands. */
interface Match {
  readonly form: Form
  /** The operands in template order. */
  readonly ops: readonly OperandInput[]
  /** The two operands fit in reverse order (COMMUTATIVE). */
  readonly swapped: boolean
}

/** Every row, and operand order, that fits the shapes of the operands. */
function match(
  mnemonic: string,
  forms: readonly Form[],
  operands: readonly OperandInput[],
  loose: boolean,
): Match[] {
  const swaps =
    COMMUTATIVE.has(mnemonic) &&
    operands.length === 2 &&
    operands.every((op) => op.kind === 'mem' || op.kind === 'reg8' || op.kind === 'reg16')
      ? [false, true]
      : [false]
  const found: Match[] = []
  for (const form of forms) {
    const { operands: templates, opcode } = form.row
    if (templates.length !== operands.length) continue
    for (const swapped of swaps) {
      const ops = swapped ? [...operands].reverse() : operands
      if (templates.every((t, i) => fits(t, ops[i] as OperandInput, opcode, loose))) {
        found.push({ form, ops, swapped })
      }
    }
  }
  return found
}

/** The data size template `t` gives a memory operand that has none; `m` gives none. */
function impliedSize(t: OperandTemplate | undefined): 8 | 16 | undefined {
  if (t === 'r/m8' || t === 'moffs8') return 8
  if (t === 'r/m16' || t === 'moffs16') return 16
  return undefined
}

/** `mod`, `rm`, and displacement bytes of a memory operand (ISA §2.2). */
function address(
  mem: MemInput,
  at: number,
): { mod: number; rm: number; disp: number[] } | EncodeError {
  const rm = RM.get(`${mem.base ?? ''}+${mem.index ?? ''}`)
  if (rm === undefined) {
    if (mem.base !== undefined || mem.index !== undefined) {
      return new EncodeError('invalid-address', 'invalid effective address', at)
    }
    // mod=00 rm=110 is [disp16]: the displacement is the whole address.
    if ((mem.dispSize ?? 16) !== 16) {
      return new EncodeError('invalid-address', 'a bare address needs a 16-bit displacement', at)
    }
    return { mod: 0, rm: 6, disp: word(mem.disp) }
  }
  const d = s16(mem.disp)
  // mod=00 rm=110 is taken by [disp16], so [bp] needs a displacement, 0 if nothing else.
  const size = mem.dispSize ?? (d === 0 && rm !== 6 ? 0 : d >= -128 && d <= 127 ? 8 : 16)
  switch (size) {
    case 0:
      if (rm === 6) return new EncodeError('invalid-address', '[bp] needs a displacement', at)
      if (d !== 0) {
        return new EncodeError('invalid-address', 'a nonzero displacement needs a field', at)
      }
      return { mod: 0, rm, disp: [] }
    case 8:
      if (d < -128 || d > 127) {
        return new EncodeError(
          'out-of-range',
          `displacement ${mem.disp} does not fit in a byte`,
          at,
        )
      }
      return { mod: 1, rm, disp: [d & 0xff] }
    case 16:
      return { mod: 2, rm, disp: word(mem.disp) }
  }
}

/**
 * The field template `t` puts after ModR/M and the displacement (ISA §2.1): imm, rel, moffs, or
 * nothing. `end` is the instruction length, `at` the input index of `op`.
 */
function trailing(
  t: OperandTemplate,
  op: OperandInput,
  signExtend: boolean,
  end: number,
  at: number,
): number[] | EncodeError {
  if (op.kind === 'imm' && t === 'imm8') {
    const v = s16(op.value)
    // A sign-extended byte must hold the value exactly. A raw byte also takes NASM's -256..-129,
    // so `and al, ~0x80` works.
    if (signExtend ? v < -128 || v > 127 : v < -256 || v > 255) {
      const field = signExtend ? 'a sign-extended byte' : 'a byte'
      return new EncodeError('out-of-range', `immediate ${op.value} does not fit in ${field}`, at)
    }
    return [v & 0xff]
  }
  if (op.kind === 'imm' && t === 'imm16') return word(op.value)
  // `cb`/`cw` count from the next instruction; addresses wrap, so the displacement does too.
  if (op.kind === 'rel' && t === 'rel8') {
    const d = s16(op.target - end)
    if (d < -128 || d > 127) return new EncodeError('jump-out-of-range', 'jump out of range', at)
    return [d & 0xff]
  }
  if (op.kind === 'rel' && t === 'rel16') return word(op.target - end)
  if (t === 'moffs8' || t === 'moffs16') {
    if (op.kind === 'moffs') return word(op.addr)
    if (op.kind === 'mem') return word(op.disp)
  }
  return []
}

/** The bytes of `m`, or why its values do not fit. */
function emit(m: Match, prefix: number | undefined): number[] | EncodeError {
  const { row } = m.form
  const at = (i: number) => (m.swapped ? 1 - i : i)
  const bytes = prefix === undefined ? [row.opcode] : [prefix, row.opcode]
  if (m.form.modrm) {
    let reg = row.ext ?? 0
    let rm = 0
    for (const [i, t] of row.operands.entries()) {
      const op = m.ops[i]
      if ((t === 'r8' || t === 'r16') && (op?.kind === 'reg8' || op?.kind === 'reg16')) reg = op.reg
      else if (isRm(t)) rm = i
    }
    const rmOp = m.ops[rm]
    if (rmOp?.kind === 'mem') {
      const ea = address(rmOp, at(rm))
      if (ea instanceof EncodeError) return ea
      bytes.push((ea.mod << 6) | (reg << 3) | ea.rm, ...ea.disp)
    } else if (rmOp?.kind === 'reg8' || rmOp?.kind === 'reg16') {
      bytes.push(0xc0 | (reg << 3) | rmOp.reg)
    }
  }
  const end = bytes.length + row.immSize / 8
  for (const [i, t] of row.operands.entries()) {
    const field = trailing(t, m.ops[i] as OperandInput, row.signExtend, end, at(i))
    if (field instanceof EncodeError) return field
    bytes.push(...field)
  }
  return bytes
}

interface Built {
  readonly bytes: number[]
  readonly m: Match
}

/**
 * Shortest first. Equal lengths go the way NASM goes: operands in the order given, then the
 * smaller immediate (`83 C0 05` over `05 05 00` for `add ax, 5`), then TABLE order.
 */
function better(a: Built, b: Built): boolean {
  if (a.bytes.length !== b.bytes.length) return a.bytes.length < b.bytes.length
  if (a.m.swapped !== b.m.swapped) return !a.m.swapped
  const [ai, bi] = [a.m.form.row.immSize, b.m.form.row.immSize]
  if (ai !== bi) return ai < bi
  return a.m.form.index < b.m.form.index
}

/** Checks the prefix and keeps the rows that take its byte (ISA §2.1, §3.4). */
function prefixed(
  prefix: string,
  mnemonic: string,
  forms: readonly Form[],
): { byte: number; forms: readonly Form[] } | EncodeError {
  const byte = PREFIXES.get(prefix.toLowerCase())
  if (byte === undefined) return new EncodeError('invalid-prefix', `unknown prefix \`${prefix}\``)
  const takes = forms.flatMap((f) => f.row.prefixes ?? [])
  if (takes.length === 0) {
    return new EncodeError('invalid-prefix', `\`${prefix}\` needs a string instruction`)
  }
  // Spellings of one byte are interchangeable, as in NASM: `rep cmpsb` is `repe cmpsb`.
  const kept = forms.filter((f) => f.row.prefixes?.some((p) => PREFIX_BYTE[p] === byte))
  if (kept.length === 0) {
    return new EncodeError(
      'invalid-prefix',
      `${mnemonic} takes ${takes.join(' or ')}, not ${prefix}`,
    )
  }
  return { byte, forms: kept }
}

/** Why no row fits the operands. */
function refuse(
  mnemonic: string,
  forms: readonly Form[],
  operands: readonly OperandInput[],
): EncodeError {
  const [dst, src] = operands
  // `add r/m8, r8` would be 0x00, which is DAT (ISA §9.1). Two registers still have `02 /r`.
  const byteAdd = dst?.kind === 'mem' && (dst.size ?? 8) === 8 && src?.kind === 'reg8'
  if (mnemonic === 'add' && operands.length === 2 && byteAdd) {
    return new EncodeError('dat-form', DAT_FORM, 0)
  }
  if (!forms.some((f) => f.row.operands.length === operands.length)) {
    const n = operands.length
    const text = n === 0 ? 'needs operands' : `does not take ${n} operand${n === 1 ? '' : 's'}`
    return new EncodeError('invalid-operands', `${mnemonic} ${text}`)
  }
  const [loose] = match(mnemonic, forms, operands, true)
  if (loose === undefined) {
    return new EncodeError('invalid-operands', 'invalid combination of opcode and operands')
  }
  const { operands: templates, opcode } = loose.form.row
  const i = templates.findIndex((t, j) => !fits(t, loose.ops[j] as OperandInput, opcode, false))
  const at = loose.swapped ? 1 - i : i
  const op = operands[at]
  if (op?.kind === 'rel' && op.size !== undefined) {
    const form = op.size === 8 ? 'short' : 'near'
    return new EncodeError('size-mismatch', `${mnemonic} has no ${form} form`, at)
  }
  return operands.length === 1
    ? new EncodeError('size-mismatch', 'invalid operand size', 0)
    : new EncodeError('size-mismatch', 'operand sizes do not match')
}

/**
 * Encodes one instruction (ISA §2, §3). Where the input leaves a size open, it takes the
 * shortest form: `AL`/`AX` short forms, `83 /n` when a 16-bit value fits a sign-extended byte,
 * `+r` opcodes, `A0..A3` for AL or AX with a bare address, `90+r` for `xchg` with AX, rel8
 * before rel16. A memory operand without a size takes it from the other operand, and is an
 * error when both sizes fit (ISA §6.3). Sizes the input gives are kept, so any decoded
 * instruction re-encodes to bytes that decode to it again, except that `xchg r16, ax` comes
 * back as `xchg ax, r16`.
 */
export function encode(instr: InstrInput): Uint8Array | EncodeError {
  const name = instr.mnemonic.toLowerCase()
  const mnemonic = FORMS.has(name) ? name : ALIASES.get(name)
  let forms = mnemonic === undefined ? undefined : FORMS.get(mnemonic)
  if (mnemonic === undefined || forms === undefined) {
    return new EncodeError('unknown-mnemonic', `unknown mnemonic \`${instr.mnemonic}\``)
  }
  let prefix: number | undefined
  if (instr.prefix !== undefined) {
    const p = prefixed(instr.prefix, mnemonic, forms)
    if (p instanceof EncodeError) return p
    prefix = p.byte
    forms = p.forms
  }
  const operands = mnemonic === 'dat' && instr.operands.length === 0 ? DAT_ZERO : instr.operands
  const bad = checkNumbers(operands)
  if (bad !== undefined) return bad
  const found = match(mnemonic, forms, operands, false)
  if (found.length === 0) return refuse(mnemonic, forms, operands)
  const open = operands.findIndex(
    (op) => (op.kind === 'mem' || op.kind === 'moffs') && op.size === undefined,
  )
  if (open >= 0) {
    const sizes = new Set(
      found.map((m) => impliedSize(m.form.row.operands[m.swapped ? 1 - open : open])),
    )
    if (sizes.has(8) && sizes.has(16)) {
      return new EncodeError('size-not-specified', 'operation size not specified', open)
    }
  }
  let best: Built | undefined
  let failure: EncodeError | undefined
  for (const m of found) {
    const bytes = emit(m, prefix)
    if (bytes instanceof EncodeError) failure ??= bytes
    else if (best === undefined || better({ bytes, m }, best)) best = { bytes, m }
  }
  if (best !== undefined) return Uint8Array.from(best.bytes)
  // Every row that fits the shapes failed on a value (found is not empty); report the first.
  return failure as EncodeError
}
