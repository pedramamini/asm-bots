import { describe, expect, it } from 'bun:test'
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
} from '../src/index'

type Shift = 'shl' | 'shr' | 'sar' | 'rol' | 'ror' | 'rcl' | 'rcr'
type Op =
  | 'add'
  | 'adc'
  | 'sub'
  | 'sbb'
  | 'cmp'
  | 'neg'
  | 'and'
  | 'or'
  | 'xor'
  | 'test'
  | 'inc'
  | 'dec'
  | Shift

const SHIFTS: Record<Shift, (value: number, count: number, flags: number, size: 8 | 16) => number> =
  {
    shl: flagsShl,
    shr: flagsShr,
    sar: flagsSar,
    rol: flagsRol,
    ror: flagsRor,
    rcl: flagsRcl,
    rcr: flagsRcr,
  }

const NAMED = [
  ['CF', CF],
  ['PF', PF],
  ['AF', AF],
  ['ZF', ZF],
  ['SF', SF],
  ['DF', DF],
  ['OF', OF],
] as const

/** FLAGS with bit 1 and the named flags set: `on('CF ZF')`. */
function on(names: string): number {
  let f = FLAGS_INIT
  for (const name of names.split(' ').filter(Boolean)) {
    const hit = NAMED.find(([n]) => n === name)
    if (hit === undefined) throw new Error(`no flag ${name}`)
    f |= hit[1]
  }
  return f
}

/** The set flags by name, in bit order, flagging a clear bit 1 or any stray bit. */
function show(f: number): string {
  const out: string[] = NAMED.filter(([, bit]) => f & bit).map(([n]) => n)
  if ((f & FLAGS_INIT) === 0) out.push('!bit1')
  const stray = f & ~(FLAGS_WRITABLE | FLAGS_INIT)
  if (stray) out.push(`+0x${stray.toString(16)}`)
  return out.join(' ')
}

/**
 * One instruction's result and FLAGS, from the helpers the way the execute stage uses them.
 * `b` is the second operand, or the count for a shift; NEG, INC, and DEC ignore it. CMP and
 * TEST give the ALU result they discard.
 */
function apply(op: Op, size: 8 | 16, a: number, b: number, flags: number): [number, number] {
  const mask = size === 8 ? 0xff : 0xffff
  const cf = flags & CF
  const merge = (status: number) => (flags & ~STATUS) | status
  switch (op) {
    case 'add':
      return [(a + b) & mask, merge(flagsAdd(a, b, 0, size))]
    case 'adc':
      return [(a + b + cf) & mask, merge(flagsAdd(a, b, cf, size))]
    case 'sub':
    case 'cmp':
      return [(a - b) & mask, merge(flagsSub(a, b, 0, size))]
    case 'sbb':
      return [(a - b - cf) & mask, merge(flagsSub(a, b, cf, size))]
    case 'neg':
      return [-a & mask, merge(flagsSub(0, a, 0, size))]
    case 'and':
    case 'test':
      return [a & b & mask, merge(flagsLogic(a & b, size))]
    case 'or':
      return [(a | b) & mask, merge(flagsLogic(a | b, size))]
    case 'xor':
      return [(a ^ b) & mask, merge(flagsLogic(a ^ b, size))]
    case 'inc':
      return [(a + 1) & mask, flagsIncDec(a, 1, flags, size)]
    case 'dec':
      return [(a - 1) & mask, flagsIncDec(a, -1, flags, size)]
    default: {
      const out = SHIFTS[op](a, b, flags, size)
      return [out & 0xffff, out >>> 16]
    }
  }
}

/**
 * Cases worked by hand from the documented 8086 flag rules (Intel's 8086 Family User's Manual,
 * and ISA §4): [case, op, size, a, b or count, flags in, result, flags out]. Flags are listed by
 * name; bit 1 is implied. Flags an instruction leaves alone appear in both lists.
 */
type Row = [string, Op, 8 | 16, number, number, string, number, string]
const DOCUMENTED: Row[] = [
  // ADD, ADC: CF is the carry out of the top bit, OF signed overflow, AF the carry out of bit 3.
  ['add ax, 1 at 0x7FFF sets OF and SF', 'add', 16, 0x7fff, 1, '', 0x8000, 'PF AF SF OF'],
  ['add al, 1 at 0x7F sets OF and SF', 'add', 8, 0x7f, 1, '', 0x80, 'AF SF OF'],
  ['add ax, 1 at 0xFFFF sets CF and ZF', 'add', 16, 0xffff, 1, '', 0x0000, 'CF PF AF ZF'],
  ['add al, 0xFF at 1 carries without overflow', 'add', 8, 0x01, 0xff, '', 0x00, 'CF PF AF ZF'],
  ['add al, 0x80 at 0x80: two negatives overflow', 'add', 8, 0x80, 0x80, '', 0x00, 'CF PF ZF OF'],
  ['add ax, 0x8000 at 0x8000', 'add', 16, 0x8000, 0x8000, '', 0x0000, 'CF PF ZF OF'],
  ['add al, 2 at 1: PF of 0x03 is 1', 'add', 8, 0x01, 0x02, '', 0x03, 'PF'],
  ['add al, 6 at 1: PF of 0x07 is 0', 'add', 8, 0x01, 0x06, '', 0x07, ''],
  ['add ax, 0x100 at 0xFF: PF reads the low byte', 'add', 16, 0x00ff, 0x0100, '', 0x01ff, 'PF'],
  ['add ax, 8 at 8: AF is the carry out of bit 3', 'add', 16, 0x0008, 0x0008, '', 0x0010, 'AF'],
  ['add ax, 0x4000 at 0x4000', 'add', 16, 0x4000, 0x4000, '', 0x8000, 'PF SF OF'],
  ['add ax, -1 (sign-extended imm8) at 5', 'add', 16, 0x0005, -1, '', 0x0004, 'CF AF'],
  ['add ax, 1 at 1 keeps DF', 'add', 16, 0x0001, 1, 'DF', 0x0002, 'DF'],
  ['adc ax, 0 with CF at 0xFFFF', 'adc', 16, 0xffff, 0, 'CF', 0x0000, 'CF PF AF ZF'],
  ['adc al, 0x7F with CF at 0 overflows', 'adc', 8, 0x00, 0x7f, 'CF', 0x80, 'AF SF OF'],
  ['adc ax, 0xFFFF with CF at 0xFFFF', 'adc', 16, 0xffff, 0xffff, 'CF', 0xffff, 'CF PF AF SF'],
  // SUB, SBB, CMP, NEG: CF is the borrow, AF the borrow into bit 3.
  ['sub ax, 1 at 0 sets CF and SF', 'sub', 16, 0x0000, 1, '', 0xffff, 'CF PF AF SF'],
  ['sub al, 1 at 0x80 overflows', 'sub', 8, 0x80, 1, '', 0x7f, 'AF OF'],
  ['sub ax, 1 at 0x8000 overflows', 'sub', 16, 0x8000, 1, '', 0x7fff, 'PF AF OF'],
  ['sub al, 0x10 at 0x10: no borrow into bit 3', 'sub', 8, 0x10, 0x10, '', 0x00, 'PF ZF'],
  ['sub ax, 1 at 0x10: AF is the borrow into bit 3', 'sub', 16, 0x0010, 1, '', 0x000f, 'PF AF'],
  ['cmp ax, ax sets ZF', 'cmp', 16, 0x1234, 0x1234, '', 0x0000, 'PF ZF'],
  ['cmp al, 2 at 1: below', 'cmp', 8, 0x01, 0x02, '', 0xff, 'CF PF AF SF'],
  ['cmp ax, 3 at 5: above', 'cmp', 16, 0x0005, 0x0003, '', 0x0002, ''],
  ['cmp ax, 0x8000 at 0 overflows', 'cmp', 16, 0x0000, 0x8000, '', 0x8000, 'CF PF SF OF'],
  ['cmp al, 0x80 at 0x7F overflows', 'cmp', 8, 0x7f, 0x80, '', 0xff, 'CF PF SF OF'],
  ['cmp al, -1 at -2: signed less, SF != OF', 'cmp', 8, 0xfe, 0xff, '', 0xff, 'CF PF AF SF'],
  ['sbb ax, 0 with CF at 0', 'sbb', 16, 0x0000, 0, 'CF', 0xffff, 'CF PF AF SF'],
  ['sbb al, 0x7F at 0x80 overflows', 'sbb', 8, 0x80, 0x7f, '', 0x01, 'AF OF'],
  ['sbb ax, 0xFFFF with CF at 0xFFFF', 'sbb', 16, 0xffff, 0xffff, 'CF', 0xffff, 'CF PF AF SF'],
  ['neg ax at 0 clears CF', 'neg', 16, 0x0000, 0, 'CF', 0x0000, 'PF ZF'],
  ['neg ax at 1 sets CF', 'neg', 16, 0x0001, 0, '', 0xffff, 'CF PF AF SF'],
  ['neg ax at 0x8000 overflows', 'neg', 16, 0x8000, 0, '', 0x8000, 'CF PF SF OF'],
  ['neg al at 0x80 overflows', 'neg', 8, 0x80, 0, '', 0x80, 'CF SF OF'],
  // AND, OR, XOR, TEST: CF and OF clear, AF reads 0.
  ['and ax, 0xFF at 0xFF00 clears CF, OF, AF', 'and', 16, 0xff00, 0x00ff, 'CF AF OF', 0, 'PF ZF'],
  ['or al, 0x80 at 0', 'or', 8, 0x00, 0x80, '', 0x80, 'SF'],
  ['xor ax, ax', 'xor', 16, 0xbeef, 0xbeef, 'CF OF', 0x0000, 'PF ZF'],
  ['test al, 3 at 3: PF of 0x03 is 1', 'test', 8, 0x03, 0x03, '', 0x03, 'PF'],
  ['test al, 7 at 0xFF: PF of 0x07 is 0', 'test', 8, 0xff, 0x07, 'CF', 0x07, ''],
  ['and ax, 0x8001 at 0xFFFF', 'and', 16, 0xffff, 0x8001, '', 0x8001, 'SF'],
  ['or ax, 3 at 0x300: PF reads the low byte only', 'or', 16, 0x0300, 0x0003, '', 0x0303, 'PF'],
  ['xor al, 0xFF at 0x0F keeps DF', 'xor', 8, 0x0f, 0xff, 'DF', 0xf0, 'PF SF DF'],
  // INC, DEC: all status flags but CF.
  ['inc ax at 0xFFFF leaves CF clear', 'inc', 16, 0xffff, 0, '', 0x0000, 'PF AF ZF'],
  ['inc ax at 0x7FFF leaves CF set', 'inc', 16, 0x7fff, 0, 'CF', 0x8000, 'CF PF AF SF OF'],
  ['dec ax at 0 leaves CF clear', 'dec', 16, 0x0000, 0, '', 0xffff, 'PF AF SF'],
  ['dec ax at 0x8000 overflows', 'dec', 16, 0x8000, 0, 'CF', 0x7fff, 'CF PF AF OF'],
  ['dec al at 1 sets ZF', 'dec', 8, 0x01, 0, 'CF', 0x00, 'CF PF ZF'],
  ['inc al at 0x7F overflows', 'inc', 8, 0x7f, 0, '', 0x80, 'AF SF OF'],
  ['inc al at 0x0F sets AF', 'inc', 8, 0x0f, 0, '', 0x10, 'AF'],
  ['inc ax at 1 keeps DF', 'inc', 16, 0x0001, 0, 'DF', 0x0002, 'DF'],
  // SHL: CF is the last bit out; count-1 OF is MSB xor CF. Counts are not masked.
  ['shl ax, 1 at 0x8000 sets CF and ZF', 'shl', 16, 0x8000, 1, '', 0x0000, 'CF PF ZF OF'],
  ['shl al, 1 at 0x40: OF is MSB xor CF', 'shl', 8, 0x40, 1, '', 0x80, 'SF OF'],
  ['shl al, 1 at 0xC0: sign unchanged, no OF', 'shl', 8, 0xc0, 1, '', 0x80, 'CF SF'],
  ['shl ax, cl=16 at 1: bit 0 goes out last', 'shl', 16, 0x0001, 16, '', 0x0000, 'CF PF ZF OF'],
  ['shl ax, cl=40 at 0xFFFF: result 0, CF 0', 'shl', 16, 0xffff, 40, 'CF', 0x0000, 'PF ZF'],
  ['shl al, cl=8 at 1', 'shl', 8, 0x01, 8, '', 0x00, 'CF PF ZF OF'],
  ['shl al, cl=9 at 0xFF', 'shl', 8, 0xff, 9, '', 0x00, 'PF ZF'],
  ['shl ax, cl=33 at 1 is not shl ax, 1', 'shl', 16, 0x0001, 33, '', 0x0000, 'PF ZF'],
  ['shl ax, cl=0 changes nothing', 'shl', 16, 0x8000, 0, 'CF AF OF', 0x8000, 'CF AF OF'],
  // SHR: count-1 OF is the original MSB. SAR: OF 0, the sign bit copies in.
  ['shr ax, 1 at 0x8001: OF is the original MSB', 'shr', 16, 0x8001, 1, '', 0x4000, 'CF PF OF'],
  ['shr al, 1 at 1', 'shr', 8, 0x01, 1, '', 0x00, 'CF PF ZF'],
  ['shr ax, cl=15 at 0x8000', 'shr', 16, 0x8000, 15, 'OF', 0x0001, ''],
  ['shr ax, cl=16 at 0x8000: the MSB goes out last', 'shr', 16, 0x8000, 16, '', 0x0000, 'CF PF ZF'],
  ['shr ax, cl=17 at 0xFFFF', 'shr', 16, 0xffff, 17, '', 0x0000, 'PF ZF'],
  ['sar ax, 1 at 0x8000 keeps the sign', 'sar', 16, 0x8000, 1, '', 0xc000, 'PF SF'],
  ['sar al, 1 at 0x81', 'sar', 8, 0x81, 1, '', 0xc0, 'CF PF SF'],
  ['sar ax, cl=40 at 0x8000 fills with the sign', 'sar', 16, 0x8000, 40, '', 0xffff, 'CF PF SF'],
  ['sar ax, cl=40 at 0x7FFF', 'sar', 16, 0x7fff, 40, 'CF', 0x0000, 'PF ZF'],
  ['sar al, cl=7 at 0x80', 'sar', 8, 0x80, 7, '', 0xff, 'PF SF'],
  ['sar ax, 1 at 1 clears OF', 'sar', 16, 0x0001, 1, 'OF', 0x0000, 'CF PF ZF'],
  // Rotates: CF and OF only; ZF SF AF PF unchanged. ROL by 17 is ROL by 1 on a word.
  ['rol ax, 1 at 0x8000 leaves ZF', 'rol', 16, 0x8000, 1, 'ZF', 0x0001, 'CF ZF OF'],
  ['rol al, 1 at 0xC0', 'rol', 8, 0xc0, 1, '', 0x81, 'CF'],
  ['rol ax, cl=17 at 0x8001 rotates by 1', 'rol', 16, 0x8001, 17, '', 0x0003, 'CF OF'],
  ['rol ax, cl=16 at 0x8001: a full turn still sets CF', 'rol', 16, 0x8001, 16, 'OF', 0x8001, 'CF'],
  ['rol al, cl=0 changes nothing', 'rol', 8, 0x5a, 0, 'CF OF', 0x5a, 'CF OF'],
  ['ror ax, 1 at 1', 'ror', 16, 0x0001, 1, '', 0x8000, 'CF OF'],
  ['ror al, 1 at 2 leaves SF', 'ror', 8, 0x02, 1, 'CF SF', 0x01, 'SF'],
  ['ror ax, cl=2 at 3', 'ror', 16, 0x0003, 2, '', 0xc000, 'CF'],
  ['rcl ax, 1 at 0x8000: a zero result leaves ZF', 'rcl', 16, 0x8000, 1, '', 0x0000, 'CF OF'],
  ['rcl al, 1 with CF at 0', 'rcl', 8, 0x00, 1, 'CF', 0x01, ''],
  ['rcl ax, cl=17 with CF at 0x1234: a full turn', 'rcl', 16, 0x1234, 17, 'CF', 0x1234, 'CF OF'],
  ['rcl al, cl=9 at 0x81: a full turn', 'rcl', 8, 0x81, 9, '', 0x81, 'OF'],
  ['rcl al, cl=2 at 0x80', 'rcl', 8, 0x80, 2, '', 0x01, ''],
  ['rcr ax, 1 at 1', 'rcr', 16, 0x0001, 1, '', 0x0000, 'CF'],
  ['rcr ax, 1 with CF at 0', 'rcr', 16, 0x0000, 1, 'CF', 0x8000, 'OF'],
  ['rcr al, cl=9 with CF at 1: a full turn', 'rcr', 8, 0x01, 9, 'CF', 0x01, 'CF'],
  ['rcr al, cl=2 at 1', 'rcr', 8, 0x01, 2, '', 0x80, 'OF'],
]

/**
 * Captures from an 8088 (SingleStepTests 8088 v2, https://github.com/SingleStepTests/8088),
 * register forms, flags cut to the ISA's bits: [instruction, op, size, value, count, flags in,
 * result, flags out, test hash prefix]. Each one pins a value Intel calls undefined and ISA §4
 * leaves open: OF after a count above 1, and AF after SHL, SHR, and SAR.
 */
type Capture = [string, Shift, 8 | 16, number, number, number, number, number, string]
const SILICON: Capture[] = [
  ['shl al, 1', 'shl', 8, 0x002a, 1, 0x0883, 0x0054, 0x0012, 'eb6a1a89b770'],
  ['shl ax, cl', 'shl', 16, 0x51e3, 4, 0x00c7, 0x1e30, 0x0817, '11877326e3aa'],
  ['shl bx, cl', 'shl', 16, 0x36b9, 44, 0x0893, 0x0000, 0x0046, '8deae8e2d8b4'],
  ['shr bl, cl', 'shr', 8, 0x0088, 4, 0x08c3, 0x0008, 0x0003, '58259ef19413'],
  ['sar cx, cl', 'sar', 16, 0xa308, 8, 0x0856, 0xffa3, 0x0086, 'bbd192ddc37d'],
  ['rol cx, cl', 'rol', 16, 0xbf0c, 12, 0x0017, 0xcbf0, 0x0816, '83ea7c055e4b'],
  ['ror ch, cl', 'ror', 8, 0x0017, 6, 0x00c6, 0x005c, 0x08c6, 'db85518b1a8d'],
  ['rcl bp, cl', 'rcl', 16, 0x454d, 18, 0x0402, 0x8a9a, 0x0c02, 'b90c8399e322'],
  ['rcr ch, cl', 'rcr', 8, 0x0071, 6, 0x0493, 0x008d, 0x0c93, 'cd51135777b1'],
  ['shl cx, cl', 'shl', 16, 0x9600, 0, 0x0887, 0x9600, 0x0887, '8cbf461a37a3'],
]

/** PF by counting bits, independent of the module's table. */
function evenParity(r: number): boolean {
  let n = 0
  for (let x = r & 0xff; x !== 0; x >>= 1) n += x & 1
  return n % 2 === 0
}

/** ZF, SF, PF of a `size`-bit result, from their definitions. */
function refSzp(r: number, size: 8 | 16): number {
  const half = size === 8 ? 0x80 : 0x8000
  return (r === 0 ? ZF : 0) | (r >= half ? SF : 0) | (evenParity(r) ? PF : 0)
}

/** Two's complement value of a `size`-bit field. */
function signed(x: number, size: 8 | 16): number {
  const half = size === 8 ? 0x80 : 0x8000
  return x >= half ? x - 2 * half : x
}

/** The status flags of `a + b + c` from integer arithmetic, not bit tricks. */
function refAdd(a: number, b: number, c: number, size: 8 | 16): number {
  const top = size === 8 ? 0x100 : 0x10000
  const sum = a + b + c
  const s = signed(a, size) + signed(b, size) + c
  return (
    (sum >= top ? CF : 0) |
    ((a & 15) + (b & 15) + c > 15 ? AF : 0) |
    refSzp(sum % top, size) |
    (s < -top / 2 || s >= top / 2 ? OF : 0)
  )
}

/** The status flags of `a - b - c` from integer arithmetic. */
function refSub(a: number, b: number, c: number, size: 8 | 16): number {
  const top = size === 8 ? 0x100 : 0x10000
  const s = signed(a, size) - signed(b, size) - c
  return (
    (a < b + c ? CF : 0) |
    ((a & 15) < (b & 15) + c ? AF : 0) |
    refSzp((a - b - c + top) % top, size) |
    (s < -top / 2 || s >= top / 2 ? OF : 0)
  )
}

/**
 * A shift or rotate done the long way, one bit per step, as the 8086 microcode does: CF is
 * the bit out, and OF is set when the step changed the top bit. The shifts then set ZF SF PF
 * from the result, SHL sets AF to bit 4 of it, and SHR and SAR clear AF.
 */
function refShift(
  op: Shift,
  v: number,
  count: number,
  flags: number,
  size: 8 | 16,
): [number, number] {
  if (count === 0) return [v, flags]
  const top = size === 8 ? 0x80 : 0x8000
  const mask = size === 8 ? 0xff : 0xffff
  let x = v
  let cf = flags & CF
  let of = 0
  for (let i = 0; i < count; i++) {
    const msb = x & top ? 1 : 0
    const lsb = x & 1
    const cin = cf
    if (op === 'shl' || op === 'rol' || op === 'rcl') {
      cf = msb
      x = ((x << 1) & mask) | (op === 'rol' ? msb : op === 'rcl' ? cin : 0)
    } else {
      cf = lsb
      const fill = op === 'sar' ? msb : op === 'ror' ? lsb : op === 'rcr' ? cin : 0
      x = (x >> 1) | (fill ? top : 0)
    }
    of = msb ^ (x & top ? 1 : 0)
  }
  let f = (flags & ~(CF | OF)) | cf | (of ? OF : 0)
  if (op === 'shl' || op === 'shr' || op === 'sar') {
    f = (f & ~(ZF | SF | PF | AF)) | refSzp(x, size) | (op === 'shl' ? x & AF : 0)
  }
  return [x, f]
}

/** A deterministic stream of values below `n`. */
function lcg(seed: number, n: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0
    return (s >>> 8) % n
  }
}

const EDGES16 = [
  0x0000, 0x0001, 0x0002, 0x000f, 0x0010, 0x007f, 0x0080, 0x00ff, 0x0100, 0x7ffe, 0x7fff, 0x8000,
  0x8001, 0xfffe, 0xffff, 0x5555, 0xaaaa, 0x0ff0, 0xf00f,
]

/** Sixteen-bit test values: the edges and 400 more from a fixed stream. */
function values16(): number[] {
  const next = lcg(0x8086, 0x10000)
  return [...EDGES16, ...Array.from({ length: 400 }, next)]
}

/** Input FLAGS for shift tests: with and without CF, and with the flags a shift may keep. */
const FLAGS_IN = [FLAGS_INIT, FLAGS_INIT | CF, FLAGS_INIT | FLAGS_WRITABLE, on('DF ZF AF')]

/** Counts for shift tests: every count up to past the rotation widths, and some large ones. */
const COUNTS = [...Array.from({ length: 41 }, (_, i) => i), 63, 64, 128, 255]

describe('flag constants', () => {
  it('sit at the ISA §1 bit positions', () => {
    expect([CF, PF, AF, ZF, SF, DF, OF]).toEqual([0, 2, 4, 6, 7, 10, 11].map((b) => 1 << b))
    expect(STATUS).toBe(0x08d5)
    expect(FLAGS_WRITABLE).toBe(0x0cd5)
    expect(FLAGS_INIT).toBe(0x0002)
  })
})

describe('documented flag cases', () => {
  it('has at least 60 cases', () => {
    expect(DOCUMENTED.length).toBeGreaterThanOrEqual(60)
  })

  for (const [name, op, size, a, b, flagsIn, result, flagsOut] of DOCUMENTED) {
    it(name, () => {
      const [r, f] = apply(op, size, a, b, on(flagsIn))
      expect([r.toString(16), show(f)]).toEqual([result.toString(16), show(on(flagsOut))])
    })
  }
})

describe('8088 silicon captures', () => {
  for (const [name, op, size, value, count, flagsIn, result, flagsOut, hash] of SILICON) {
    it(`${name} (cl=${count}, ${hash})`, () => {
      const [r, f] = apply(op, size, value, count, flagsIn)
      expect([r.toString(16), show(f)]).toEqual([result.toString(16), show(flagsOut)])
    })
  }
})

describe('PF', () => {
  it('is set for even parity of the low byte, for every byte', () => {
    for (let b = 0; b < 256; b++) {
      expect([b, flagsLogic(b, 8) & PF]).toEqual([b, evenParity(b) ? PF : 0])
    }
  })

  it('ignores the high byte of a word', () => {
    for (let b = 0; b < 256; b++) {
      const want = evenParity(b) ? PF : 0
      expect([b, flagsLogic(0x0100 | b, 16) & PF, flagsLogic(0xff00 | b, 16) & PF]).toEqual([
        b,
        want,
        want,
      ])
    }
  })
})

describe('flagsAdd and flagsSub', () => {
  it('match integer arithmetic for every pair of bytes, with and without a carry in', () => {
    const bad: string[] = []
    for (let a = 0; a < 256; a++) {
      for (let b = 0; b < 256; b++) {
        for (const c of [0, 1]) {
          if (flagsAdd(a, b, c, 8) !== refAdd(a, b, c, 8)) bad.push(`add ${a} ${b} ${c}`)
          if (flagsSub(a, b, c, 8) !== refSub(a, b, c, 8)) bad.push(`sub ${a} ${b} ${c}`)
        }
      }
    }
    expect(bad.slice(0, 5)).toEqual([])
  })

  it('match integer arithmetic on words', () => {
    const vs = values16()
    const bad: string[] = []
    for (const a of vs) {
      for (const b of vs) {
        for (const c of [0, 1]) {
          if (flagsAdd(a, b, c, 16) !== refAdd(a, b, c, 16)) bad.push(`add ${a} ${b} ${c}`)
          if (flagsSub(a, b, c, 16) !== refSub(a, b, c, 16)) bad.push(`sub ${a} ${b} ${c}`)
        }
      }
    }
    expect(bad.slice(0, 5)).toEqual([])
  })

  it('return only status flags', () => {
    for (const a of EDGES16) {
      for (const b of EDGES16) {
        expect(flagsAdd(a, b, 1, 16) & ~STATUS).toBe(0)
        expect(flagsSub(a, b, 1, 16) & ~STATUS).toBe(0)
      }
    }
  })

  it('keep the low size bits of each operand', () => {
    expect(flagsAdd(0x10005, -1, 0, 16)).toBe(flagsAdd(5, 0xffff, 0, 16))
    expect(flagsSub(-1, 0x1ff, 0, 8)).toBe(flagsSub(0xff, 0xff, 0, 8))
    expect(flagsAdd(0x17f, 0x201, 0, 8)).toBe(flagsAdd(0x7f, 0x01, 0, 8))
  })
})

describe('flagsLogic', () => {
  it('sets only ZF, SF, PF from the result', () => {
    for (const r of EDGES16) {
      expect(flagsLogic(r, 16)).toBe(refSzp(r, 16))
      expect(flagsLogic(r, 8)).toBe(refSzp(r & 0xff, 8))
    }
  })
})

describe('flagsIncDec', () => {
  it('sets the status flags of a +/- 1 but keeps CF and everything else', () => {
    for (const a of values16()) {
      for (const flags of FLAGS_IN) {
        const keep = flags & ~(STATUS & ~CF)
        expect(flagsIncDec(a, 1, flags, 16)).toBe(keep | (refAdd(a, 1, 0, 16) & ~CF))
        expect(flagsIncDec(a, -1, flags, 16)).toBe(keep | (refSub(a, 1, 0, 16) & ~CF))
        const b = a & 0xff
        expect(flagsIncDec(b, 1, flags, 8)).toBe(keep | (refAdd(b, 1, 0, 8) & ~CF))
        expect(flagsIncDec(b, -1, flags, 8)).toBe(keep | (refSub(b, 1, 0, 8) & ~CF))
      }
    }
  })
})

describe('shifts and rotates', () => {
  const ops = Object.keys(SHIFTS) as Shift[]

  it('match the one-bit-per-step model for every byte, count, and input FLAGS', () => {
    const bad: string[] = []
    for (const op of ops) {
      for (let v = 0; v < 256; v++) {
        for (const count of COUNTS) {
          for (const flags of FLAGS_IN) {
            const out = SHIFTS[op](v, count, flags, 8)
            const [r, f] = refShift(op, v, count, flags, 8)
            if (out !== (r | (f << 16))) bad.push(`${op} ${v} ${count} ${flags}`)
          }
        }
      }
    }
    expect(bad.slice(0, 5)).toEqual([])
  })

  it('match the model on words', () => {
    const vs = values16()
    const bad: string[] = []
    for (const op of ops) {
      for (const v of vs) {
        for (const count of COUNTS) {
          for (const flags of FLAGS_IN) {
            const out = SHIFTS[op](v, count, flags, 16)
            const [r, f] = refShift(op, v, count, flags, 16)
            if (out !== (r | (f << 16))) bad.push(`${op} ${v} ${count} ${flags}`)
          }
        }
      }
    }
    expect(bad.slice(0, 5)).toEqual([])
  })

  it('do not mask the count to 5 bits, as the 80186 does', () => {
    for (const op of ops) {
      for (const v of [0x8001, 0x1234, 0xf00f]) {
        const [r, f] = refShift(op, v, 33, FLAGS_INIT, 16)
        expect([op, SHIFTS[op](v, 33, FLAGS_INIT, 16)]).toEqual([op, r | (f << 16)])
      }
    }
    // A masked count would make these shl by 1 and rcl by 1.
    expect(flagsShl(0x0001, 33, FLAGS_INIT, 16) & 0xffff).toBe(0)
    expect(flagsRcl(0x0001, 34, FLAGS_INIT, 16) & 0xffff).toBe(0x0001)
  })

  it('keep the low size bits of the value, at any count', () => {
    for (const op of ops) {
      for (const count of [0, 3]) {
        const out = [SHIFTS[op](0x1ff81, count, CF, 8), SHIFTS[op](-2, count, CF, 16)]
        expect([op, count, ...out]).toEqual([
          op,
          count,
          SHIFTS[op](0x81, count, CF, 8),
          SHIFTS[op](0xfffe, count, CF, 16),
        ])
      }
    }
  })
})

describe('FLAGS bit 1', () => {
  it('is set in every FLAGS value the helpers build, whatever comes in', () => {
    for (const flags of [0, CF, DF | OF, 0xffff & ~FLAGS_INIT]) {
      expect(flagsIncDec(0x10, 1, flags, 16) & FLAGS_INIT).toBe(FLAGS_INIT)
      expect(flagsIncDec(0x10, -1, flags, 8) & FLAGS_INIT).toBe(FLAGS_INIT)
      for (const fn of Object.values(SHIFTS)) {
        for (const count of [0, 1, 7]) {
          expect(((fn(0x1234, count, flags, 16) >>> 16) & FLAGS_INIT) === FLAGS_INIT).toBe(true)
        }
      }
    }
  })
})
