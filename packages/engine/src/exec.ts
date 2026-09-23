/**
 * The fetch and execute stages (ISA §5.3): one instruction of one process. The battle fetches
 * the instruction at the process's IP with a `Fetcher`, runs it with `execOne`, and then acts on
 * the outcome. Nothing here allocates per instruction.
 *
 * Where ISA §3 and §4 leave a behavior open, the 8086 silicon decides, checked against hardware
 * captures of an 8088 (the same execution unit): `PUSH SP` pushes the decremented SP, `POP SP`
 * keeps the popped word, IDIV kills on a quotient of -128 or -32768, and a shift by a count of 0
 * still writes its memory operand back.
 */
import type {
  ImmOperand,
  Instr,
  KillReason,
  MemOperand,
  Mnemonic,
  Operand,
  Reader,
  RegOperand,
  RelOperand,
} from '@asmbots/codec'
import { DECODE_UNDEFINED, decodeInto } from '@asmbots/codec'
import type { Core } from './core'
import { ADDR_MASK } from './core'
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

/**
 * The fetch stage for one core (ISA §5.3 step 1). `fetch` decodes into `instr` and its operand
 * objects, which the next call rewrites, so read them before fetching again.
 */
export class Fetcher {
  readonly instr: Instr = { mnemonic: 'nop', operands: [], prefix: undefined, length: 1 }
  private readonly read: Reader

  constructor(core: Core) {
    const bytes = core.bytes
    this.read = (a) => bytes[a & ADDR_MASK] as number
  }

  /**
   * The instruction at `addr`, reading up to 6 bytes that wrap at 64 KB, or undefined when the
   * bytes are undefined (ISA §3.7). DAT, HLT, and INT3 decode; executing them kills.
   */
  fetch(addr: number): Instr | undefined {
    return decodeInto(this.read, addr, this.instr) === DECODE_UNDEFINED ? undefined : this.instr
  }
}

/**
 * Executes `decoded`, the instruction at `row[IP]`, for process `row` of `bot` (ISA §5.3 steps
 * 2 to 5). `decoded` is undefined for undefined bytes. Registers, IP, and FLAGS change in place,
 * and every memory write carries `bot.tag`. A killed process's row is left as it was. One REP
 * iteration is one call.
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
  return HANDLERS[decoded.mnemonic](bot, row, core, decoded, ctx)
}

/** The effective address of `m` (ISA §2.2): base + index + displacement, mod 64 KB. */
export function ea(row: ProcRow, m: MemOperand): number {
  let a = m.disp
  if (m.base === 'bx') a += row[BX] as number
  else if (m.base === 'bp') a += row[BP] as number
  if (m.index === 'si') a += row[SI] as number
  else if (m.index === 'di') a += row[DI] as number
  return a & ADDR_MASK
}

type Handler = (
  bot: ExecBot,
  row: ProcRow,
  core: Core,
  instr: Instr,
  ctx: ExecContext,
) => ExecOutcome

/*
 * A destination is resolved once, so a read-modify-write computes its address once: a memory
 * address (0..0xFFFF), `REG16 + code` for a word register, or `REG8 + code` for a byte register.
 */
const REG16 = 0x10000
const REG8 = 0x10008

function locate(row: ProcRow, o: Operand): number {
  switch (o.kind) {
    case 'mem':
      return ea(row, o)
    case 'moffs':
      return o.addr
    case 'reg16':
      return REG16 + o.reg
    case 'reg8':
      return REG8 + o.reg
    default:
      throw new Error(`exec: a ${o.kind} operand is not a location`)
  }
}

/** The data size of a register or memory operand. */
function sizeOf(o: Operand): 8 | 16 {
  if (o.kind === 'reg8') return 8
  return (o.kind === 'mem' || o.kind === 'moffs') && o.size === 8 ? 8 : 16
}

function load(row: ProcRow, core: Core, loc: number, size: 8 | 16): number {
  if (loc < REG16) return size === 8 ? (core.bytes[loc] as number) : core.read16(loc)
  return loc < REG8 ? (row[loc - REG16] as number) : getReg8(row, loc - REG8)
}

/** Stores the low `size` bits of `v`. A memory store is a write, tagged `tag`. */
function store(row: ProcRow, core: Core, loc: number, size: 8 | 16, v: number, tag: number) {
  if (loc >= REG8) setReg8(row, loc - REG8, v)
  else if (loc >= REG16) row[loc - REG16] = v
  else if (size === 8) core.write8(loc, v, tag)
  else core.write16(loc, v, tag)
}

/** A source operand's value. A sign-extended imm8 comes back negative; users mask. */
function value(row: ProcRow, core: Core, o: Operand): number {
  switch (o.kind) {
    case 'reg16':
      return row[o.reg] as number
    case 'reg8':
      return getReg8(row, o.reg)
    case 'imm':
      return o.value
    case 'mem': {
      const a = ea(row, o)
      return o.size === 8 ? (core.bytes[a] as number) : core.read16(a)
    }
    case 'moffs':
      return o.size === 8 ? (core.bytes[o.addr] as number) : core.read16(o.addr)
    case 'rel':
      throw new Error('exec: a rel operand has no value')
  }
}

/** The target of a jump, call, or SPL: relative to this instruction, or absolute in r/m16. */
function target(row: ProcRow, core: Core, o: Operand): number {
  return o.kind === 'rel' ? ((row[IP] as number) + o.target) & ADDR_MASK : value(row, core, o)
}

function next(row: ProcRow, instr: Instr): ExecOutcome {
  row[IP] = (row[IP] as number) + instr.length
  return EXEC_CONTINUE
}

function jump(row: ProcRow, to: number): ExecOutcome {
  row[IP] = to
  return EXEC_JUMPED
}

/** Takes the rel8 branch of `instr` when `taken`. */
function branch(row: ProcRow, instr: Instr, taken: boolean): ExecOutcome {
  if (!taken) return next(row, instr)
  return jump(row, (row[IP] as number) + (instr.operands[0] as RelOperand).target)
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

function kill(reason: DeathReason): Handler {
  return (_bot, _row, _core, _instr, ctx) => {
    ctx.reason = reason
    return EXEC_KILLED
  }
}

function divideError(ctx: ExecContext): ExecOutcome {
  ctx.reason = 'div'
  return EXEC_KILLED
}

/** `op(a, b, flags, size)` → the result in the low 16 bits, the status flags above them. */
type AluOp = (a: number, b: number, flags: number, size: 8 | 16) => number

/** A two-operand ALU instruction: `dst = dst op src`, or just the flags when `writes` is false. */
function alu(op: AluOp, writes: boolean): Handler {
  return (bot, row, core, instr) => {
    const d = instr.operands[0] as Operand
    const size = sizeOf(d)
    const loc = locate(row, d)
    const a = load(row, core, loc, size)
    const out = op(a, value(row, core, instr.operands[1] as Operand), row[FLAGS] as number, size)
    row[FLAGS] = ((row[FLAGS] as number) & ~STATUS) | (out >>> 16)
    if (writes) store(row, core, loc, size, out, bot.tag)
    return next(row, instr)
  }
}

const add: AluOp = (a, b, _f, s) => ((a + b) & 0xffff) | (flagsAdd(a, b, 0, s) << 16)
const adc: AluOp = (a, b, f, s) => ((a + b + (f & CF)) & 0xffff) | (flagsAdd(a, b, f & CF, s) << 16)
const sub: AluOp = (a, b, _f, s) => ((a - b) & 0xffff) | (flagsSub(a, b, 0, s) << 16)
const sbb: AluOp = (a, b, f, s) => ((a - b - (f & CF)) & 0xffff) | (flagsSub(a, b, f & CF, s) << 16)
const and: AluOp = (a, b, _f, s) => (a & b & 0xffff) | (flagsLogic(a & b, s) << 16)
const or: AluOp = (a, b, _f, s) => ((a | b) & 0xffff) | (flagsLogic(a | b, s) << 16)
const xor: AluOp = (a, b, _f, s) => ((a ^ b) & 0xffff) | (flagsLogic(a ^ b, s) << 16)

/** INC (`delta` 1) or DEC (-1): the status flags except CF. */
function incDec(delta: 1 | -1): Handler {
  return (bot, row, core, instr) => {
    const d = instr.operands[0] as Operand
    const size = sizeOf(d)
    const loc = locate(row, d)
    const a = load(row, core, loc, size)
    row[FLAGS] = flagsIncDec(a, delta, row[FLAGS] as number, size)
    store(row, core, loc, size, a + delta, bot.tag)
    return next(row, instr)
  }
}

/** A shift or rotate helper from ./flags: `result | newFlags << 16`. */
type ShiftOp = (value: number, count: number, flags: number, size: 8 | 16) => number

/**
 * Shifts r/m by 1 or by CL, un-masked (ISA §4). The operand is written back even for a count
 * of 0, unchanged, as the 8086 runs the write cycle.
 */
function shift(op: ShiftOp): Handler {
  return (bot, row, core, instr) => {
    const d = instr.operands[0] as Operand
    const size = sizeOf(d)
    const loc = locate(row, d)
    const count = value(row, core, instr.operands[1] as Operand)
    const out = op(load(row, core, loc, size), count, row[FLAGS] as number, size)
    row[FLAGS] = out >>> 16
    store(row, core, loc, size, out, bot.tag)
    return next(row, instr)
  }
}

/** Jcc: jump when `cond(FLAGS)` holds. */
function jcc(cond: (flags: number) => boolean): Handler {
  return (_bot, row, _core, instr) => branch(row, instr, cond(row[FLAGS] as number))
}

/** SF xor OF: the signed less-than of JL and JNG. */
function lt(f: number): boolean {
  return ((f & SF) !== 0) !== ((f & OF) !== 0)
}

/** LOOP family: CX -= 1 with no flags, then jump when CX != 0 and `cond(FLAGS)` holds. */
function loopWhile(cond: (flags: number) => boolean): Handler {
  return (_bot, row, _core, instr) => {
    const cx = ((row[CX] as number) - 1) & 0xffff
    row[CX] = cx
    return branch(row, instr, cx !== 0 && cond(row[FLAGS] as number))
  }
}

/** One iteration of a string instruction, SI and DI stepped by `d` (±1 or ±2). */
type Iteration = (row: ProcRow, core: Core, d: number, tag: number) => void

/**
 * A string instruction (ISA §3.4). DF set steps SI and DI down. With a REP prefix, one call is
 * one iteration: CX == 0 on entry does nothing, and while CX != 0 (and, for REPE and REPNE, ZF
 * matches) after the iteration, IP stays on the prefix so the process runs it again next turn.
 */
function stringOp(bytes: 1 | 2, iterate: Iteration): Handler {
  return (bot, row, core, instr) => {
    const d = (row[FLAGS] as number) & DF ? -bytes : bytes
    const prefix = instr.prefix
    if (prefix === undefined) {
      iterate(row, core, d, bot.tag)
      return next(row, instr)
    }
    if (row[CX] === 0) return next(row, instr)
    iterate(row, core, d, bot.tag)
    const cx = ((row[CX] as number) - 1) & 0xffff
    row[CX] = cx
    const zf = ((row[FLAGS] as number) & ZF) !== 0
    if (cx !== 0 && (prefix === 'rep' || zf === (prefix === 'repe'))) return EXEC_JUMPED
    return next(row, instr)
  }
}

function step(row: ProcRow, reg: number, d: number): void {
  row[reg] = (row[reg] as number) + d
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

/** One handler per mnemonic, keyed by `Instr.mnemonic`. */
const HANDLERS: Readonly<Record<Mnemonic, Handler>> = {
  // §3.1 Data movement
  mov: (bot, row, core, instr) => {
    const d = instr.operands[0] as Operand
    const v = value(row, core, instr.operands[1] as Operand)
    store(row, core, locate(row, d), sizeOf(d), v, bot.tag)
    return next(row, instr)
  },
  lea: (_bot, row, _core, instr) => {
    row[(instr.operands[0] as RegOperand).reg] = ea(row, instr.operands[1] as MemOperand)
    return next(row, instr)
  },
  xchg: (bot, row, core, instr) => {
    const a = instr.operands[0] as Operand
    const b = instr.operands[1] as Operand
    const size = sizeOf(a)
    const la = locate(row, a)
    const lb = locate(row, b)
    const va = load(row, core, la, size)
    store(row, core, la, size, load(row, core, lb, size), bot.tag)
    store(row, core, lb, size, va, bot.tag)
    return next(row, instr)
  },
  push: (bot, row, core, instr) => {
    const o = instr.operands[0] as Operand
    // PUSH SP pushes the decremented SP, as the 8086 does (ISA §3.1, §9).
    const v = o.kind === 'reg16' && o.reg === SP ? (row[SP] as number) - 2 : value(row, core, o)
    pushWord(row, core, v, bot.tag)
    return next(row, instr)
  },
  pop: (bot, row, core, instr) => {
    const v = popWord(row, core)
    // After SP moves, so POP SP leaves SP holding the popped word.
    store(row, core, locate(row, instr.operands[0] as Operand), 16, v, bot.tag)
    return next(row, instr)
  },
  pushf: (bot, row, core, instr) => {
    pushWord(row, core, row[FLAGS] as number, bot.tag)
    return next(row, instr)
  },
  popf: (_bot, row, core, instr) => {
    row[FLAGS] = (popWord(row, core) & FLAGS_WRITABLE) | FLAGS_INIT
    return next(row, instr)
  },
  sahf: (_bot, row, _core, instr) => {
    row[FLAGS] = ((row[FLAGS] as number) & ~AH_FLAGS) | (getReg8(row, AH) & AH_FLAGS)
    return next(row, instr)
  },
  lahf: (_bot, row, _core, instr) => {
    // The low byte of FLAGS: SF ZF 0 AF 0 PF 1 CF.
    setReg8(row, AH, row[FLAGS] as number)
    return next(row, instr)
  },
  cbw: (_bot, row, _core, instr) => {
    row[AX] = sx8(row[AX] as number)
    return next(row, instr)
  },
  cwd: (_bot, row, _core, instr) => {
    row[DX] = (row[AX] as number) & 0x8000 ? 0xffff : 0
    return next(row, instr)
  },

  // §3.2 Arithmetic and logic
  add: alu(add, true),
  or: alu(or, true),
  adc: alu(adc, true),
  sbb: alu(sbb, true),
  and: alu(and, true),
  sub: alu(sub, true),
  xor: alu(xor, true),
  cmp: alu(sub, false),
  test: alu(and, false),
  not: (bot, row, core, instr) => {
    const d = instr.operands[0] as Operand
    const size = sizeOf(d)
    const loc = locate(row, d)
    store(row, core, loc, size, ~load(row, core, loc, size), bot.tag)
    return next(row, instr)
  },
  neg: (bot, row, core, instr) => {
    const d = instr.operands[0] as Operand
    const size = sizeOf(d)
    const loc = locate(row, d)
    const a = load(row, core, loc, size)
    row[FLAGS] = ((row[FLAGS] as number) & ~STATUS) | flagsSub(0, a, 0, size)
    store(row, core, loc, size, -a, bot.tag)
    return next(row, instr)
  },
  mul: (_bot, row, core, instr) => {
    const s = instr.operands[0] as Operand
    const v = value(row, core, s)
    if (sizeOf(s) === 8) {
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
    return next(row, instr)
  },
  imul: (_bot, row, core, instr) => {
    const s = instr.operands[0] as Operand
    const v = value(row, core, s)
    if (sizeOf(s) === 8) {
      const p = sx8(row[AX] as number) * sx8(v)
      row[AX] = p
      mulFlags(row, p !== sx8(p))
    } else {
      const p = sx16(row[AX] as number) * sx16(v)
      row[AX] = p
      row[DX] = p >> 16
      mulFlags(row, p !== sx16(p))
    }
    return next(row, instr)
  },
  div: (_bot, row, core, instr, ctx) => {
    // A zero divisor or a quotient too wide kills (ISA §3.2). The flags do not change (§4).
    const s = instr.operands[0] as Operand
    const v = value(row, core, s)
    if (v === 0) return divideError(ctx)
    if (sizeOf(s) === 8) {
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
    return next(row, instr)
  },
  idiv: (_bot, row, core, instr, ctx) => {
    // The 8086 takes quotients in -127..127 and -32767..32767 only: -128 and -32768 kill too.
    // The quotient truncates toward zero; the remainder takes the dividend's sign.
    const s = instr.operands[0] as Operand
    const v = value(row, core, s)
    if (sizeOf(s) === 8) {
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
    return next(row, instr)
  },
  inc: incDec(1),
  dec: incDec(-1),
  rol: shift(flagsRol),
  ror: shift(flagsRor),
  rcl: shift(flagsRcl),
  rcr: shift(flagsRcr),
  shl: shift(flagsShl),
  shr: shift(flagsShr),
  sar: shift(flagsSar),

  // §3.3 Control flow
  jmp: (_bot, row, core, instr) => jump(row, target(row, core, instr.operands[0] as Operand)),
  call: (bot, row, core, instr) => {
    // The target first: `call sp` jumps to SP as it was before the push.
    const to = target(row, core, instr.operands[0] as Operand)
    pushWord(row, core, (row[IP] as number) + instr.length, bot.tag)
    return jump(row, to)
  },
  ret: (_bot, row, core, instr) => {
    const to = popWord(row, core)
    const n = instr.operands[0] as ImmOperand | undefined
    if (n !== undefined) row[SP] = (row[SP] as number) + n.value
    return jump(row, to)
  },
  jo: jcc((f) => (f & OF) !== 0),
  jno: jcc((f) => (f & OF) === 0),
  jc: jcc((f) => (f & CF) !== 0),
  jnc: jcc((f) => (f & CF) === 0),
  jz: jcc((f) => (f & ZF) !== 0),
  jnz: jcc((f) => (f & ZF) === 0),
  jna: jcc((f) => (f & (CF | ZF)) !== 0),
  ja: jcc((f) => (f & (CF | ZF)) === 0),
  js: jcc((f) => (f & SF) !== 0),
  jns: jcc((f) => (f & SF) === 0),
  jpe: jcc((f) => (f & PF) !== 0),
  jpo: jcc((f) => (f & PF) === 0),
  jl: jcc(lt),
  jnl: jcc((f) => !lt(f)),
  jng: jcc((f) => (f & ZF) !== 0 || lt(f)),
  jg: jcc((f) => (f & ZF) === 0 && !lt(f)),
  loopne: loopWhile((f) => (f & ZF) === 0),
  loope: loopWhile((f) => (f & ZF) !== 0),
  loop: loopWhile(() => true),
  jcxz: (_bot, row, _core, instr) => branch(row, instr, row[CX] === 0),

  // §3.4 String instructions
  movsb: stringOp(1, (row, core, d, tag) => {
    core.write8(row[DI] as number, core.bytes[row[SI] as number] as number, tag)
    step(row, SI, d)
    step(row, DI, d)
  }),
  movsw: stringOp(2, (row, core, d, tag) => {
    core.write16(row[DI] as number, core.read16(row[SI] as number), tag)
    step(row, SI, d)
    step(row, DI, d)
  }),
  cmpsb: stringOp(1, (row, core, d) => {
    const b = core.bytes
    compare(row, b[row[SI] as number] as number, b[row[DI] as number] as number, 8)
    step(row, SI, d)
    step(row, DI, d)
  }),
  cmpsw: stringOp(2, (row, core, d) => {
    compare(row, core.read16(row[SI] as number), core.read16(row[DI] as number), 16)
    step(row, SI, d)
    step(row, DI, d)
  }),
  stosb: stringOp(1, (row, core, d, tag) => {
    core.write8(row[DI] as number, row[AX] as number, tag)
    step(row, DI, d)
  }),
  stosw: stringOp(2, (row, core, d, tag) => {
    core.write16(row[DI] as number, row[AX] as number, tag)
    step(row, DI, d)
  }),
  lodsb: stringOp(1, (row, core, d) => {
    setReg8(row, 0, core.bytes[row[SI] as number] as number)
    step(row, SI, d)
  }),
  lodsw: stringOp(2, (row, core, d) => {
    row[AX] = core.read16(row[SI] as number)
    step(row, SI, d)
  }),
  scasb: stringOp(1, (row, core, d) => {
    compare(row, (row[AX] as number) & 0xff, core.bytes[row[DI] as number] as number, 8)
    step(row, DI, d)
  }),
  scasw: stringOp(2, (row, core, d) => {
    compare(row, row[AX] as number, core.read16(row[DI] as number), 16)
    step(row, DI, d)
  }),
  cld: (_bot, row, _core, instr) => {
    row[FLAGS] = (row[FLAGS] as number) & ~DF
    return next(row, instr)
  },
  std: (_bot, row, _core, instr) => {
    row[FLAGS] = (row[FLAGS] as number) | DF
    return next(row, instr)
  },

  // §3.5 Flags and misc
  clc: (_bot, row, _core, instr) => {
    row[FLAGS] = (row[FLAGS] as number) & ~CF
    return next(row, instr)
  },
  stc: (_bot, row, _core, instr) => {
    row[FLAGS] = (row[FLAGS] as number) | CF
    return next(row, instr)
  },
  cmc: (_bot, row, _core, instr) => {
    row[FLAGS] = (row[FLAGS] as number) ^ CF
    return next(row, instr)
  },
  nop: (_bot, row, _core, instr) => next(row, instr),

  // §3.6 Process control
  dat: kill('dat'),
  spl: (bot, row, core, instr, ctx) => {
    const to = target(row, core, instr.operands[0] as Operand)
    next(row, instr)
    // At the cap SPL is a NOP: no child, no kill.
    if (bot.queue.size >= bot.queue.capacity) return EXEC_CONTINUE
    ctx.target = to
    return EXEC_SPAWN
  },
  hlt: kill('hlt'),
  int3: kill('int3'),
}
