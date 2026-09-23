import { describe, expect, it } from 'bun:test'
import type { DeathReason, ExecOutcome } from '../src/index'
import {
  BX,
  Core,
  EXEC_CONTINUE,
  EXEC_KILLED,
  ExecContext,
  execOne,
  Fetcher,
  FLAGS,
  FLAGS_INIT,
  FLAGS_WRITABLE,
  IP,
  Pcg32,
  ProcQueue,
  run,
} from '../src/index'

/** A core, its fetcher, and one process of a bot with owner tag 1. */
class Side {
  readonly core = new Core()
  readonly fetcher = new Fetcher(this.core)
  readonly ctx = new ExecContext()
  readonly queue = new ProcQueue(1)
  readonly row = this.queue.rows[this.queue.push()] as Uint16Array
  readonly bot = { tag: 1, queue: this.queue }

  /** Runs the instruction at IP from the cache, as the battle does. */
  cached(): ExecOutcome {
    const o = this.fetcher.compiled(this.row[IP] as number)
    return run(this.bot, this.row, this.core, this.fetcher.code, o, this.ctx)
  }

  /** Decodes the instruction at IP and runs it. */
  decoded(): ExecOutcome {
    const instr = this.fetcher.fetch(this.row[IP] as number)
    return execOne(this.bot, this.row, this.core, instr, this.ctx)
  }

  /** Stores `bytes` from `a` straight into the core, as a debugger or `restore` might. */
  poke(a: number, bytes: readonly number[]): void {
    bytes.forEach((b, k) => {
      this.core.bytes[(a + k) & 0xffff] = b
    })
  }
}

/** What a run leaves behind, to compare the two sides. */
function state(s: Side, out: ExecOutcome): unknown[] {
  const reason: DeathReason | null = out === EXEC_KILLED ? s.ctx.reason : null
  return [out, reason, Array.from(s.row), s.core.bytes, s.core.owner]
}

/** `mov word [0x1234], 0x5678`: 6 bytes, one of the longest instructions. */
const LONG = [0xc7, 0x06, 0x34, 0x12, 0x78, 0x56]
/** For each byte of LONG, a byte that changes what it does. */
const CHANGED = [0xb8, 0x07, 0x35, 0x13, 0x79, 0x57]

/** An instruction of each length from 1 to 6. */
const LENGTHS: readonly (readonly number[])[] = [
  [0x90], // nop
  [0xeb, 0xfe], // jmp short $
  [0xb8, 0x34, 0x12], // mov ax, 0x1234
  [0x81, 0xc7, 0x00, 0x20], // add di, 0x2000
  [0xc7, 0x40, 0x12, 0x78, 0x56], // mov word [bx+si+0x12], 0x5678
  LONG,
]

/** 0x1000, and every place where an instruction of up to 6 bytes crosses the wrap. */
const BASES = [0x1000, 0xfffa, 0xfffb, 0xfffc, 0xfffd, 0xfffe, 0xffff]

describe('Fetcher.compiled, the cache of compiled instructions', () => {
  it('keeps each entry, decoding nothing, while its own bytes hold', () => {
    for (const code of LENGTHS) {
      for (const base of BASES) {
        const s = new Side()
        s.poke(base, [...code, 0xcc])
        s.poke(0x200, [0xf5]) // cmc, a mnemonic none of LENGTHS has
        const o = s.fetcher.compiled(base)
        expect([code.length, base, s.fetcher.length(o)]).toEqual([code.length, base, code.length])
        s.fetcher.compiled(0x200)
        expect(s.fetcher.instr.mnemonic).toBe('cmc')
        // A byte past the instruction changes; a hit decodes nothing, so `instr` stays the CMC.
        s.poke(base + code.length, [0xcd])
        expect([code.length, base, s.fetcher.compiled(base)]).toEqual([code.length, base, o])
        expect(s.fetcher.instr.mnemonic).toBe('cmc')
      }
    }
  })

  it('sees a store to each byte of an instruction, at every place across the wrap', () => {
    for (const base of BASES) {
      for (let k = 0; k < LONG.length; k++) {
        const a = new Side()
        const b = new Side()
        for (const s of [a, b]) {
          s.poke(base, LONG)
          s.row[BX] = 0x2000
          s.row[FLAGS] = FLAGS_INIT
        }
        // Compile the instruction into a's cache and run it on both sides.
        a.row[IP] = base
        b.row[IP] = base
        expect(state(a, a.cached())).toEqual(state(b, b.decoded()))
        // Change byte k, through the core's write path on even k and straight into the bytes on
        // odd k, then run again from the same place.
        for (const s of [a, b]) {
          const at = (base + k) & 0xffff
          if (k % 2 === 0) s.core.write8(at, CHANGED[k] as number, 0)
          else s.poke(at, [CHANGED[k] as number])
          s.row[IP] = base
        }
        expect([base, k, ...state(a, a.cached())]).toEqual([base, k, ...state(b, b.decoded())])
      }
    }
  })

  it('compiles undefined bytes to a kill that it does not keep', () => {
    const s = new Side()
    s.poke(0x100, [0xf3, 0x90]) // REP on a NOP: undefined (ISA §3.4)
    s.row[IP] = 0x100
    const o = s.fetcher.compiled(0x100)
    expect(s.fetcher.length(o)).toBe(1)
    expect([s.cached(), s.ctx.reason, s.row[IP]]).toEqual([EXEC_KILLED, 'undefined', 0x100])
    s.poke(0x101, [0xab]) // rep stosw, with CX = 0: nothing to do
    expect(s.fetcher.length(s.fetcher.compiled(0x100))).toBe(2)
    expect([s.cached(), s.row[IP]]).toEqual([EXEC_CONTINUE, 0x102])
  })

  it('keeps DAT, HLT, and INT3, which kill each time they run', () => {
    const kills: [number[], DeathReason][] = [
      [[0x00, 0x41], 'dat'],
      [[0xf4], 'hlt'],
      [[0xcc], 'int3'],
    ]
    for (const [bytes, reason] of kills) {
      const s = new Side()
      s.poke(0x100, bytes)
      s.row[IP] = 0x100
      const o = s.fetcher.compiled(0x100)
      expect([s.fetcher.length(o), s.cached(), s.ctx.reason]).toEqual([
        bytes.length,
        EXEC_KILLED,
        reason,
      ])
      s.ctx.reason = 'undefined'
      expect([s.fetcher.compiled(0x100), s.cached(), s.ctx.reason]).toEqual([
        o,
        EXEC_KILLED,
        reason,
      ])
    }
  })

  it('runs as fetch and execOne do while random stores rewrite the code under it', () => {
    // Both sides run random code in a 64-byte window around the wrap. Before each step a random
    // byte of the window may change, so the cache sees instructions change under it at every
    // offset and length, as bombs and self-modifying bots change them.
    const rng = new Pcg32(0xcac4e, 5)
    const a = new Side()
    const b = new Side()
    const WINDOW = 64
    const start = 0x10000 - WINDOW / 2
    const code = Array.from({ length: WINDOW }, () => rng.next() & 0xff)
    a.poke(start, code)
    b.poke(start, code)
    const reset = () => {
      const regs = Array.from({ length: 8 }, () => rng.next() & 0xffff)
      const flags = (rng.next() & FLAGS_WRITABLE) | FLAGS_INIT
      const ip = (start + rng.nextInt(WINDOW)) & 0xffff
      for (const s of [a, b]) {
        s.row.set(regs)
        s.row[FLAGS] = flags
        s.row[IP] = ip
      }
    }
    reset()
    let kills = 0
    for (let step = 0; step < 50_000; step++) {
      if (rng.nextInt(2) === 0) {
        const at = (start + rng.nextInt(WINDOW)) & 0xffff
        const byte = rng.next() & 0xff
        a.poke(at, [byte])
        b.poke(at, [byte])
      }
      const got = a.cached()
      const want = b.decoded()
      expect([step, got, got === EXEC_KILLED ? a.ctx.reason : '']).toEqual([
        step,
        want,
        want === EXEC_KILLED ? b.ctx.reason : '',
      ])
      expect([step, ...a.row]).toEqual([step, ...b.row])
      // Keep running inside the window: restart after a kill or a jump out of it.
      const offset = ((a.row[IP] as number) - start) & 0xffff
      if (got === EXEC_KILLED || offset >= WINDOW) {
        if (got === EXEC_KILLED) kills++
        reset()
      }
    }
    expect(a.core.bytes).toEqual(b.core.bytes)
    expect(a.core.owner).toEqual(b.core.owner)
    expect(kills).toBeGreaterThan(1000)
  })
})
