/**
 * Decodes a 64 KB random core end to end, 100 times, and prints decodes per second: `decodeInto`
 * as the engine's fetch stage calls it, and `decode` as the disassembler does. No floor is
 * asserted. Run with `bun run bench` in packages/codec.
 */
import { DECODE_UNDEFINED, decode, decodeInto, type Instr, type Reader } from '../src/index'

/** A deterministic stream of bytes. */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0
    return s >>> 24
  }
}

const CORE = Uint8Array.from({ length: 0x10000 }, lcg(0xbe7c))
/** The engine's reader: addresses wrap at 64 KB (ISA §1). */
const read: Reader = (addr) => CORE[addr & 0xffff] as number
const PASSES = 100

const out: Instr = { mnemonic: 'nop', operands: [], length: 1 }

/** One instruction at `addr` through `decodeInto`; returns its length, as the engine steps. */
function viaDecodeInto(addr: number): number {
  const n = decodeInto(read, addr, out)
  if (n > 0) return n
  return n === DECODE_UNDEFINED ? 1 : out.length
}

function viaDecode(addr: number): number {
  return decode(read, addr).length
}

/** Walks the core from 0 to its end `passes` times; returns the instructions decoded. */
function walk(step: (addr: number) => number, passes: number): number {
  let count = 0
  for (let pass = 0; pass < passes; pass++) {
    for (let addr = 0; addr < 0x10000; count++) addr += step(addr)
  }
  return count
}

for (const [name, step] of [
  ['decodeInto', viaDecodeInto],
  ['decode', viaDecode],
] as const) {
  walk(step, 10)
  const start = performance.now()
  const count = walk(step, PASSES)
  const seconds = (performance.now() - start) / 1000
  const rate = `${(count / seconds / 1e6).toFixed(1)} M decodes/s`
  const each = `${(count / PASSES).toLocaleString('en-US')} instructions`
  console.log(`${name.padEnd(10)} ${rate} (${PASSES} passes of ${each}, ${seconds.toFixed(3)} s)`)
}
