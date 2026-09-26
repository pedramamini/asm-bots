/**
 * What the help panel explains (HelpPanel.tsx): an instruction or a prefix, from the reference the
 * hover card reads (`cm/opcodes.ts`), a directive, or a register. Each links to its place in the
 * docs' language reference. The module holds no React.
 */
import { type OpcodeEntry, opcodeEntries, opcodeEntry } from '../cm/opcodes'
import { scanLine } from '../cm/x16c'

/** A directive or a register, as the help panel shows it. */
export interface WordDoc {
  /** How it is written: `%name "Dwarf"`, `ax`. */
  readonly syntax: string
  readonly summary: string
  /** Its section of the reference: `reference/directives#metadata`. */
  readonly page: string
}

export type Topic =
  | { readonly kind: 'opcode'; readonly name: string; readonly entry: OpcodeEntry }
  | { readonly kind: 'directive' | 'register'; readonly name: string; readonly doc: WordDoc }

const META = 'reference/directives#metadata'
const DATA = 'reference/directives#data-and-space'
const CONSTANTS = 'reference/directives#constants-and-macros'

/** The directives, from the reference's page of them. */
const DIRECTIVES: Readonly<Record<string, WordDoc>> = {
  '%name': {
    syntax: '%name "Dwarf"',
    summary: 'The name the arena and the hills show. Required, once.',
    page: META,
  },
  '%author': { syntax: '%author "A. K. Dewdney"', summary: 'Who wrote it.', page: META },
  '%strategy': {
    syntax: '%strategy "Bomb every 4th byte"',
    summary: 'One line on the tactic. The linter warns without it.',
    page: META,
  },
  '%version': { syntax: '%version "1.2"', summary: 'Any text.', page: META },
  db: {
    syntax: 'db 1, 2, "ab", 0',
    summary: 'Bytes. A string gives its bytes, UTF-8.',
    page: DATA,
  },
  dw: { syntax: 'dw 0x1234, $', summary: 'Words, low byte first.', page: DATA },
  resb: {
    syntax: 'resb 16',
    summary: 'Reserves 16 zero bytes. Zeros are DAT: code that runs into them dies.',
    page: DATA,
  },
  resw: { syntax: 'resw 8', summary: 'Reserves 8 zero words, which are DAT.', page: DATA },
  times: {
    syntax: 'times 4 nop',
    summary: 'Repeats an instruction or data line. `$` is the address of each repeat.',
    page: DATA,
  },
  align: {
    syntax: 'align 4',
    summary: 'Pads with 00 (DAT) to a multiple of a power of 2.',
    page: DATA,
  },
  equ: {
    syntax: 'STRIDE equ 4',
    summary: 'A named number, from any constant expression: `SIZE equ end - start`.',
    page: CONSTANTS,
  },
  '%define': {
    syntax: '%define GAP 0x100',
    summary: 'A one-line text macro, no parameters. It applies from its line on.',
    page: CONSTANTS,
  },
  org: {
    syntax: 'org 0',
    summary: 'Accepted; must be 0. Bots are position independent.',
    page: CONSTANTS,
  },
  bits: { syntax: 'bits 16', summary: 'Accepted, and ignored.', page: CONSTANTS },
}

const REGS = 'reference/registers#the-registers'

/** The registers, from the reference's table of them; a half reads as its register. */
const REGISTERS: Readonly<Record<string, WordDoc>> = {
  ax: {
    syntax: 'ax · al ah',
    summary:
      'The accumulator. mul, div, cbw, cwd, lods, stos, and scas use it, and xchg ax, r16 is 1 byte.',
    page: REGS,
  },
  bx: {
    syntax: 'bx · bl bh',
    summary:
      "A base for addressing ([bx+label]). The base idiom keeps the bot's base address here.",
    page: REGS,
  },
  cx: {
    syntax: 'cx · cl ch',
    summary: 'The count. loop, jcxz, and the rep prefixes count it down; cl is the shift count.',
    page: REGS,
  },
  dx: {
    syntax: 'dx · dl dh',
    summary: 'The high half of a mul product and of a div dividend. Free otherwise.',
    page: REGS,
  },
  si: {
    syntax: 'si',
    summary: 'The source of movs, lods, and cmps, and an index for addressing.',
    page: REGS,
  },
  di: {
    syntax: 'di',
    summary: 'The destination of movs, stos, scas, and cmps, and an index for addressing.',
    page: REGS,
  },
  bp: { syntax: 'bp', summary: 'The other base for addressing ([bp+si], [bp+4]).', page: REGS },
  sp: {
    syntax: 'sp',
    summary: 'The stack pointer, the base at the start. push, pop, call, and ret move it.',
    page: REGS,
  },
}

const HALVES: Readonly<Record<string, string>> = {
  al: 'ax',
  ah: 'ax',
  bl: 'bx',
  bh: 'bx',
  cl: 'cx',
  ch: 'cx',
  dl: 'dx',
  dh: 'dx',
}

/** The reference page of each instruction family (scripts/gen-reference.ts). */
const FAMILY_PAGE: Readonly<Record<string, string>> = {
  data: 'data',
  arithmetic: 'arithmetic',
  logic: 'logic',
  shift: 'shifts',
  control: 'control',
  string: 'string',
  flags: 'flag-ops',
  process: 'process',
}

/** The topic of `word`, any case: an instruction, a prefix, a directive, or a register. */
export function topicOf(word: string): Topic | null {
  const lower = word.toLowerCase()
  const entry = opcodeEntry(lower)
  if (entry !== undefined) return { kind: 'opcode', name: entry.name, entry }
  const directive = DIRECTIVES[lower]
  if (directive !== undefined) return { kind: 'directive', name: lower, doc: directive }
  const register = HALVES[lower] ?? lower
  const doc = REGISTERS[register]
  return doc === undefined ? null : { kind: 'register', name: register, doc }
}

/**
 * The topic of the word at offset `at` of a line (or the word it ends), or null: an instruction,
 * a prefix, a directive, or a register, as the editor colors them.
 */
export function topicAtLine(text: string, at: number): Topic | null {
  const tokens = scanLine(text)
  // The word the cursor is in or starts, else the one it ends: `[|di]` is `di`, `mov|` is `mov`.
  const token = tokens.find((t) => t.from <= at && at < t.to) ?? tokens.find((t) => t.to === at)
  if (token === undefined) return null
  if (!['mnemonic', 'prefix', 'directive', 'register'].includes(token.type)) return null
  return topicOf(text.slice(token.from, token.to))
}

/** The docs page that reads more of `topic`: `/docs/reference/data#mov`. */
export function docsHref(topic: Topic): string {
  if (topic.kind !== 'opcode') return `/docs/${topic.doc.page}`
  const page =
    topic.entry.kind === 'prefix' ? 'string' : (FAMILY_PAGE[topic.entry.doc.family] ?? 'data')
  return `/docs/reference/${page}#${topic.name}`
}

/** The topic's one line: what it does. */
export function summaryOf(topic: Topic): string {
  return topic.kind === 'opcode' ? topic.entry.doc.summary : topic.doc.summary
}

/** Every topic, in index order: the instructions and prefixes, the directives, the registers. */
export function allTopics(): Topic[] {
  return [
    ...opcodeEntries().map((entry): Topic => ({ kind: 'opcode', name: entry.name, entry })),
    ...Object.entries(DIRECTIVES).map(([name, doc]): Topic => ({ kind: 'directive', name, doc })),
    ...Object.entries(REGISTERS).map(([name, doc]): Topic => ({ kind: 'register', name, doc })),
  ]
}

/**
 * The topics `query` finds, best first: a name or a spelling that is the query, then one that
 * starts with it, then a summary with every word of it. Empty for an empty query.
 */
export function searchTopics(query: string, topics: readonly Topic[] = allTopics()): Topic[] {
  const q = query.trim().toLowerCase()
  if (q === '') return []
  const spellings = (t: Topic) =>
    t.kind === 'opcode' ? [t.name, ...t.entry.doc.aliases] : [t.name]
  const words = q.split(/\s+/)
  const rank = (t: Topic): number => {
    const names = spellings(t)
    if (names.includes(q)) return 0
    if (names.some((n) => n.startsWith(q))) return 1
    const text = `${names.join(' ')} ${summaryOf(t)}`.toLowerCase()
    return words.every((w) => text.includes(w)) ? 2 : 3
  }
  return topics
    .map((topic, order) => ({ topic, order, rank: rank(topic) }))
    .filter((t) => t.rank < 3)
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .map((t) => t.topic)
}
