/**
 * The fetch and execute stages (ISA §5.3): one instruction of one process. The battle gets the
 * instruction at the process's IP from a `Fetcher`, runs it with `run`, and then acts on the
 * outcome. Nothing here allocates per instruction.
 *
 * An instruction runs compiled: its handler and its operands as integers, `C_FIELDS` int32
 * fields in a code array. `Fetcher.compiled` keeps the instruction it last compiled at each
 * address and compares its bytes with the core's on every fetch, so the next fetch sees any
 * write into code, a direct store to `core.bytes` included. A decoded instruction depends only
 * on its own bytes (a relative target counts from the instruction), so the same bytes are the
 * same instruction. `execOne` compiles a decoded `Instr` and runs it the same way.
 *
 * Where ISA §3 and §4 leave a behavior open, the 8086 silicon decides, checked against hardware
 * captures of an 8088 (the same execution unit): `PUSH SP` pushes the decremented SP, `POP SP`
 * keeps the popped word, IDIV kills on a quotient of -128 or -32768, and a shift by a count of 0
 * still writes its memory operand back.
 */
import type {
  Instr,
  KillReason,
  MemOperand,
  Mnemonic,
  Operand,
  Prefix,
  Reader,
} from '@asmbots/codec'
import { DECODE_UNDEFINED, decodeInto, MNEMONICS } from '@asmbots/codec'
import type { Core } from './core'
import { ADDR_MASK, CORE_SIZE } from './core'
import {
  AF,
  CF,
  DF,
  FLAGS_INIT,
  FLAGS_WRITABLE,
  flagsAdd,
  flagsIncDec,
  flagsLogic,
  flagsRcl,
  flagsRcr,
  flagsRol,
  flagsRor,
  flagsSar,
  flagsShl,
  flagsShr,
  flagsSub,
  OF,
  PF,
  SF,
  STATUS,
  ZF,
} from './flags'
import type { ProcQueue, ProcRow } from './proc'
import { AX, BP, BX, CX, DI, DX, FLAGS, getReg8, IP, SI, SP, setReg8 } from './proc'

/** `execOne` moved IP past the instruction. */
export const EXEC_CONTINUE = 0
/** The instruction set IP: a taken jump, a call or ret, or a REP instruction with more to do. */
export const EXEC_JUMPED = 1
/** The process dies. `ctx.reason` says why. The row is unchanged, so its IP is the killer. */
export const EXEC_KILLED = 2
/** SPL: IP moved past the instruction, and a child starts at `ctx.target` (ISA §3.6). */
export const EXEC_SPAWN = 3

export type ExecOutcome =
  | typeof EXEC_CONTINUE
  | typeof EXEC_JUMPED
  | typeof EXEC_KILLED
  | typeof EXEC_SPAWN

/** Why a process died (ISA §5.3): a killing instruction, or a divide error (`div`). */
export type DeathReason = KillReason | 'div'

/** What `execOne` needs from the running bot. */
export interface ExecBot {
  /** The owner tag of its writes: bot index + 1 (ISA §5.4). */
  readonly tag: number
  /** Its processes, the running one included. SPL is a NOP while it is full (ISA §3.6). */
  readonly queue: ProcQueue
}

/** The payload of the last outcome. The battle keeps one and reads it after each `execOne`. */
export class ExecContext {
  /** Set with `EXEC_KILLED`. */
  reason: DeathReason = 'undefined'
  /** Set with `EXEC_SPAWN`: the child's IP. */
  target = 0
}

/*
 * A compiled instruction is C_FIELDS int32 fields from an offset in a code array.
 */

/** Bytes 0..3 of the instruction, little-endian, 0 past its length. */
const C_SIG = 0
/** The length (bits 0..2), bytes 4 and 5 (bits 8..23), and the REP prefix (bits 24..25). */
const C_META = 1
/** The handler: an index into `OPS`. */
const C_OP = 2
/** The data size, 8 or 16: the size of operand 0 when it is a register or memory. */
const C_SIZE = 3
/** Operand 0 as a kind and a value; operand 1 follows as C_K1 and C_V1. */
const C_K0 = 4
const C_V0 = 5
const C_K1 = 6
const C_V1 = 7
/** Fields per compiled instruction. */
const C_FIELDS = 8

/*
 * Operand kinds. A memory kind is below REG16: its base register code + 1 (BX or BP) in bits
 * 0..3 and its index register code + 1 (SI or DI) in bits 4..7, so ABS (0), with neither, is a
 * bare address (`[disp16]`, or the moffs of A0..A3). The value of a memory operand is its
 * displacement or its address (ISA §2.2). REG16 + code and REG8 + code are registers. IMM and REL
 * carry the immediate or the branch target. A location (`locate`) is a memory address
 * (0..0xFFFF) or a register kind, so a read-modify-write computes its address once.
 */
const ABS = 0
const BASE_BX = BX + 1
const BASE_BP = BP + 1
const INDEX_SI = (SI + 1) << 4
const INDEX_DI = (DI + 1) << 4
const REG16 = 0x10000
const REG8 = 0x10008
const IMM = 0x20000
const REL = 0x20001
const NONE = -1

/** REP prefix codes in C_META. */
const REP = 1
const REPE = 2
const REPNE = 3
const PREFIX_CODE: Readonly<Record<Prefix, number>> = { rep: REP, repe: REPE, repne: REPNE }

/** The bytes 0..3 that an instruction of each length holds in C_SIG. */
const LO_MASK = Int32Array.of(0, 0xff, 0xffff, 0xffffff, -1, -1, -1, -1)
/** The bytes 4 and 5, shifted down, that an instruction of each length holds in C_META. */
const HI_MASK = Int32Array.of(0, 0, 0, 0, 0, 0xff, 0xffff, 0xffff)

/**
 * The fetch stage for one core (ISA §5.3 step 1). `fetch` decodes into `instr` and its operand
 * objects, which the next call rewrites, so read them before fetching again. `compiled` gives
 * the instruction ready to run, from a cache of one entry per address.
 */
export class Fetcher {
  readonly instr: Instr = { mnemonic: 'nop', operands: [], prefix: undefined, length: 1 }
  /**
   * The compiled instructions: one entry per address, then a scratch entry at `CORE_SIZE` for
   * undefined bytes. An entry of length 0 is empty.
   */
  readonly code = new Int32Array((CORE_SIZE + 1) * C_FIELDS)
  private readonly bytes: Uint8Array
  private readonly read: Reader

  constructor(core: Core) {
    const bytes = core.bytes
    this.bytes = bytes
    this.read = (a) => bytes[a & ADDR_MASK] as number
  }

  /**
   * The instruction at `addr`, reading up to 6 bytes that wrap at 64 KB, or undefined when the
   * bytes are undefined (ISA §3.7). DAT, HLT, and INT3 decode; executing them kills.
   */
  fetch(addr: number): Instr | undefined {
    return decodeInto(this.read, addr, this.instr) === DECODE_UNDEFINED ? undefined : this.instr
  }

  /**
   * The offset in `code` of the instruction at `addr`, compiled: the entry for `addr` while the
   * core still holds its bytes, else a new compile. Undefined bytes compile to a kill in the
   * scratch entry, which no fetch reuses: only the decoder knows how many bytes it read.
   */
  compiled(addr: number): number {
    const a = addr & ADDR_MASK
    const code = this.code
    const o = a * C_FIELDS
    const meta = code[o + C_META] as number
    const n = meta & 7
    if (n !== 0) {
      const b = this.bytes
      const lo =
        (b[a] as number) |
        ((b[(a + 1) & ADDR_MASK] as number) << 8) |
        ((b[(a + 2) & ADDR_MASK] as number) << 16) |
        ((b[(a + 3) & ADDR_MASK] as number) << 24)
      if ((lo & (LO_MASK[n] as number)) === code[o + C_SIG]) {
        if (n < 5) return o
        const hi = (b[(a + 4) & ADDR_MASK] as number) | ((b[(a + 5) & ADDR_MASK] as number) << 8)
        if ((hi & (HI_MASK[n] as number)) === ((meta >>> 8) & 0xffff)) return o
      }
    }
    return this.compile(a)
  }

  /** The length of the compiled instruction at `o`: 1 for undefined bytes. */
  length(o: number): number {
    return (this.code[o + C_META] as number) & 7
  }

  private compile(a: number): number {
    const instr = this.fetch(a)
    const code = this.code
    if (instr === undefined) {
      const o = CORE_SIZE * C_FIELDS
      code[o + C_META] = 1
      code[o + C_OP] = OP_UNDEFINED
      return o
    }
    const o = a * C_FIELDS
    compileInto(code, o, instr)
    const b = this.bytes
    let lo = 0
    let hi = 0
    for (let k = 0; k < instr.length; k++) {
      const byte = b[(a + k) & ADDR_MASK] as number
      if (k < 4) lo |= byte << (8 * k)
      else hi |= byte << (8 * (k - 4))
    }
    code[o + C_SIG] = lo
    code[o + C_META] = (code[o + C_META] as number) | (hi << 8)
    return o
  }
}

/** Writes `instr` compiled at offset `o` of `code`, with no bytes to compare. */
function compileInto(code: Int32Array, o: number, instr: Instr): void {
  const a = instr.operands[0]
  const prefix = instr.prefix === undefined ? 0 : PREFIX_CODE[instr.prefix]
  code[o + C_SIG] = 0
  code[o + C_META] = instr.length | (prefix << 24)
  code[o + C_OP] = OP_OF[instr.mnemonic]
  code[o + C_SIZE] = sizeOf(a)
  operand(code, o + C_K0, a)
  operand(code, o + C_K1, instr.operands[1])
}

/** The data size of a register or memory operand; 16 for any other. */
function sizeOf(o: Operand | undefined): 8 | 16 {
  if (o === undefined) return 16
  if (o.kind === 'reg8') return 8
  return (o.kind === 'mem' || o.kind === 'moffs') && o.size === 8 ? 8 : 16
}

/** Writes operand `x` as a kind and a value from `at`. */
function operand(code: Int32Array, at: number, x: Operand | undefined): void {
  let kind = NONE
  let value = 0
  if (x !== undefined) {
    switch (x.kind) {
      case 'reg16':
        kind = REG16 + x.reg
        break
      case 'reg8':
        kind = REG8 + x.reg
        break
      case 'imm':
        kind = IMM
        value = x.value
        break
      case 'rel':
        kind = REL
        value = x.target
        break
      case 'mem':
        kind = memKind(x)
        value = x.disp
        break
      case 'moffs':
        kind = ABS
        value = x.addr
        break
    }
  }
  code[at] = kind
  code[at + 1] = value
}

/** The kind of a memory operand. */
function memKind(m: MemOperand): number {
  const base = m.base === 'bx' ? BASE_BX : m.base === 'bp' ? BASE_BP : ABS
  return base | (m.index === 'si' ? INDEX_SI : m.index === 'di' ? INDEX_DI : ABS)
}

/** The address of memory kind `k` with displacement `disp` (ISA §2.2), mod 64 KB. */
function address(row: ProcRow, k: number, disp: number): number {
  const base = k & 15
  const index = k >> 4
  let a = disp
  if (base !== 0) a += row[base - 1] as number
  if (index !== 0) a += row[index - 1] as number
  return a & ADDR_MASK
}

/** The effective address of `m` (ISA §2.2): base + index + displacement, mod 64 KB. */
export function ea(row: ProcRow, m: MemOperand): number {
  return address(row, memKind(m), m.disp)
}

/** Where operand `f` (C_K0 or C_K1) of the instruction at `o` is: see the operand kinds. */
function locate(row: ProcRow, code: Int32Array, o: number, f: number): number {
  const k = code[o + f] as number
  return k >= REG16 ? k : address(row, k, code[o + f + 1] as number)
}

function load(row: ProcRow, core: Core, loc: number, size: 8 | 16): number {
  if (loc < REG16) return read(core, loc, size)
  return loc < REG8 ? (row[loc - REG16] as number) : getReg8(row, loc - REG8)
}

/** Stores the low `size` bits of `v`. A memory store is a write, tagged `tag`. */
function store(row: ProcRow, core: Core, loc: number, size: 8 | 16, v: number, tag: number) {
  if (loc >= REG8) setReg8(row, loc - REG8, v)
  else if (loc >= REG16) row[loc - REG16] = v
  else if (size === 8) core.write8(loc, v, tag)
  else core.write16(loc, v, tag)
}

/**
 * The value of operand `f` (C_K0 or C_K1), reading `size` bits from memory. A sign-extended imm8
 * comes back negative; users mask.
 */
function value(
  row: ProcRow,
  core: Core,
  code: Int32Array,
  o: number,
  f: number,
  size: 8 | 16,
): number {
  const k = code[o + f] as number
  if (k < REG16) return read(core, address(row, k, code[o + f + 1] as number), size)
  if (k < REG8) return row[k - REG16] as number
  return k < IMM ? getReg8(row, k - REG8) : (code[o + f + 1] as number)
}

/** The `size`-bit value at memory address `a`. */
function read(core: Core, a: number, size: 8 | 16): number {
  return size === 8 ? (core.bytes[a] as number) : core.read16(a)
}

/** The target of a jump, call, or SPL: relative to this instruction, or absolute in r/m16. */
function target(row: ProcRow, core: Core, code: Int32Array, o: number): number {
  return code[o + C_K0] === REL
    ? ((row[IP] as number) + (code[o + C_V0] as number)) & ADDR_MASK
    : value(row, core, code, o, C_K0, 16)
}

function next(row: ProcRow, code: Int32Array, o: number): ExecOutcome {
  row[IP] = (row[IP] as number) + ((code[o + C_META] as number) & 7)
  return EXEC_CONTINUE
}

function jump(row: ProcRow, to: number): ExecOutcome {
  row[IP] = to
  return EXEC_JUMPED
}

/** Takes the rel8 branch of the instruction at `o` when `taken`. */
function branch(row: ProcRow, code: Int32Array, o: number, taken: boolean): ExecOutcome {
  if (!taken) return next(row, code, o)
  return jump(row, (row[IP] as number) + (code[o + C_V0] as number))
}

/** SP -= 2, then the word at SP = `v`. The stack wraps at 64 KB. */
function pushWord(row: ProcRow, core: Core, v: number, tag: number): void {
  const sp = ((row[SP] as number) - 2) & ADDR_MASK
  row[SP] = sp
  core.write16(sp, v, tag)
}

/** The word at SP, then SP += 2. */
function popWord(row: ProcRow, core: Core): number {
  const sp = row[SP] as number
  row[SP] = sp + 2
  return core.read16(sp)
}

/** CX -= 1, with no flags; returns the new CX. */
function decCx(row: ProcRow): number {
  const cx = ((row[CX] as number) - 1) & 0xffff
  row[CX] = cx
  return cx
}

type Handler = (
  bot: ExecBot,
  row: ProcRow,
  core: Core,
  code: Int32Array,
  o: number,
  ctx: ExecContext,
) => ExecOutcome

function kill(reason: DeathReason): Handler {
  return (_bot, _row, _core, _code, _o, ctx) => {
    ctx.reason = reason
    return EXEC_KILLED
  }
}

function divideError(ctx: ExecContext): ExecOutcome {
  ctx.reason = 'div'
  return EXEC_KILLED
}

/*
 * A factory below takes a number, never a function, so every call in a handler has one target.
 */

/** ALU operations, in the order of the ModR/M `reg` field of 80..83. CMP runs as SUB. */
const ADD = 0
const OR = 1
const ADC = 2
const SBB = 3
const AND = 4
const SUB = 5
const XOR = 6

/** A two-operand ALU instruction: `dst = dst op src`, or just the flags when `writes` is false. */
function alu(op: number, writes: boolean): Handler {
  return (bot, row, core, code, o) => {
    const size = code[o + C_SIZE] as 8 | 16
    const loc = locate(row, code, o, C_K0)
    const a = load(row, core, loc, size)
    const b = value(row, core, code, o, C_K1, size)
    const flags = row[FLAGS] as number
    let r: number
    let status: number
    switch (op) {
      case ADD:
        r = a + b
        status = flagsAdd(a, b, 0, size)
        break
      case ADC:
        r = a + b + (flags & CF)
        status = flagsAdd(a, b, flags & CF, size)
        break
      case SUB:
        r = a - b
        status = flagsSub(a, b, 0, size)
        break
      case SBB:
        r = a - b - (flags & CF)
        status = flagsSub(a, b, flags & CF, size)
        break
      case AND:
        r = a & b
        status = flagsLogic(r, size)
        break
      case OR:
        r = a | b
        status = flagsLogic(r, size)
        break
      default:
        r = a ^ b
        status = flagsLogic(r, size)
    }
    row[FLAGS] = (flags & ~STATUS) | status
    if (writes) store(row, core, loc, size, r, bot.tag)
    return next(row, code, o)
  }
}

/** INC (`delta` 1) or DEC (-1): the status flags except CF. */
function incDec(delta: 1 | -1): Handler {
  return (bot, row, core, code, o) => {
    const size = code[o + C_SIZE] as 8 | 16
    const loc = locate(row, code, o, C_K0)
    const a = load(row, core, loc, size)
    row[FLAGS] = flagsIncDec(a, delta, row[FLAGS] as number, size)
    store(row, core, loc, size, a + delta, bot.tag)
    return next(row, code, o)
  }
}

/** Shifts and rotates, in the order of the ModR/M `reg` field of D0..D3 (6 is unused). */
const ROL = 0
const ROR = 1
const RCL = 2
const RCR = 3
const SHL = 4
const SHR = 5
const SAR = 7

/**
 * Shifts r/m by 1 or by CL, un-masked (ISA §4). The operand is written back even for a count
 * of 0, unchanged, as the 8086 runs the write cycle.
 */
function shift(op: number): Handler {
  return (bot, row, core, code, o) => {
    const size = code[o + C_SIZE] as 8 | 16
    const loc = locate(row, code, o, C_K0)
    const count = value(row, core, code, o, C_K1, 8)
    const v = load(row, core, loc, size)
    const flags = row[FLAGS] as number
    let out: number
    switch (op) {
      case ROL:
        out = flagsRol(v, count, flags, size)
        break
      case ROR:
        out = flagsRor(v, count, flags, size)
        break
      case RCL:
        out = flagsRcl(v, count, flags, size)
        break
      case RCR:
        out = flagsRcr(v, count, flags, size)
        break
      case SHL:
        out = flagsShl(v, count, flags, size)
        break
      case SHR:
        out = flagsShr(v, count, flags, size)
        break
      default:
        out = flagsSar(v, count, flags, size)
    }
    row[FLAGS] = out >>> 16
    store(row, core, loc, size, out, bot.tag)
    return next(row, code, o)
  }
}

/** SF xor OF: the signed less-than of JL and JNG. */
function lt(f: number): boolean {
  return ((f & SF) !== 0) !== ((f & OF) !== 0)
}

/** String instructions. */
const MOVSB = 0
const MOVSW = 1
const CMPSB = 2
const CMPSW = 3
const STOSB = 4
const STOSW = 5
const LODSB = 6
const LODSW = 7
const SCASB = 8
const SCASW = 9

/**
 * A string instruction of `bytes`-byte elements (ISA §3.4). DF set steps SI and DI down. With a
 * REP prefix, one call is one iteration: CX == 0 on entry does nothing, and while CX != 0 (and,
 * for REPE and REPNE, ZF matches) after the iteration, IP stays on the prefix so the process
 * runs it again next turn.
 */
function stringOp(op: number, bytes: 1 | 2): Handler {
  return (bot, row, core, code, o) => {
    const d = (row[FLAGS] as number) & DF ? -bytes : bytes
    const prefix = (code[o + C_META] as number) >>> 24
    if (prefix === 0) {
      iterate(op, row, core, d, bot.tag)
      return next(row, code, o)
    }
    if (row[CX] === 0) return next(row, code, o)
    iterate(op, row, core, d, bot.tag)
    const cx = decCx(row)
    const zf = ((row[FLAGS] as number) & ZF) !== 0
    if (cx !== 0 && (prefix === REP || zf === (prefix === REPE))) return EXEC_JUMPED
    return next(row, code, o)
  }
}

/** One iteration of string instruction `op`, SI and DI stepped by `d` (±1 or ±2). */
function iterate(op: number, row: ProcRow, core: Core, d: number, tag: number): void {
  const b = core.bytes
  const si = row[SI] as number
  const di = row[DI] as number
  switch (op) {
    case MOVSB:
      core.write8(di, b[si] as number, tag)
      row[SI] = si + d
      row[DI] = di + d
      return
    case MOVSW:
      core.write16(di, core.read16(si), tag)
      row[SI] = si + d
      row[DI] = di + d
      return
    case CMPSB:
      compare(row, b[si] as number, b[di] as number, 8)
      row[SI] = si + d
      row[DI] = di + d
      return
    case CMPSW:
      compare(row, core.read16(si), core.read16(di), 16)
      row[SI] = si + d
      row[DI] = di + d
      return
    case STOSB:
      core.write8(di, row[AX] as number, tag)
      row[DI] = di + d
      return
    case STOSW:
      core.write16(di, row[AX] as number, tag)
      row[DI] = di + d
      return
    case LODSB:
      setReg8(row, 0, b[si] as number)
      row[SI] = si + d
      return
    case LODSW:
      row[AX] = core.read16(si)
      row[SI] = si + d
      return
    case SCASB:
      compare(row, (row[AX] as number) & 0xff, b[di] as number, 8)
      row[DI] = di + d
      return
    default:
      compare(row, row[AX] as number, core.read16(di), 16)
      row[DI] = di + d
  }
}

/** FLAGS after the compare of CMPS and SCAS: `a - b`, as SUB. */
function compare(row: ProcRow, a: number, b: number, size: 8 | 16): void {
  row[FLAGS] = ((row[FLAGS] as number) & ~STATUS) | flagsSub(a, b, 0, size)
}

/** The flags SAHF loads from AH and LAHF stores to it: SF ZF AF PF CF. */
const AH_FLAGS = SF | ZF | AF | PF | CF

/** The high byte register AH. */
const AH = 4

function sx8(v: number): number {
  return (v << 24) >> 24
}

function sx16(v: number): number {
  return (v << 16) >> 16
}

/** MUL and IMUL: CF and OF from `wide`, the other status flags read 0 (ISA §4). */
function mulFlags(row: ProcRow, wide: boolean): void {
  row[FLAGS] = ((row[FLAGS] as number) & ~STATUS) | (wide ? CF | OF : 0)
}

/** One handler per mnemonic. */
const HANDLERS: Readonly<Record<Mnemonic, Handler>> = {
  // §3.1 Data movement
  mov: (bot, row, core, code, o) => {
    const size = code[o + C_SIZE] as 8 | 16
    const v = value(row, core, code, o, C_K1, size)
    store(row, core, locate(row, code, o, C_K0), size, v, bot.tag)
    return next(row, code, o)
  },
  lea: (_bot, row, _core, code, o) => {
    const reg = (code[o + C_K0] as number) - REG16
    row[reg] = address(row, code[o + C_K1] as number, code[o + C_V1] as number)
    return next(row, code, o)
  },
  xchg: (bot, row, core, code, o) => {
    const size = code[o + C_SIZE] as 8 | 16
    const la = locate(row, code, o, C_K0)
    const lb = locate(row, code, o, C_K1)
    const va = load(row, core, la, size)
    store(row, core, la, size, load(row, core, lb, size), bot.tag)
    store(row, core, lb, size, va, bot.tag)
    return next(row, code, o)
  },
  push: (bot, row, core, code, o) => {
    // PUSH SP pushes the decremented SP, as the 8086 does (ISA §3.1, §9).
    const v =
      code[o + C_K0] === REG16 + SP ? (row[SP] as number) - 2 : value(row, core, code, o, C_K0, 16)
    pushWord(row, core, v, bot.tag)
    return next(row, code, o)
  },
  pop: (bot, row, core, code, o) => {
    const v = popWord(row, core)
    // After SP moves, so POP SP leaves SP holding the popped word.
    store(row, core, locate(row, code, o, C_K0), 16, v, bot.tag)
    return next(row, code, o)
  },
  pushf: (bot, row, core, code, o) => {
    pushWord(row, core, row[FLAGS] as number, bot.tag)
    return next(row, code, o)
  },
  popf: (_bot, row, core, code, o) => {
    row[FLAGS] = (popWord(row, core) & FLAGS_WRITABLE) | FLAGS_INIT
    return next(row, code, o)
  },
  sahf: (_bot, row, _core, code, o) => {
    row[FLAGS] = ((row[FLAGS] as number) & ~AH_FLAGS) | (getReg8(row, AH) & AH_FLAGS)
    return next(row, code, o)
  },
  lahf: (_bot, row, _core, code, o) => {
    // The low byte of FLAGS: SF ZF 0 AF 0 PF 1 CF.
    setReg8(row, AH, row[FLAGS] as number)
    return next(row, code, o)
  },
  cbw: (_bot, row, _core, code, o) => {
    row[AX] = sx8(row[AX] as number)
    return next(row, code, o)
  },
  cwd: (_bot, row, _core, code, o) => {
    row[DX] = (row[AX] as number) & 0x8000 ? 0xffff : 0
    return next(row, code, o)
  },

  // §3.2 Arithmetic and logic
  add: alu(ADD, true),
  or: alu(OR, true),
  adc: alu(ADC, true),
  sbb: alu(SBB, true),
  and: alu(AND, true),
  sub: alu(SUB, true),
  xor: alu(XOR, true),
  cmp: alu(SUB, false),
  test: alu(AND, false),
  not: (bot, row, core, code, o) => {
    const size = code[o + C_SIZE] as 8 | 16
    const loc = locate(row, code, o, C_K0)
    store(row, core, loc, size, ~load(row, core, loc, size), bot.tag)
    return next(row, code, o)
  },
  neg: (bot, row, core, code, o) => {
    const size = code[o + C_SIZE] as 8 | 16
    const loc = locate(row, code, o, C_K0)
    const a = load(row, core, loc, size)
    row[FLAGS] = ((row[FLAGS] as number) & ~STATUS) | flagsSub(0, a, 0, size)
    store(row, core, loc, size, -a, bot.tag)
    return next(row, code, o)
  },
  mul: (_bot, row, core, code, o) => {
    const size = code[o + C_SIZE] as 8 | 16
    const v = value(row, core, code, o, C_K0, size)
    if (size === 8) {
      const p = ((row[AX] as number) & 0xff) * v
      row[AX] = p
      mulFlags(row, p > 0xff)
    } else {
      // Below 2^32, so the double is exact and >>> sees every bit.
      const p = (row[AX] as number) * v
      row[AX] = p
      row[DX] = p >>> 16
      mulFlags(row, p > 0xffff)
    }
    return next(row, code, o)
  },
  imul: (_bot, row, core, code, o) => {
    const size = code[o + C_SIZE] as 8 | 16
    const v = value(row, core, code, o, C_K0, size)
    if (size === 8) {
      const p = sx8(row[AX] as number) * sx8(v)
      row[AX] = p
      mulFlags(row, p !== sx8(p))
    } else {
      const p = sx16(row[AX] as number) * sx16(v)
      row[AX] = p
      row[DX] = p >> 16
      mulFlags(row, p !== sx16(p))
    }
    return next(row, code, o)
  },
  div: (_bot, row, core, code, o, ctx) => {
    // A zero divisor or a quotient too wide kills (ISA §3.2). The flags do not change (§4).
    const size = code[o + C_SIZE] as 8 | 16
    const v = value(row, core, code, o, C_K0, size)
    if (v === 0) return divideError(ctx)
    if (size === 8) {
      const n = row[AX] as number
      const q = Math.floor(n / v)
      if (q > 0xff) return divideError(ctx)
      row[AX] = ((n % v) << 8) | q
    } else {
      const n = (row[DX] as number) * 0x10000 + (row[AX] as number)
      const q = Math.floor(n / v)
      if (q > 0xffff) return divideError(ctx)
      row[AX] = q
      row[DX] = n % v
    }
    return next(row, code, o)
  },
  idiv: (_bot, row, core, code, o, ctx) => {
    // The 8086 takes quotients in -127..127 and -32767..32767 only: -128 and -32768 kill too.
    // The quotient truncates toward zero; the remainder takes the dividend's sign.
    const size = code[o + C_SIZE] as 8 | 16
    const v = value(row, core, code, o, C_K0, size)
    if (size === 8) {
      const d = sx8(v)
      if (d === 0) return divideError(ctx)
      const n = sx16(row[AX] as number)
      const q = Math.trunc(n / d)
      if (q > 0x7f || q < -0x7f) return divideError(ctx)
      row[AX] = (((n % d) & 0xff) << 8) | (q & 0xff)
    } else {
      const d = sx16(v)
      if (d === 0) return divideError(ctx)
      const n = ((row[DX] as number) << 16) | (row[AX] as number)
      const q = Math.trunc(n / d)
      if (q > 0x7fff || q < -0x7fff) return divideError(ctx)
      row[AX] = q
      row[DX] = n % d
    }
    return next(row, code, o)
  },
  inc: incDec(1),
  dec: incDec(-1),
  rol: shift(ROL),
  ror: shift(ROR),
  rcl: shift(RCL),
  rcr: shift(RCR),
  shl: shift(SHL),
  shr: shift(SHR),
  sar: shift(SAR),

  // §3.3 Control flow
  jmp: (_bot, row, core, code, o) => jump(row, target(row, core, code, o)),
  call: (bot, row, core, code, o) => {
    // The target first: `call sp` jumps to SP as it was before the push.
    const to = target(row, core, code, o)
    pushWord(row, core, (row[IP] as number) + ((code[o + C_META] as number) & 7), bot.tag)
    return jump(row, to)
  },
  ret: (_bot, row, core, code, o) => {
    const to = popWord(row, core)
    if (code[o + C_K0] === IMM) row[SP] = (row[SP] as number) + (code[o + C_V0] as number)
    return jump(row, to)
  },
  jo: (_bot, row, _core, code, o) => branch(row, code, o, ((row[FLAGS] as number) & OF) !== 0),
  jno: (_bot, row, _core, code, o) => branch(row, code, o, ((row[FLAGS] as number) & OF) === 0),
  jc: (_bot, row, _core, code, o) => branch(row, code, o, ((row[FLAGS] as number) & CF) !== 0),
  jnc: (_bot, row, _core, code, o) => branch(row, code, o, ((row[FLAGS] as number) & CF) === 0),
  jz: (_bot, row, _core, code, o) => branch(row, code, o, ((row[FLAGS] as number) & ZF) !== 0),
  jnz: (_bot, row, _core, code, o) => branch(row, code, o, ((row[FLAGS] as number) & ZF) === 0),
  jna: (_bot, row, _core, code, o) =>
    branch(row, code, o, ((row[FLAGS] as number) & (CF | ZF)) !== 0),
  ja: (_bot, row, _core, code, o) =>
    branch(row, code, o, ((row[FLAGS] as number) & (CF | ZF)) === 0),
  js: (_bot, row, _core, code, o) => branch(row, code, o, ((row[FLAGS] as number) & SF) !== 0),
  jns: (_bot, row, _core, code, o) => branch(row, code, o, ((row[FLAGS] as number) & SF) === 0),
  jpe: (_bot, row, _core, code, o) => branch(row, code, o, ((row[FLAGS] as number) & PF) !== 0),
  jpo: (_bot, row, _core, code, o) => branch(row, code, o, ((row[FLAGS] as number) & PF) === 0),
  jl: (_bot, row, _core, code, o) => branch(row, code, o, lt(row[FLAGS] as number)),
  jnl: (_bot, row, _core, code, o) => branch(row, code, o, !lt(row[FLAGS] as number)),
  jng: (_bot, row, _core, code, o) => {
    const f = row[FLAGS] as number
    return branch(row, code, o, (f & ZF) !== 0 || lt(f))
  },
  jg: (_bot, row, _core, code, o) => {
    const f = row[FLAGS] as number
    return branch(row, code, o, (f & ZF) === 0 && !lt(f))
  },
  // LOOP family: CX -= 1 with no flags, then jump when CX != 0 and the condition holds.
  loopne: (_bot, row, _core, code, o) =>
    branch(row, code, o, decCx(row) !== 0 && ((row[FLAGS] as number) & ZF) === 0),
  loope: (_bot, row, _core, code, o) =>
    branch(row, code, o, decCx(row) !== 0 && ((row[FLAGS] as number) & ZF) !== 0),
  loop: (_bot, row, _core, code, o) => branch(row, code, o, decCx(row) !== 0),
  jcxz: (_bot, row, _core, code, o) => branch(row, code, o, row[CX] === 0),

  // §3.4 String instructions
  movsb: stringOp(MOVSB, 1),
  movsw: stringOp(MOVSW, 2),
  cmpsb: stringOp(CMPSB, 1),
  cmpsw: stringOp(CMPSW, 2),
  stosb: stringOp(STOSB, 1),
  stosw: stringOp(STOSW, 2),
  lodsb: stringOp(LODSB, 1),
  lodsw: stringOp(LODSW, 2),
  scasb: stringOp(SCASB, 1),
  scasw: stringOp(SCASW, 2),
  cld: (_bot, row, _core, code, o) => {
    row[FLAGS] = (row[FLAGS] as number) & ~DF
    return next(row, code, o)
  },
  std: (_bot, row, _core, code, o) => {
    row[FLAGS] = (row[FLAGS] as number) | DF
    return next(row, code, o)
  },

  // §3.5 Flags and misc
  clc: (_bot, row, _core, code, o) => {
    row[FLAGS] = (row[FLAGS] as number) & ~CF
    return next(row, code, o)
  },
  stc: (_bot, row, _core, code, o) => {
    row[FLAGS] = (row[FLAGS] as number) | CF
    return next(row, code, o)
  },
  cmc: (_bot, row, _core, code, o) => {
    row[FLAGS] = (row[FLAGS] as number) ^ CF
    return next(row, code, o)
  },
  nop: (_bot, row, _core, code, o) => next(row, code, o),

  // §3.6 Process control
  dat: kill('dat'),
  spl: (bot, row, core, code, o, ctx) => {
    const to = target(row, core, code, o)
    next(row, code, o)
    // At the cap SPL is a NOP: no child, no kill.
    if (bot.queue.size >= bot.queue.capacity) return EXEC_CONTINUE
    ctx.target = to
    return EXEC_SPAWN
  },
  hlt: kill('hlt'),
  int3: kill('int3'),
}

/** The handlers by op code: each mnemonic's at its index in MNEMONICS, then undefined bytes'. */
const OPS: readonly Handler[] = [...MNEMONICS.map((m) => HANDLERS[m]), kill('undefined')]
const OP_UNDEFINED = MNEMONICS.length
const OP_OF = Object.fromEntries(MNEMONICS.map((m, i) => [m, i])) as Readonly<
  Record<Mnemonic, number>
>

/**
 * Runs the compiled instruction at offset `o` of `code`, the instruction at `row[IP]`, for
 * process `row` of `bot` (ISA §5.3 steps 2 to 5). Registers, IP, and FLAGS change in place, and
 * every memory write carries `bot.tag`. A killed process's row is left as it was. One REP
 * iteration is one call.
 */
export function run(
  bot: ExecBot,
  row: ProcRow,
  core: Core,
  code: Int32Array,
  o: number,
  ctx: ExecContext,
): ExecOutcome {
  return (OPS[code[o + C_OP] as number] as Handler)(bot, row, core, code, o, ctx)
}

/** `execOne` compiles into this. */
const SCRATCH = new Int32Array(C_FIELDS)

/**
 * Executes `decoded`, the instruction at `row[IP]`, as `run` does. `decoded` is undefined for
 * undefined bytes.
 */
export function execOne(
  bot: ExecBot,
  row: ProcRow,
  core: Core,
  decoded: Instr | undefined,
  ctx: ExecContext,
): ExecOutcome {
  if (decoded === undefined) {
    ctx.reason = 'undefined'
    return EXEC_KILLED
  }
  compileInto(SCRATCH, 0, decoded)
  return run(bot, row, core, SCRATCH, 0, ctx)
}
