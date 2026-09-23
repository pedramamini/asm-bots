/**
 * FLAGS and the flag arithmetic of ISA §4: standard 8086. Where Intel calls a flag undefined
 * and §4 does not pin it (shift OF past count 1, shift AF), the value is the one the 8086
 * silicon produces, checked against hardware captures of an 8088 (the same execution unit).
 * Operands and results are unsigned `size`-bit values. Inputs keep their low `size` bits, so a
 * sign-extended imm8 can be passed as -1.
 */

/** Carry (ISA §1). */
export const CF = 0x0001
/** Parity: set when the low byte of the result has an even number of 1 bits. */
export const PF = 0x0004
/** Auxiliary carry: the carry or borrow out of bit 3. */
export const AF = 0x0010
/** Zero. */
export const ZF = 0x0040
/** Sign: the top bit of the result. */
export const SF = 0x0080
/** Direction: string instructions step SI and DI down when set. */
export const DF = 0x0400
/** Overflow: the signed result does not fit. */
export const OF = 0x0800

/** The six status flags, which the ALU sets: CF PF AF ZF SF OF. */
export const STATUS = CF | PF | AF | ZF | SF | OF

/** The flags POPF can write (ISA §3.1): the status flags and DF. */
export const FLAGS_WRITABLE = STATUS | DF

/**
 * The FLAGS of a new process (ISA §5.5): bit 1 alone. Bit 1 always reads 1 and the undefined
 * bits read 0 (ISA §1). Every FLAGS value built here has bit 1 set, so a read needs no fix-up.
 */
export const FLAGS_INIT = 0x0002

/** INC and DEC set every status flag except CF. */
const INC_DEC = STATUS & ~CF

/** PF for each low byte. */
const PARITY = new Uint8Array(256)
for (let b = 0; b < 256; b++) {
  let x = b ^ (b >> 4)
  x ^= x >> 2
  x ^= x >> 1
  PARITY[b] = x & 1 ? 0 : PF
}

/** ZF, SF, and PF of a `size`-bit result. */
function szp(r: number, size: 8 | 16): number {
  return (r === 0 ? ZF : 0) | ((r >> (size - 8)) & SF) | (PARITY[r & 0xff] as number)
}

/**
 * The status flags of `a + b + carryIn` (ADD, and ADC with `carryIn` = CF). `carryIn` is 0 or 1.
 * The addition sets all six, so the new FLAGS is `(flags & ~STATUS) | flagsAdd(...)`.
 */
export function flagsAdd(a: number, b: number, carryIn: number, size: 8 | 16): number {
  const mask = size === 8 ? 0xff : 0xffff
  const sign = size === 8 ? 0x80 : 0x8000
  const x = a & mask
  const y = b & mask
  const sum = x + y + carryIn
  const r = sum & mask
  return (
    (sum > mask ? CF : 0) |
    ((x ^ y ^ sum) & AF) |
    szp(r, size) |
    ((x ^ r) & (y ^ r) & sign ? OF : 0)
  )
}

/**
 * The status flags of `a - b - borrowIn` (SUB, CMP, CMPS, SCAS, NEG as `0 - b`, and SBB with
 * `borrowIn` = CF). `borrowIn` is 0 or 1. Merge as for `flagsAdd`.
 */
export function flagsSub(a: number, b: number, borrowIn: number, size: 8 | 16): number {
  const mask = size === 8 ? 0xff : 0xffff
  const sign = size === 8 ? 0x80 : 0x8000
  const x = a & mask
  const y = b & mask
  const diff = x - y - borrowIn
  const r = diff & mask
  return (
    (diff < 0 ? CF : 0) | ((x ^ y ^ diff) & AF) | szp(r, size) | ((x ^ y) & (x ^ r) & sign ? OF : 0)
  )
}

/**
 * The status flags of AND, OR, XOR, and TEST given their `result`: CF, OF, and AF clear (AF is
 * undefined on the 8086 and reads 0, ISA §4), ZF SF PF from the result. Merge as for `flagsAdd`.
 */
export function flagsLogic(result: number, size: 8 | 16): number {
  return szp(result & (size === 8 ? 0xff : 0xffff), size)
}

/**
 * The FLAGS after INC (`delta` 1) or DEC (`delta` -1) of `a`: the status flags of `a + 1` or
 * `a - 1`, except that CF keeps its value from `flags`.
 */
export function flagsIncDec(a: number, delta: 1 | -1, flags: number, size: 8 | 16): number {
  const status = delta === 1 ? flagsAdd(a, 1, 0, size) : flagsSub(a, 1, 0, size)
  return (flags & ~INC_DEC) | (status & INC_DEC) | FLAGS_INIT
}

/*
 * Shifts and rotates return both halves of the operation as `result | newFlags << 16`: unpack
 * with `out & 0xffff` and `out >>> 16`. `count` is not masked (the 8086 does not mask it), so
 * any integer count >= 0 acts as that many 1-bit steps. Count 0 changes neither the operand nor
 * any flag. Otherwise CF is the last bit shifted out, and OF is set when the last step changed
 * the top bit. For count 1 that is Intel's rule and ISA §4's: SHL, ROL, and RCL give the
 * result's MSB xor CF; SHR the original MSB; SAR 0; ROR and RCR the result's top two bits
 * xor-ed. For a longer count §4 leaves OF undefined, and the 8086 applies the same rule to its
 * last step. SHL, SHR, and SAR set ZF SF PF from the result; SHL sets AF to bit 4 of the result,
 * and SHR and SAR clear it (the silicon's values; §4 leaves AF open). Rotates change only CF and
 * OF.
 */

/** `(flags & ~defined) | set`, with bit 1 set, packed above `r`. */
function pack(r: number, flags: number, defined: number, set: number): number {
  return r | (((flags & ~defined) | set | FLAGS_INIT) << 16)
}

/** SHL (SAL): shift left, zeros in. */
export function flagsShl(value: number, count: number, flags: number, size: 8 | 16): number {
  const mask = size === 8 ? 0xff : 0xffff
  const v = value & mask
  if (count === 0) return pack(v, flags, 0, 0)
  const r = count < size ? (v << count) & mask : 0
  const cf = count <= size ? (v >> (size - count)) & 1 : 0
  const of = (r >> (size - 1)) ^ cf
  return pack(r, flags, STATUS, cf | (of ? OF : 0) | szp(r, size) | (r & AF))
}

/** SHR: shift right, zeros in. */
export function flagsShr(value: number, count: number, flags: number, size: 8 | 16): number {
  const mask = size === 8 ? 0xff : 0xffff
  const v = value & mask
  if (count === 0) return pack(v, flags, 0, 0)
  const r = count < size ? v >> count : 0
  const cf = count <= size ? (v >> (count - 1)) & 1 : 0
  const of = count === 1 ? v >> (size - 1) : 0
  return pack(r, flags, STATUS, cf | (of ? OF : 0) | szp(r, size))
}

/** SAR: shift right, copies of the sign bit in. */
export function flagsSar(value: number, count: number, flags: number, size: 8 | 16): number {
  const mask = size === 8 ? 0xff : 0xffff
  const v = value & mask
  if (count === 0) return pack(v, flags, 0, 0)
  // Sign-extended to 32 bits, every bit from size - 1 up is the sign, so a clamped shift is exact.
  const s = size === 8 ? (v << 24) >> 24 : (v << 16) >> 16
  const r = (s >> (count < 31 ? count : 31)) & mask
  const cf = (s >> (count <= 31 ? count - 1 : 31)) & 1
  return pack(r, flags, STATUS, cf | szp(r, size))
}

/** ROL: rotate left; the bit out of the top enters bit 0 and CF. */
export function flagsRol(value: number, count: number, flags: number, size: 8 | 16): number {
  const mask = size === 8 ? 0xff : 0xffff
  const v = value & mask
  if (count === 0) return pack(v, flags, 0, 0)
  const n = count & (size - 1)
  const r = n === 0 ? v : ((v << n) | (v >> (size - n))) & mask
  const cf = r & 1
  const of = (r >> (size - 1)) ^ cf
  return pack(r, flags, CF | OF, cf | (of ? OF : 0))
}

/** ROR: rotate right; the bit out of bit 0 enters the top bit and CF. */
export function flagsRor(value: number, count: number, flags: number, size: 8 | 16): number {
  const mask = size === 8 ? 0xff : 0xffff
  const v = value & mask
  if (count === 0) return pack(v, flags, 0, 0)
  const n = count & (size - 1)
  const r = n === 0 ? v : ((v >> n) | (v << (size - n))) & mask
  const cf = r >> (size - 1)
  const of = cf ^ ((r >> (size - 2)) & 1)
  return pack(r, flags, CF | OF, cf | (of ? OF : 0))
}

/** RCL: rotate left through CF, a `size + 1`-bit rotation. */
export function flagsRcl(value: number, count: number, flags: number, size: 8 | 16): number {
  const mask = size === 8 ? 0xff : 0xffff
  const v = value & mask
  if (count === 0) return pack(v, flags, 0, 0)
  const w = size + 1
  const n = count % w
  const x = ((flags & CF) << size) | v
  const y = n === 0 ? x : ((x << n) | (x >> (w - n))) & ((mask << 1) | 1)
  const r = y & mask
  const cf = y >> size
  const of = (r >> (size - 1)) ^ cf
  return pack(r, flags, CF | OF, cf | (of ? OF : 0))
}

/** RCR: rotate right through CF, a `size + 1`-bit rotation. */
export function flagsRcr(value: number, count: number, flags: number, size: 8 | 16): number {
  const mask = size === 8 ? 0xff : 0xffff
  const v = value & mask
  if (count === 0) return pack(v, flags, 0, 0)
  const w = size + 1
  const n = count % w
  const x = ((flags & CF) << size) | v
  const y = n === 0 ? x : ((x >> n) | (x << (w - n))) & ((mask << 1) | 1)
  const r = y & mask
  const cf = y >> size
  const of = ((r >> (size - 1)) ^ (r >> (size - 2))) & 1
  return pack(r, flags, CF | OF, cf | (of ? OF : 0))
}
