/**
 * The instruction reference that scripts/gen-opcode-docs.ts writes to the repo's
 * docs/opcodes.json (`bun run opcodes`): an entry per mnemonic and prefix, looked up by any
 * spelling. The hover card and the completions read it.
 */
import docs from '../../../../../../docs/opcodes.json'

export interface OpcodeForm {
  /** `mov r/m16, imm16`. */
  syntax: string
  /** `C7 /0 iw`, in ISA §3 notation. */
  encoding: string
}

/** A line of an example and the bytes it assembles to. */
export interface ExampleLine {
  source: string
  bytes: string
}

export interface MnemonicDoc {
  family: string
  aliases: string[]
  summary: string
  forms: OpcodeForm[]
  /** A character per flag of `FLAG_NAMES`: `-` unchanged, `*` from the result, `0`, `1`. */
  flags: string
  kills: boolean
  example: ExampleLine[]
}

export interface PrefixDoc {
  /** The prefix byte: `F3`. */
  byte: string
  aliases: string[]
  summary: string
  /** The string instructions that take it. */
  takes: string[]
  example: ExampleLine[]
}

interface OpcodeDocs {
  isa: string
  flagNames: string
  mnemonics: Record<string, MnemonicDoc>
  prefixes: Record<string, PrefixDoc>
}

const DOCS: OpcodeDocs = docs

/** The flags of FLAGS in the order a card shows them: `ODITSZAPC`. */
export const FLAG_NAMES = DOCS.flagNames

/** How a card names each family (the ISA §3 sections). */
export const FAMILY_NAMES: Readonly<Record<string, string>> = {
  data: 'data movement',
  arithmetic: 'arithmetic',
  logic: 'logic',
  shift: 'shifts and rotates',
  control: 'control flow',
  string: 'string',
  flags: 'flags and misc',
  process: 'process control',
}

/** A mnemonic's or a prefix's entry, by its canonical name. */
export type OpcodeEntry =
  | { kind: 'mnemonic'; name: string; doc: MnemonicDoc }
  | { kind: 'prefix'; name: string; doc: PrefixDoc }

const BY_SPELLING = new Map<string, OpcodeEntry>()
for (const [name, doc] of Object.entries(DOCS.mnemonics)) {
  for (const spelling of [name, ...doc.aliases]) {
    BY_SPELLING.set(spelling, { kind: 'mnemonic', name, doc })
  }
}
for (const [name, doc] of Object.entries(DOCS.prefixes)) {
  for (const spelling of [name, ...doc.aliases]) {
    BY_SPELLING.set(spelling, { kind: 'prefix', name, doc })
  }
}

/** The entry of a mnemonic or a prefix, by any spelling in any case: `JE` is `jz`'s. */
export function opcodeEntry(word: string): OpcodeEntry | undefined {
  return BY_SPELLING.get(word.toLowerCase())
}

/** Every entry by canonical name, mnemonics first, each in the file's order. */
export function opcodeEntries(): OpcodeEntry[] {
  return [
    ...Object.entries(DOCS.mnemonics).map(
      ([name, doc]): OpcodeEntry => ({ kind: 'mnemonic', name, doc }),
    ),
    ...Object.entries(DOCS.prefixes).map(
      ([name, doc]): OpcodeEntry => ({ kind: 'prefix', name, doc }),
    ),
  ]
}
