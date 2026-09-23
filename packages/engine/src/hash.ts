/**
 * Hashes for the determinism contract (ISA §5.6): FNV-1a 64 over a result's canonical JSON and
 * over a battle's event stream. A hash is 16 lowercase hex digits. The arithmetic is exact
 * integer math on uint32 halves, so every runtime computes the same hash.
 */
import type { Result } from './battle'
import type { EventSink } from './events'
import { DEATH_REASONS } from './events'
import type { DeathReason } from './exec'

/** The FNV-1a 64 offset basis `0xCBF29CE484222325`, as uint32 halves. */
const OFFSET_HI = 0xcbf29ce4
const OFFSET_LO = 0x84222325

/** A running FNV-1a 64 hash: the 64-bit state as uint32 halves. */
interface Fnv64 {
  hi: number
  lo: number
}

/**
 * Hashes the low `n` bytes of `v` into `h`, the lowest byte first. For each byte: xor it into the
 * low bits, then multiply by the FNV prime `2^40 + 0x1B3`, mod 2^64. The 2^40 term adds the low
 * half, shifted left 8, to the high half. The `0x1B3` term's carry out of the low half is summed
 * 16 bits at a time. So the math stays in int32, which runs about 3 times faster than a float
 * product here.
 */
function hashBytes(h: Fnv64, v: number, n: number): void {
  let hi = h.hi
  let lo = h.lo
  for (let k = 0; k < 8 * n; k += 8) {
    lo ^= (v >>> k) & 0xff
    const carry = ((lo >>> 16) * 0x1b3 + (((lo & 0xffff) * 0x1b3) >>> 16)) >>> 16
    hi = (Math.imul(hi, 0x1b3) + carry + (lo << 8)) | 0
    lo = Math.imul(lo, 0x1b3)
  }
  h.hi = hi >>> 0
  h.lo = lo >>> 0
}

/** Hashes uint32 `v` into `h` as four bytes, little-endian. */
function hashWord(h: Fnv64, v: number): void {
  hashBytes(h, v, 4)
}

function hex64(h: Fnv64): string {
  return h.hi.toString(16).padStart(8, '0') + h.lo.toString(16).padStart(8, '0')
}

/** The FNV-1a 64 hash of `bytes`. */
export function fnv1a64(bytes: Uint8Array): string {
  const h: Fnv64 = { hi: OFFSET_HI, lo: OFFSET_LO }
  for (let i = 0; i < bytes.length; i++) hashBytes(h, bytes[i] as number, 1)
  return hex64(h)
}

/** `v` as JSON with each object's keys sorted and no whitespace. */
function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`
  if (typeof v === 'object' && v !== null) {
    const o = v as Record<string, unknown>
    const fields = Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    return `{${fields.join(',')}}`
  }
  return JSON.stringify(v)
}

/**
 * The FNV-1a 64 hash of `result` as canonical JSON in UTF-8: each object's keys sorted, no
 * whitespace. The order of the fields in the objects does not change it.
 */
export function resultHash(result: Result): string {
  return fnv1a64(new TextEncoder().encode(canonicalJson(result)))
}

/** Event kind codes: the `EventSink` methods in order. */
const EXEC = 0
const WRITE = 1
const SPAWN = 2
const DEATH = 3
const BOT_DEAD = 4
const CYCLE_END = 5

/**
 * Hashes a battle's events as they come, so a stream of any length takes constant memory. Each
 * event is its kind code (0 `exec`, 1 `write`, 2 `spawn`, 3 `death`, 4 `botDead`, 5 `cycleEnd`)
 * and then its arguments in `EventSink` order, each a uint32 in four little-endian bytes. A death
 * reason is its index in `DEATH_REASONS`. The hash is FNV-1a 64 over those bytes: read it with
 * `eventHash`.
 */
export class HashSink implements EventSink {
  /** The high half of the hash so far. */
  hi = OFFSET_HI
  /** The low half of the hash so far. */
  lo = OFFSET_LO

  exec(cycle: number, bot: number, proc: number, addr: number, len: number): void {
    hashWord(this, EXEC)
    hashWord(this, cycle)
    hashWord(this, bot)
    hashWord(this, proc)
    hashWord(this, addr)
    hashWord(this, len)
  }

  write(cycle: number, bot: number, addr: number, len: number): void {
    hashWord(this, WRITE)
    hashWord(this, cycle)
    hashWord(this, bot)
    hashWord(this, addr)
    hashWord(this, len)
  }

  spawn(cycle: number, bot: number, proc: number, addr: number): void {
    hashWord(this, SPAWN)
    hashWord(this, cycle)
    hashWord(this, bot)
    hashWord(this, proc)
    hashWord(this, addr)
  }

  death(cycle: number, bot: number, proc: number, addr: number, reason: DeathReason): void {
    hashWord(this, DEATH)
    hashWord(this, cycle)
    hashWord(this, bot)
    hashWord(this, proc)
    hashWord(this, addr)
    hashWord(this, DEATH_REASONS.indexOf(reason))
  }

  botDead(cycle: number, bot: number): void {
    hashWord(this, BOT_DEAD)
    hashWord(this, cycle)
    hashWord(this, bot)
  }

  cycleEnd(cycle: number): void {
    hashWord(this, CYCLE_END)
    hashWord(this, cycle)
  }
}

/** The FNV-1a 64 hash of every event `sink` has received. With no events, the offset basis. */
export function eventHash(sink: HashSink): string {
  return hex64(sink)
}
