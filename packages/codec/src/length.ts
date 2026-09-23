import type { Reader } from './decode'
import { DECODE_UNDEFINED, decodeInto } from './decode'
import type { Instr } from './types'

/** `instructionLength` decodes into this and reads only its length. */
const SCRATCH: Instr = { mnemonic: 'nop', operands: [], prefix: undefined, length: 1 }

/**
 * The length of the instruction at `addr` as `decode(read, addr).length` gives it: 1..6, with 1
 * for an undefined byte, 2 for DAT, and 1 for HLT and INT3. It allocates nothing.
 */
export function instructionLength(read: Reader, addr: number): number {
  const n = decodeInto(read, addr, SCRATCH)
  if (n > 0) return n
  // DAT, HLT, and INT3 leave their instruction in SCRATCH; an undefined byte leaves it as it was.
  return n === DECODE_UNDEFINED ? 1 : SCRATCH.length
}
