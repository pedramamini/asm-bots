import type { OpcodeRow, OperandTemplate } from './table'
import { EA_BASE, EA_INDEX, hasModrm, isRm, PREFIX_BYTE, TABLE } from './table'
import type { Instr, MemOperand, Mnemonic, Operand } from './types'
import { Reg8, Reg16 } from './types'

/**
 * Returns the byte at `addr`. The decoder asks for `addr`..`addr + 5` without wrapping; the
 * engine passes a reader that wraps at 0x10000. Only the low 8 bits of the result are used.
 */
export type Reader = (addr: number) => number

/** Why an instruction kills instead of executing (ISA §3.6, §3.7, §5.3). */
export type KillReason = 'undefined' | 'dat' | 'hlt' | 'int3'

/**
 * A decoded instruction. DAT, HLT, and INT3 are table rows, so they carry `instr` for display,
 * but executing them kills. An undefined byte has no instruction: `byte` is the byte at `addr`,
 * which the disassembler prints as `db` before resyncing at the next byte.
 */
export type Decoded =
  | { ok: true; instr: Instr; length: number }
  | { ok: false; reason: 'dat' | 'hlt' | 'int3'; instr: Instr; length: 1 | 2 }
  | { ok: false; reason: 'undefined'; byte: number; length: 1 }

/** `decodeInto` results below zero. */
export const DECODE_UNDEFINED = -1
export const DECODE_DAT = -2
export const DECODE_HLT = -3
export const DECODE_INT3 = -4

/**
 * A scratch operand with the fields of every `Operand` kind, so `decodeInto` can rewrite it as
 * any kind without changing its hidden class. Readers narrow on `kind` as with any `Operand`.
 */
interface Slot {
  kind: Operand['kind']
  reg: number
  value: number
  signed: boolean
  base: MemOperand['base']
  index: MemOperand['index']
  disp: number
  dispSize: MemOperand['dispSize']
  size: 8 | 16 | undefined
  target: number
  addr: number
}

/** The scratch operands and operand lists that one `out` object reuses. */
interface Pool {
  readonly a: Slot
  readonly b: Slot
  readonly none: Operand[]
  readonly one: Operand[]
  readonly two: Operand[]
}

function slot(): Slot {
  return {
    kind: 'imm',
    reg: 0,
    value: 0,
    signed: false,
    base: undefined,
    index: undefined,
    disp: 0,
    dispSize: 0,
    size: 16,
    target: 0,
    addr: 0,
  }
}

function pool(): Pool {
  const a = slot()
  const b = slot()
  const oa = a as unknown as Operand
  const ob = b as unknown as Operand
  return { a, b, none: [], one: [oa], two: [oa, ob] }
}

function setReg(s: Slot, kind: 'reg8' | 'reg16', reg: number): void {
  s.kind = kind
  s.reg = reg
}

function setImm(s: Slot, value: number, size: 8 | 16, signed: boolean): void {
  s.kind = 'imm'
  s.value = value
  s.size = size
  s.signed = signed
}

function setRel(s: Slot, target: number, size: 8 | 16): void {
  s.kind = 'rel'
  s.target = target
  s.size = size
}

function setMoffs(s: Slot, addr: number, size: 8 | 16): void {
  s.kind = 'moffs'
  s.addr = addr
  s.size = size
}

function u8(read: Reader, a: number): number {
  return read(a) & 0xff
}

function s8(read: Reader, a: number): number {
  return (read(a) << 24) >> 24
}

function u16(read: Reader, a: number): number {
  return (read(a) & 0xff) | ((read(a + 1) & 0xff) << 8)
}

function s16(read: Reader, a: number): number {
  return (u16(read, a) << 16) >> 16
}

/**
 * Decodes the `mod` and `rm` fields of ModR/M byte `m` into `s` (ISA §2.2). `at` is the address
 * after the ModR/M byte, where a displacement starts. Returns the displacement length in bytes.
 */
function modrm(read: Reader, at: number, m: number, s: Slot, size: 8 | 16 | undefined): number {
  const mod = m >> 6
  const rm = m & 7
  if (mod === 3) {
    setReg(s, size === 8 ? 'reg8' : 'reg16', rm)
    return 0
  }
  s.kind = 'mem'
  s.size = size
  if (mod === 0 && rm === 6) {
    // [disp16] is an absolute address, so it stays unsigned. [bp] needs mod=01 and a disp8.
    s.base = undefined
    s.index = undefined
    s.disp = u16(read, at)
    s.dispSize = 16
    return 2
  }
  s.base = EA_BASE[rm]
  s.index = EA_INDEX[rm]
  if (mod === 0) {
    s.disp = 0
    s.dispSize = 0
    return 0
  }
  if (mod === 1) {
    s.disp = s8(read, at)
    s.dispSize = 8
    return 1
  }
  s.disp = s16(read, at)
  s.dispSize = 16
  return 2
}

/** Decodes the instruction whose first byte selected this handler. Returns length or DECODE_*. */
type Handler = (read: Reader, addr: number, out: Instr, p: Pool) => number

/** Decodes a ModR/M row, given the ModR/M byte `m` that the opcode handler read. */
type ModrmHandler = (read: Reader, addr: number, out: Instr, p: Pool, m: number) => number

/**
 * Fills `s` with one operand that is not the ModR/M r/m field. `at` is the address of the
 * trailing imm/rel/moffs field, `len` the instruction length, `m` the ModR/M byte (if any).
 */
type Fill = (s: Slot, read: Reader, at: number, len: number, m: number) => void

function emit(out: Instr, mnemonic: Mnemonic, operands: Operand[], length: number): number {
  out.mnemonic = mnemonic
  out.operands = operands
  out.prefix = undefined
  out.length = length
  return length
}

function fill(row: OpcodeRow, t: OperandTemplate): Fill {
  switch (t) {
    case 'r8':
      return (s, _read, _at, _len, m) => setReg(s, 'reg8', (m >> 3) & 7)
    case 'r16':
      return (s, _read, _at, _len, m) => setReg(s, 'reg16', (m >> 3) & 7)
    case '+r8': {
      const reg = row.opcode & 7
      return (s) => setReg(s, 'reg8', reg)
    }
    case '+r16': {
      const reg = row.opcode & 7
      return (s) => setReg(s, 'reg16', reg)
    }
    case 'AL':
      return (s) => setReg(s, 'reg8', Reg8.al)
    case 'AX':
      return (s) => setReg(s, 'reg16', Reg16.ax)
    case 'CL':
      return (s) => setReg(s, 'reg8', Reg8.cl)
    case '1':
      return (s) => setImm(s, 1, 8, false)
    case 'imm8':
      return row.signExtend
        ? (s, read, at) => setImm(s, s8(read, at), 8, true)
        : (s, read, at) => setImm(s, u8(read, at), 8, false)
    case 'imm16':
      return (s, read, at) => setImm(s, u16(read, at), 16, false)
    // `cb`/`cw` count from the next instruction; RelOperand counts from this one.
    case 'rel8':
      return (s, read, at, len) => setRel(s, s8(read, at) + len, 8)
    case 'rel16':
      return (s, read, at, len) => setRel(s, s16(read, at) + len, 16)
    case 'moffs8':
      return (s, read, at) => setMoffs(s, u16(read, at), 8)
    case 'moffs16':
      return (s, read, at) => setMoffs(s, u16(read, at), 16)
    case 'r/m8':
    case 'r/m16':
    case 'm':
      throw new Error(`codec: ${t} is decoded by modrm()`)
  }
}

/** A row without ModR/M: operands fixed by the opcode, plus at most one trailing field. */
function plain(row: OpcodeRow): Handler {
  const { mnemonic } = row
  const len = 1 + row.immSize / 8
  const [f0, f1] = row.operands.map((t) => fill(row, t))
  if (f0 === undefined) return (_read, _addr, out, p) => emit(out, mnemonic, p.none, len)
  if (f1 === undefined) {
    return (read, addr, out, p) => {
      f0(p.a, read, addr + 1, len, 0)
      return emit(out, mnemonic, p.one, len)
    }
  }
  return (read, addr, out, p) => {
    f0(p.a, read, addr + 1, len, 0)
    f1(p.b, read, addr + 1, len, 0)
    return emit(out, mnemonic, p.two, len)
  }
}

/** A ModR/M row: the r/m operand, plus the `reg` field, a fixed operand, or an immediate. */
function withModrm(row: OpcodeRow): ModrmHandler {
  const { mnemonic } = row
  const [t0, t1, ...rest] = row.operands
  const rmFirst = t0 !== undefined && isRm(t0)
  const rm = rmFirst ? t0 : t1
  if (rm === undefined || !isRm(rm) || rest.length > 0) {
    throw new Error(`codec: unsupported ModR/M operands ${row.operands.join(', ')}`)
  }
  const size = rm === 'r/m8' ? 8 : rm === 'r/m16' ? 16 : undefined
  const tail = row.immSize / 8
  const other = rmFirst ? t1 : t0
  let h: ModrmHandler
  if (other === undefined) {
    h = (read, addr, out, p, m) =>
      emit(out, mnemonic, p.one, 2 + modrm(read, addr + 2, m, p.a, size))
  } else {
    const f = fill(row, other)
    h = rmFirst
      ? (read, addr, out, p, m) => {
          const at = addr + 2 + modrm(read, addr + 2, m, p.a, size)
          const len = at - addr + tail
          f(p.b, read, at, len, m)
          return emit(out, mnemonic, p.two, len)
        }
      : (read, addr, out, p, m) => {
          const at = addr + 2 + modrm(read, addr + 2, m, p.b, size)
          const len = at - addr + tail
          f(p.a, read, at, len, m)
          return emit(out, mnemonic, p.two, len)
        }
  }
  if (rm !== 'm') return h
  // `m` (LEA): a register operand is undefined (ISA §3.1).
  return (read, addr, out, p, m) => (m >= 0xc0 ? DECODE_UNDEFINED : h(read, addr, out, p, m))
}

/** Reads ModR/M and picks the row by its `reg` field. A `/r` row fills all eight entries. */
function byExt(rows: readonly (ModrmHandler | undefined)[]): Handler {
  return (read, addr, out, p) => {
    const m = read(addr + 1) & 0xff
    const h = rows[(m >> 3) & 7]
    return h === undefined ? DECODE_UNDEFINED : h(read, addr, out, p, m)
  }
}

const KILL_CODE: Partial<Record<Mnemonic, number>> = {
  dat: DECODE_DAT,
  hlt: DECODE_HLT,
  int3: DECODE_INT3,
}

/** Decodes like `h` so `out` shows the instruction, then reports the kill (ISA §3.6). */
function killing(row: OpcodeRow, h: Handler): Handler {
  const code = KILL_CODE[row.mnemonic]
  if (code === undefined) throw new Error(`codec: no kill code for ${row.mnemonic}`)
  return (read, addr, out, p) => {
    h(read, addr, out, p)
    return code
  }
}

/**
 * Prefix byte `F2` or `F3` (ISA §2.1, §3.4): a string instruction that takes this byte, else
 * undefined. A second prefix is "anything else", so at most one prefix decodes.
 */
function prefixed(byte: number): Handler {
  const ops: (Handler | undefined)[] = Array.from({ length: 256 }, () => undefined)
  for (const row of TABLE) {
    const prefix = row.prefixes?.find((p) => PREFIX_BYTE[p] === byte)
    if (prefix === undefined) continue
    if (row.operands.length > 0) throw new Error(`codec: prefixed ${row.mnemonic} has operands`)
    const { mnemonic } = row
    ops[row.opcode] = (_read, _addr, out, p) => {
      out.mnemonic = mnemonic
      out.operands = p.none
      out.prefix = prefix
      out.length = 2
      return 2
    }
  }
  return (read, addr, out, p) => {
    const h = ops[read(addr + 1) & 0xff]
    return h === undefined ? DECODE_UNDEFINED : h(read, addr, out, p)
  }
}

function build(): Handler[] {
  const undef: Handler = () => DECODE_UNDEFINED
  const dispatch: Handler[] = Array.from({ length: 256 }, () => undef)
  const groups = new Map<number, (ModrmHandler | undefined)[]>()
  for (const row of TABLE) {
    if (!hasModrm(row)) {
      dispatch[row.opcode] = row.kills ? killing(row, plain(row)) : plain(row)
      continue
    }
    if (row.kills) throw new Error(`codec: ModR/M row ${row.mnemonic} cannot kill`)
    let exts = groups.get(row.opcode)
    if (exts === undefined) {
      exts = Array.from({ length: 8 }, () => undefined)
      groups.set(row.opcode, exts)
    }
    const h = withModrm(row)
    if (row.ext === undefined) exts.fill(h)
    else exts[row.ext] = h
  }
  for (const [opcode, exts] of groups) dispatch[opcode] = byExt(exts)
  for (const byte of new Set(Object.values(PREFIX_BYTE))) {
    if (dispatch[byte] !== undef) throw new Error(`codec: prefix ${byte} is also an opcode`)
    dispatch[byte] = prefixed(byte)
  }
  return dispatch
}

/** `DISPATCH[opcode]` decodes an instruction that starts with that byte. Built from TABLE. */
const DISPATCH: readonly Handler[] = build()

/** `decode` decodes into this, then copies the result into objects the caller owns. */
const SCRATCH: Instr = { mnemonic: 'nop', operands: [], prefix: undefined, length: 1 }
const SCRATCH_POOL = pool()

const pools = new WeakMap<Instr, Pool>([[SCRATCH, SCRATCH_POOL]])
let lastOut = SCRATCH
let lastPool = SCRATCH_POOL

function poolFor(out: Instr): Pool {
  if (out === lastOut) return lastPool
  let p = pools.get(out)
  if (p === undefined) {
    p = pool()
    pools.set(out, p)
  }
  lastOut = out
  lastPool = p
  return p
}

/**
 * Decodes the instruction at `addr` into `out` without allocating: `out` and its operand
 * objects are reused on every call with the same `out`, so read them before the next call and
 * do not mutate them. Returns the length (1..6) or a DECODE_* code below zero. For DAT, HLT,
 * and INT3, `out` holds the instruction; for DECODE_UNDEFINED, `out` is unchanged.
 */
export function decodeInto(read: Reader, addr: number, out: Instr): number {
  return (DISPATCH[read(addr) & 0xff] as Handler)(read, addr, out, poolFor(out))
}

const CLONE: { readonly [K in Operand['kind']]: (s: Slot) => Extract<Operand, { kind: K }> } = {
  reg16: (s) => ({ kind: 'reg16', reg: s.reg as Reg16 }),
  reg8: (s) => ({ kind: 'reg8', reg: s.reg as Reg8 }),
  imm: (s) => ({ kind: 'imm', value: s.value, size: s.size as 8 | 16, signed: s.signed }),
  mem: (s) => ({
    kind: 'mem',
    base: s.base,
    index: s.index,
    disp: s.disp,
    dispSize: s.dispSize,
    size: s.size,
  }),
  rel: (s) => ({ kind: 'rel', target: s.target, size: s.size as 8 | 16 }),
  moffs: (s) => ({ kind: 'moffs', addr: s.addr, size: s.size as 8 | 16 }),
}

/** Copies the scratch instruction into plain objects the caller owns. */
function copy(): Instr {
  const n = SCRATCH.operands.length
  const operands: Operand[] = []
  if (n > 0) operands.push(CLONE[SCRATCH_POOL.a.kind](SCRATCH_POOL.a))
  if (n > 1) operands.push(CLONE[SCRATCH_POOL.b.kind](SCRATCH_POOL.b))
  const { mnemonic, prefix, length } = SCRATCH
  return { mnemonic, operands, prefix, length }
}

function kill(reason: 'dat' | 'hlt' | 'int3'): Decoded {
  return { ok: false, reason, instr: copy(), length: SCRATCH.length as 1 | 2 }
}

/**
 * Decodes the instruction at `addr` (ISA §2, §3), reading at most 6 bytes through `read`.
 * Relative targets are measured from `addr`, so the result is position independent.
 */
export function decode(read: Reader, addr: number): Decoded {
  const byte = read(addr) & 0xff
  const code = (DISPATCH[byte] as Handler)(read, addr, SCRATCH, SCRATCH_POOL)
  switch (code) {
    case DECODE_UNDEFINED:
      return { ok: false, reason: 'undefined', byte, length: 1 }
    case DECODE_DAT:
      return kill('dat')
    case DECODE_HLT:
      return kill('hlt')
    case DECODE_INT3:
      return kill('int3')
    default:
      return { ok: true, instr: copy(), length: code }
  }
}
