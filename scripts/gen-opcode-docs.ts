/**
 * `bun run opcodes` writes docs/opcodes.json, the instruction reference that the editor's hover
 * cards and completions read. Per mnemonic: its encoding forms from the codec's `TABLE`, what it
 * does to FLAGS (`FLAGS` below, ISA §4), and the summary and example of
 * packages/codec/docs/notes.json, with the example assembled to its bytes. The prefixes get the
 * same, less the flags. It also writes the docs' language reference, the MDX pages of
 * apps/web/src/docs/generated/reference/ (scripts/gen-reference.ts). `bun run opcodes --check`
 * writes nothing and exits 1 when a file is not what it would write; scripts/gen-opcode-docs.test.ts
 * runs that check in `bun test`, and holds `FLAGS` against the engine.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assemble, formatDiag, formatSource } from '../packages/asm/src/index'
import {
  ALIASES,
  MNEMONICS,
  type Mnemonic,
  type OpcodeRow,
  type OperandTemplate,
  PREFIX_ALIASES,
  PREFIX_BYTE,
  type Prefix,
  TABLE,
} from '../packages/codec/src/index'
import { hasModrm } from '../packages/codec/src/table'

/** The file this writes. */
export const OUT = fileURLToPath(new URL('../docs/opcodes.json', import.meta.url))
/** The hand-written notes it reads. */
export const NOTES = fileURLToPath(new URL('../packages/codec/docs/notes.json', import.meta.url))

/** The ISA sections of the reference: §3.1 and §3.3..§3.6, with §3.2 split in three. */
export type Family =
  | 'data'
  | 'arithmetic'
  | 'logic'
  | 'shift'
  | 'control'
  | 'string'
  | 'flags'
  | 'process'

/** The flags of FLAGS in the order the docs and the debugger show them. */
export const FLAG_NAMES = 'ODITSZAPC'

/** One way to write an instruction: `mov r/m16, imm16` and its bytes, `C7 /0 iw`. */
export interface OpcodeForm {
  syntax: string
  encoding: string
}

/** A line of an example with the bytes it assembles to, as the listing gives them. */
export interface ExampleLine {
  source: string
  bytes: string
}

export interface OpcodeDoc {
  family: Family
  /** Other spellings (`je` for `jz`). */
  aliases: string[]
  summary: string
  forms: OpcodeForm[]
  /** One character per flag of `FLAG_NAMES`: `-` unchanged, `*` from the result, `0`, `1`. */
  flags: string
  /** Running it kills the process (ISA §3.6). */
  kills: boolean
  example: ExampleLine[]
}

export interface PrefixDoc {
  /** The prefix byte, `F3`. */
  byte: string
  aliases: string[]
  summary: string
  /** The string instructions that take it. */
  takes: string[]
  example: ExampleLine[]
}

export interface OpcodeDocs {
  isa: string
  flagNames: string
  mnemonics: Record<string, OpcodeDoc>
  prefixes: Record<string, PrefixDoc>
}

/**
 * A mnemonic's or a prefix's entry in notes.json. `summary` and `example` go to the editor's
 * hover cards and to the reference; the rest is the reference's prose (scripts/gen-reference.ts).
 */
export interface Note {
  summary: string
  /** One to four lines of source; the generator formats them. */
  example: string
  /** What it is for in a bot. */
  use?: string
  /** A common idiom: a few lines of source that assemble. */
  idiom?: string
  /** A trap: what reads one way and runs another. */
  pitfall?: string
  /** Mnemonics and prefixes to cross-link. */
  see?: string[]
}

export interface Notes {
  mnemonics: Record<string, Note>
  prefixes: Record<string, Note>
}

const FAMILY_OF: Record<Family, readonly Mnemonic[]> = {
  data: ['mov', 'lea', 'xchg', 'push', 'pop', 'pushf', 'popf', 'sahf', 'lahf', 'cbw', 'cwd'],
  arithmetic: [
    'add',
    'adc',
    'sub',
    'sbb',
    'cmp',
    'neg',
    'mul',
    'imul',
    'div',
    'idiv',
    'inc',
    'dec',
  ],
  logic: ['and', 'or', 'xor', 'not', 'test'],
  shift: ['rol', 'ror', 'rcl', 'rcr', 'shl', 'shr', 'sar'],
  control: [
    'jmp',
    'call',
    'ret',
    'jo',
    'jno',
    'jc',
    'jnc',
    'jz',
    'jnz',
    'jna',
    'ja',
    'js',
    'jns',
    'jpe',
    'jpo',
    'jl',
    'jnl',
    'jng',
    'jg',
    'loopne',
    'loope',
    'loop',
    'jcxz',
  ],
  string: [
    'movsb',
    'movsw',
    'cmpsb',
    'cmpsw',
    'stosb',
    'stosw',
    'lodsb',
    'lodsw',
    'scasb',
    'scasw',
    'cld',
    'std',
  ],
  flags: ['clc', 'stc', 'cmc', 'nop'],
  process: ['dat', 'spl', 'hlt', 'int3'],
}

/** Each mnemonic's family. */
export const FAMILY: ReadonlyMap<string, Family> = new Map(
  Object.entries(FAMILY_OF).flatMap(([family, ms]) => ms.map((m) => [m, family as Family])),
)

const NONE = '---------'

/**
 * What each mnemonic does to FLAGS (ISA §4), in `FLAG_NAMES` order: `-` unchanged, `*` from the
 * result, `0` cleared, `1` set. Where §4 leaves a flag undefined, the engine's value
 * (packages/engine/src/flags.ts): AND OR XOR TEST clear AF, MUL and IMUL clear SF ZF AF PF, SHL sets
 * AF from the result, SHR and SAR clear it. SHR's result has a 0 top bit, so SF ends 0. A shift or
 * rotate by 0 changes no flag, and DIV and IDIV change none. Mnemonics not listed change none.
 */
export const FLAGS: ReadonlyMap<string, string> = new Map([
  ['popf', '**--*****'],
  ['sahf', '----*****'],
  ...(['add', 'adc', 'sub', 'sbb', 'cmp', 'neg', 'cmpsb', 'cmpsw', 'scasb', 'scasw'] as const).map(
    (m) => [m, '*---*****'] as const,
  ),
  ['mul', '*---0000*'],
  ['imul', '*---0000*'],
  ['inc', '*---****-'],
  ['dec', '*---****-'],
  ...(['and', 'or', 'xor', 'test'] as const).map((m) => [m, '0---**0*0'] as const),
  ['shl', '*---*****'],
  ['shr', '*---0*0**'],
  ['sar', '0---**0**'],
  ...(['rol', 'ror', 'rcl', 'rcr'] as const).map((m) => [m, '*-------*'] as const),
  ['cld', '-0-------'],
  ['std', '-1-------'],
  ['clc', '--------0'],
  ['stc', '--------1'],
  ['cmc', '--------*'],
])

/** How an operand template reads in a form's syntax (ISA §3 notation, registers lowercase). */
const OPERAND_SYNTAX: Record<OperandTemplate, string> = {
  'r/m8': 'r/m8',
  'r/m16': 'r/m16',
  m: 'm',
  r8: 'r8',
  r16: 'r16',
  '+r8': 'r8',
  '+r16': 'r16',
  AL: 'al',
  AX: 'ax',
  CL: 'cl',
  '1': '1',
  imm8: 'imm8',
  imm16: 'imm16',
  moffs8: '[moffs16]',
  moffs16: '[moffs16]',
  rel8: 'rel8',
  rel16: 'rel16',
}

/** The field after the opcode and ModR/M that each template adds to an encoding. */
const TRAILING: Partial<Record<OperandTemplate, string>> = {
  imm8: 'ib',
  imm16: 'iw',
  rel8: 'cb',
  rel16: 'cw',
  moffs8: 'iw',
  moffs16: 'iw',
}

const hex2 = (b: number) => b.toString(16).toUpperCase().padStart(2, '0')

/** A row's bytes in ISA §3 notation: `C7 /0 iw`, `B8+r iw`, `8B /r`, `74 cb`. */
export function encoding(row: OpcodeRow): string {
  const plusR = row.operands.some((t) => t === '+r8' || t === '+r16')
  // A `+r` row's opcode holds its register in the low 3 bits; the notation names the base.
  const parts = [plusR ? `${hex2(row.opcode & ~7)}+r` : hex2(row.opcode)]
  if (row.ext !== undefined) parts.push(`/${row.ext}`)
  else if (hasModrm(row)) parts.push('/r')
  for (const t of row.operands) {
    const field = TRAILING[t]
    if (field !== undefined) parts.push(field)
  }
  return parts.join(' ')
}

/** A row as source: `mov r/m16, imm16`, with `prefix` before it when given. */
export function syntax(row: OpcodeRow, prefix?: Prefix): string {
  const operands = row.operands.map((t) => OPERAND_SYNTAX[t]).join(', ')
  const text = operands === '' ? row.mnemonic : `${row.mnemonic} ${operands}`
  return prefix === undefined ? text : `${prefix} ${text}`
}

/** A form and the first table row it stands for (a `+r` form stands for 8), with its prefix. */
export interface FormRow {
  form: OpcodeForm
  row: OpcodeRow
  prefix?: Prefix | undefined
}

/** The distinct forms of a mnemonic in table order, each prefix form after the plain one. */
export function formRows(mnemonic: Mnemonic): FormRow[] {
  const out: FormRow[] = []
  const seen = new Set<string>()
  const add = (form: OpcodeForm, row: OpcodeRow, prefix?: Prefix) => {
    const key = `${form.syntax}|${form.encoding}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ form, row, prefix })
  }
  for (const row of TABLE) {
    if (row.mnemonic !== mnemonic) continue
    add({ syntax: syntax(row), encoding: encoding(row) }, row)
    for (const prefix of row.prefixes ?? []) {
      const form = {
        syntax: syntax(row, prefix),
        encoding: `${hex2(PREFIX_BYTE[prefix])} ${encoding(row)}`,
      }
      add(form, row, prefix)
    }
  }
  return out
}

const forms = (mnemonic: Mnemonic): OpcodeForm[] => formRows(mnemonic).map(({ form }) => form)

/**
 * The example of `what` in the formatter's layout, a line each with its bytes. Blank lines go, and
 * so does the indent every line shares. Throws when the example does not assemble.
 */
export function example(source: string, what: string): ExampleLine[] {
  // The note as written first, so that an error's line and column are the note's.
  const errors = assemble(`${source}\n%name "example"`).diagnostics.map((d) => formatDiag(d))
  if (errors.length > 0) {
    throw new Error(`the example of ${what} does not assemble:\n  ${errors.join('\n  ')}`)
  }
  const bot = assemble(`%name "example"\n${formatSource(source)}`)
  const lines = bot.listing.slice(1).filter((l) => l.source.trim() !== '')
  const indent = Math.min(...lines.map((l) => l.source.length - l.source.trimStart().length))
  return lines.map((l) => ({ source: l.source.slice(indent).trimEnd(), bytes: l.bytesHex }))
}

/** The note of `what`, or an error that names the file to fix. */
function noteOf(notes: Record<string, Note>, what: string): Note {
  const note = notes[what]
  if (note === undefined || note.summary.trim() === '' || note.example.trim() === '') {
    throw new Error(`${relative(process.cwd(), NOTES)}: \`${what}\` needs a summary and an example`)
  }
  return note
}

/** The whole reference, from the table and `notes`. */
export function generate(notes: Notes): OpcodeDocs {
  const aliases = (m: string, from: ReadonlyMap<string, string>) =>
    [...from].filter(([, canonical]) => canonical === m).map(([alias]) => alias)
  const mnemonics: Record<string, OpcodeDoc> = {}
  for (const m of MNEMONICS) {
    const family = FAMILY.get(m)
    if (family === undefined) throw new Error(`\`${m}\` has no family in FAMILY_OF`)
    const note = noteOf(notes.mnemonics, m)
    mnemonics[m] = {
      family,
      aliases: aliases(m, ALIASES),
      summary: note.summary,
      forms: forms(m),
      flags: FLAGS.get(m) ?? NONE,
      kills: TABLE.some((r) => r.mnemonic === m && r.kills === true),
      example: example(note.example, m),
    }
  }
  const prefixes: Record<string, PrefixDoc> = {}
  for (const [prefix, byte] of Object.entries(PREFIX_BYTE) as [Prefix, number][]) {
    const note = noteOf(notes.prefixes, prefix)
    prefixes[prefix] = {
      byte: hex2(byte),
      aliases: aliases(prefix, PREFIX_ALIASES),
      summary: note.summary,
      takes: TABLE.filter((r) => r.prefixes?.includes(prefix)).map((r) => r.mnemonic),
      example: example(note.example, prefix),
    }
  }
  for (const what of Object.keys(notes.mnemonics)) {
    if (mnemonics[what] === undefined) throw new Error(`notes.json: \`${what}\` is not a mnemonic`)
  }
  for (const what of Object.keys(notes.prefixes)) {
    if (prefixes[what] === undefined) throw new Error(`notes.json: \`${what}\` is not a prefix`)
  }
  return { isa: 'x16c v1', flagNames: FLAG_NAMES, mnemonics, prefixes }
}

/** The file's text: `generate` of the notes on disk, as JSON. */
export function render(notes: Notes = JSON.parse(readFileSync(NOTES, 'utf8'))): string {
  return `${JSON.stringify(generate(notes), null, 2)}\n`
}

if (import.meta.main) {
  // The reference imports this module: loaded here, it finds this module's exports defined.
  const { REFERENCE_DIR, referenceFiles, staleFiles } = await import('./gen-reference')
  const check = process.argv.includes('--check')
  const notes: Notes = JSON.parse(readFileSync(NOTES, 'utf8'))
  const files = new Map([[OUT, render(notes)], ...referenceFiles(notes)])
  const shown = relative(process.cwd(), OUT)
  const dir = relative(process.cwd(), REFERENCE_DIR)
  if (check) {
    const old = [...files].filter(([path, text]) => {
      try {
        return readFileSync(path, 'utf8') !== text
      } catch {
        return true
      }
    })
    const stale = staleFiles(files)
    for (const [path] of old) console.error(`${relative(process.cwd(), path)} is out of date`)
    for (const path of stale) console.error(`${relative(process.cwd(), path)} is not generated`)
    if (old.length > 0 || stale.length > 0) {
      console.error('run `bun run opcodes`')
      process.exit(1)
    }
    console.log(`${shown} and ${dir} are up to date`)
  } else {
    mkdirSync(REFERENCE_DIR, { recursive: true })
    for (const path of staleFiles(files)) rmSync(path)
    for (const [path, text] of files) writeFileSync(path, text)
    console.log(
      `wrote ${shown}: ${MNEMONICS.length} mnemonics, and ${files.size - 1} files in ${dir}`,
    )
  }
}
