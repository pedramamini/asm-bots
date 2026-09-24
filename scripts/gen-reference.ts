/**
 * The docs' language reference (PRODUCT_SPEC §7.3), which `bun run opcodes` writes with
 * docs/opcodes.json: MDX pages in apps/web/src/docs/generated/reference/, and `nav.ts`, the
 * sidebar section that lists them. A page per instruction family, each instruction with its forms
 * (syntax, bytes, and an example the assembler turns into those bytes), flags, cycles, an example,
 * and the prose of packages/codec/docs/notes.json: what it is for in a bot, an idiom, a pitfall,
 * and cross-links. Then registers, flags, the memory model, ModR/M addressing, directives,
 * expressions, diagnostics, and the divergences from the 8086.
 *
 * Every table and code block is checked as it is written: each piece of source assembles, each
 * form's example assembles to that form's opcode, and each value and message on a page is the
 * one the assembler gives. A page that would say something false throws instead.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  type Assembled,
  assemble,
  DIAG_CODES,
  formatDiag,
  formatSource,
  lint,
  MAX_BOT_BYTES,
} from '../packages/asm/src/index'
import {
  type OpcodeRow,
  type OperandTemplate,
  PREFIX_BYTE,
  type Prefix,
  REG8_NAMES,
  REG16_NAMES,
} from '../packages/codec/src/index'
import { DEFAULT_CONFIG } from '../packages/engine/src/index'
import {
  type ExampleLine,
  FAMILY,
  type Family,
  FLAG_NAMES,
  FLAGS,
  type FormRow,
  formRows,
  generate,
  type Note,
  type Notes,
  type OpcodeDoc,
  type OpcodeDocs,
} from './gen-opcode-docs'

/** The folder this writes. */
export const REFERENCE_DIR = fileURLToPath(
  new URL('../apps/web/src/docs/generated/reference/', import.meta.url),
)
/** The assembler's README, whose tables of codes and dialect the diagnostics pages draw from. */
const ASM_README = fileURLToPath(new URL('../packages/asm/README.md', import.meta.url))

/** A page of the reference: `name` is its file, and its slug is `reference/<name>`. */
export interface ReferencePage {
  name: string
  /** Lowercase, as the sidebar shows it. */
  title: string
  /** One sentence for the contents page. */
  blurb: string
  mdx: string
}

// Markdown helpers.

const hex2 = (b: number) => b.toString(16).toUpperCase().padStart(2, '0')
const hex = (bytes: ArrayLike<number>) => Array.from(bytes, hex2).join(' ')
const hex4 = (n: number) => `0x${n.toString(16).toUpperCase().padStart(4, '0')}`

/** Prose for MDX: outside code spans, `{ } < >` would start JSX, so they become references. */
export function prose(text: string): string {
  return text
    .split(/(`[^`]*`)/)
    .map((part, at) =>
      at % 2 === 1 ? part : part.replace(/[{}<>]/g, (c) => `&#${c.charCodeAt(0)};`),
    )
    .join('')
}

/** A table cell: prose with its pipes escaped (GFM splits cells on `|`, even in code). */
const cell = (text: string) => prose(text).replace(/\|/g, '\\|')

/** A GFM table. */
function table(head: readonly string[], rows: readonly (readonly string[])[]): string {
  return [
    `| ${head.join(' | ')} |`,
    `|${head.map(() => '---').join('|')}|`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n')
}

/** A sentence from a notes summary: a capital first, a period last. */
const sentence = (text: string) =>
  `${text.charAt(0).toUpperCase()}${text.slice(1)}${/[.!?]$/.test(text) ? '' : '.'}`

const code = (text: string) => `\`${text}\``

/**
 * `source` assembled as a piece of a bot (a `%name` added when it has none), or an error that
 * names `what`: every code block and example of the reference goes through here.
 */
function assembled(source: string, what: string): Assembled {
  const text = /^\s*%name\b/m.test(source) ? source : `${source}\n%name "reference"`
  const bot = assemble(text)
  const errors = bot.diagnostics.filter((d) => d.severity === 'error')
  if (errors.length > 0) {
    throw new Error(
      `${what}: \`${source}\` does not assemble:\n  ${errors.map((d) => formatDiag(d)).join('\n  ')}`,
    )
  }
  return bot
}

/** A piece of a bot as a code block: `copy` only (it has no `%name`), checked to assemble. */
function fragment(source: string, what: string): string {
  assembled(source, what)
  return ['```asm fragment', formatSource(source).trimEnd(), '```'].join('\n')
}

/** A whole bot as a code block, with `open in editor` and `open in arena` against `vs`. */
function botBlock(source: string, vs: string, what: string): string {
  const text = formatSource(source).trimEnd()
  const bot = assembled(text, what)
  const warnings = lint(text, bot)
  if (warnings.length > 0) {
    throw new Error(`${what}: lint: ${warnings.map((d) => formatDiag(d)).join('; ')}`)
  }
  return [`\`\`\`asm run="vs=${vs}"`, text, '```'].join('\n')
}

/** Inline source, checked to assemble: `` `mov ax, 1` ``. */
const inline = (source: string, what: string) => {
  assembled(source, what)
  return code(source)
}

/** The bytes a line of source assembles to. */
const bytesOf = (source: string, what: string) => hex(assembled(source, what).bytes)

/** An example's lines, each with its bytes in a comment, in the formatter's layout. */
function listing(lines: readonly ExampleLine[]): string {
  const source = lines
    .map(({ source, bytes }) => (bytes === '' ? source : `${source} ; ${bytes}`))
    .join('\n')
  return formatSource(source).trimEnd()
}

// The instruction pages.

const FAMILY_PAGE: Readonly<Record<Family, { name: string; title: string; blurb: string }>> = {
  data: {
    name: 'data',
    title: 'data movement',
    blurb: 'mov, lea, xchg, the stack, and the flag loads.',
  },
  arithmetic: {
    name: 'arithmetic',
    title: 'arithmetic',
    blurb: 'add, subtract, compare, multiply, divide, and count.',
  },
  logic: { name: 'logic', title: 'logic', blurb: 'and, or, xor, not, and test.' },
  shift: {
    name: 'shifts',
    title: 'shifts and rotates',
    blurb: 'shifts and rotates, by 1 or by cl.',
  },
  control: {
    name: 'control',
    title: 'control flow',
    blurb: 'jumps, conditions, calls, and loops.',
  },
  string: {
    name: 'string',
    title: 'string instructions',
    blurb: 'block copies, fills, and scans, and the rep prefixes.',
  },
  flags: { name: 'flag-ops', title: 'flag instructions', blurb: 'clc, stc, cmc, and nop.' },
  process: {
    name: 'process',
    title: 'process control',
    blurb: 'dat, spl, hlt, and int3: the asm bots additions.',
  },
}

/** The page a mnemonic or prefix is on, and its anchor there. */
function href(what: string): string {
  const family = FAMILY.get(what) ?? (what in PREFIX_BYTE ? 'string' : undefined)
  if (family === undefined) throw new Error(`notes.json: nothing to link for \`${what}\``)
  return `/docs/reference/${FAMILY_PAGE[family].name}#${what}`
}

/** A link to a mnemonic's or prefix's entry: `` [`add`](/docs/reference/arithmetic#add) ``. */
export const link = (what: string) => `[${code(what)}](${href(what)})`

/** Mnemonics whose `r/m16` example is a register: they go to the address it holds. */
const REGISTER_RM: ReadonlySet<string> = new Set(['jmp', 'call', 'spl'])

/** Templates that are a register of the data size, so a memory operand needs no size word. */
const SIZED: ReadonlySet<OperandTemplate> = new Set(['r8', 'r16', '+r8', '+r16', 'AL', 'AX'])

/**
 * Source for one form: `mov word [di], 0x1234` for `mov r/m16, imm16`. Each value is picked so
 * that the assembler takes this form and no shorter one (0x1234 does not fit a sign-extended
 * byte; a memory operand is not the `A0..A3` or `+r` forms).
 */
function formSource(row: OpcodeRow, prefix?: Prefix): string {
  if (prefix !== undefined) return `${prefix} ${row.mnemonic}`
  const sized = row.operands.some((t) => SIZED.has(t))
  const register = REGISTER_RM.has(row.mnemonic)
  const example: Record<OperandTemplate, string> = {
    'r/m8': register ? 'dl' : `${sized ? '' : 'byte '}[bx+4]`,
    'r/m16': register ? 'dx' : `${sized ? '' : 'word '}[di]`,
    m: '[bx+di-2]',
    r8: 'dl',
    r16: 'dx',
    '+r8': 'bl',
    '+r16': 'si',
    AL: 'al',
    AX: 'ax',
    CL: 'cl',
    '1': '1',
    imm8: row.mnemonic === 'dat' ? '7' : row.signExtend ? '4' : '0x41',
    imm16: row.mnemonic === 'ret' ? '2' : '0x1234',
    moffs8: '[0x0100]',
    moffs16: '[0x0100]',
    rel8: '$+0x10',
    rel16: '$+0x300',
  }
  const operands = row.operands.map((t) => example[t])
  return operands.length === 0 ? row.mnemonic : `${row.mnemonic} ${operands.join(', ')}`
}

/** A form's example and its bytes, checked to be that form: its prefix, opcode, and `/n`. */
function formExample({ form, row, prefix }: FormRow): { source: string; bytes: string } {
  const source = formSource(row, prefix)
  const bytes = assembled(source, form.syntax).bytes
  const at = prefix === undefined ? 0 : 1
  const plusR = row.operands.some((t) => t === '+r8' || t === '+r16')
  const opcode = bytes[at] ?? -1
  const ok =
    (prefix === undefined || bytes[0] === PREFIX_BYTE[prefix]) &&
    (plusR ? (opcode & 0xf8) === (row.opcode & 0xf8) : opcode === row.opcode) &&
    (row.ext === undefined || (((bytes[at + 1] ?? 0) >> 3) & 7) === row.ext)
  if (!ok) {
    throw new Error(`\`${source}\` assembles to ${hex(bytes)}, not the form ${form.encoding}`)
  }
  return { source, bytes: hex(bytes) }
}

/** A mnemonic's or prefix's prose, or an error that names the field to write. */
function prose4(notes: Record<string, Note>, what: string) {
  const note = notes[what]
  const missing = (['use', 'idiom', 'pitfall'] as const).filter(
    (k) => (note?.[k] ?? '').trim() === '',
  )
  if (note === undefined || missing.length > 0 || (note.see ?? []).length === 0) {
    throw new Error(
      `packages/codec/docs/notes.json: \`${what}\` needs ${[...missing, 'see'].join(', ')}`,
    )
  }
  for (const other of note.see ?? []) {
    if (other === what) throw new Error(`notes.json: \`${what}\` sees itself`)
    href(other)
  }
  return note as Note & { use: string; idiom: string; pitfall: string; see: string[] }
}

const DEATH: Readonly<Record<string, string>> = { dat: 'dat', hlt: 'hlt', int3: 'int3' }

/** The line that says what an instruction costs, and how it can kill. */
function cycles(mnemonic: string, doc: OpcodeDoc): string {
  if (doc.kills) {
    return `**Cycles:** 1, and the process dies, with reason ${code(DEATH[mnemonic] ?? mnemonic)}.`
  }
  if (mnemonic === 'div' || mnemonic === 'idiv') {
    return '**Cycles:** 1. A 0 divisor, or a quotient that does not fit, kills the process with reason `div`.'
  }
  if (doc.forms.some((f) => /^rep/.test(f.syntax))) {
    return '**Cycles:** 1; under a prefix, 1 per iteration.'
  }
  return '**Cycles:** 1.'
}

/** The parts every entry shares after its forms: the example, use, idiom, pitfall, and links. */
function entryProse(
  what: string,
  example: readonly ExampleLine[],
  note: ReturnType<typeof prose4>,
) {
  return [
    `**In a bot:** ${prose(note.use)}`,
    ['```asm fragment', listing(example), '```'].join('\n'),
    '**Idiom:**',
    fragment(note.idiom, `the idiom of ${what}`),
    ['<Warn>', '', prose(note.pitfall), '', '</Warn>'].join('\n'),
    `**See also:** ${note.see.map(link).join(' · ')}`,
  ]
}

const alsoWritten = (aliases: readonly string[]) =>
  aliases.length === 0 ? [] : [`Also written ${aliases.map(code).join(', ')}.`]

function mnemonicEntry(m: string, doc: OpcodeDoc, notes: Notes): string {
  const note = prose4(notes.mnemonics, m)
  const rows = formRows(m as never).map((fr) => {
    const ex = formExample(fr)
    return [code(fr.form.syntax), code(fr.form.encoding), cell(code(ex.source)), code(ex.bytes)]
  })
  return [
    `## ${m}`,
    prose(sentence(doc.summary)),
    ...alsoWritten(doc.aliases),
    table(['form', 'encoding', 'example', 'bytes'], rows),
    doc.flags === '---------' ? '**Flags:** none change.' : `<Flags op="${m}" />`,
    cycles(m, doc),
    ...entryProse(m, doc.example, note),
  ].join('\n\n')
}

function prefixEntry(p: string, docs: OpcodeDocs, notes: Notes): string {
  const doc = docs.prefixes[p]
  if (doc === undefined) throw new Error(`no prefix ${p}`)
  const note = prose4(notes.prefixes, p)
  return [
    `## ${p}`,
    prose(sentence(doc.summary)),
    ...alsoWritten(doc.aliases),
    table(
      ['prefix', 'byte', 'takes'],
      [[code(p), code(doc.byte), [...new Set(doc.takes)].map(link).join(', ')]],
    ),
    '**Flags:** the prefix changes none; the string instruction sets its own.',
    '**Cycles:** 1 per iteration. With cx = 0, 1 cycle and no iteration.',
    ...entryProse(p, doc.example, note),
  ].join('\n\n')
}

/** The conditions of ISA §3.3: what each jump tests, and what it means after `cmp a, b`. */
const CONDITIONS: readonly (readonly [string, string, string])[] = [
  ['jo', 'OF = 1', 'signed overflow'],
  ['jno', 'OF = 0', 'no signed overflow'],
  ['jc', 'CF = 1', 'a < b, unsigned'],
  ['jnc', 'CF = 0', 'a >= b, unsigned'],
  ['jz', 'ZF = 1', 'a = b'],
  ['jnz', 'ZF = 0', 'a ≠ b'],
  ['jna', 'CF = 1 or ZF = 1', 'a <= b, unsigned'],
  ['ja', 'CF = 0 and ZF = 0', 'a > b, unsigned'],
  ['js', 'SF = 1', 'a - b is negative'],
  ['jns', 'SF = 0', 'a - b is 0 or positive'],
  ['jpe', 'PF = 1', 'the low byte of a - b has an even count of 1 bits'],
  ['jpo', 'PF = 0', 'the low byte of a - b has an odd count of 1 bits'],
  ['jl', 'SF ≠ OF', 'a < b, signed'],
  ['jnl', 'SF = OF', 'a >= b, signed'],
  ['jng', 'ZF = 1 or SF ≠ OF', 'a <= b, signed'],
  ['jg', 'ZF = 0 and SF = OF', 'a > b, signed'],
  ['loopne', 'cx ≠ 0 and ZF = 0, after cx -= 1', '(a counted search)'],
  ['loope', 'cx ≠ 0 and ZF = 1, after cx -= 1', '(a counted skip)'],
  ['loop', 'cx ≠ 0, after cx -= 1', '(a counted loop)'],
  ['jcxz', 'cx = 0', '(a loop guard)'],
]

/** Each family page's words before its entries. */
function familyIntro(family: Family, docs: OpcodeDocs): string[] {
  switch (family) {
    case 'data':
      return [
        "These instructions move bytes and words between registers, memory, and the stack. None changes a flag, except `popf` and `sahf`, which load them. Every write to memory marks the bytes as the writer's in the [ownership map](/docs/reference/memory#ownership).",
      ]
    case 'arithmetic':
      return [
        'Integer math on bytes and words. Every result wraps: a word to 16 bits, a byte to 8. `add`, `adc`, `sub`, `sbb`, `cmp`, and `neg` set all six status flags; `inc` and `dec` set all but CF. `div` and `idiv` kill the process on a 0 divisor or a quotient that does not fit.',
        '`add byte [mem], reg` does not exist here: its opcode, `00`, is DAT (see [8086 divergences](/docs/reference/divergences)).',
      ]
    case 'logic':
      return [
        'Bitwise operations on bytes and words. `and`, `or`, `xor`, and `test` set CF, OF, and AF to 0 and ZF, SF, and PF from the result. `not` changes no flag.',
      ]
    case 'shift':
      return [
        'Shifts and rotates by 1 or by cl, the only counts the 8086 takes. The count is not masked: a count of 40 in cl shifts 40 times, in one cycle like any instruction. Shifts set ZF, SF, and PF from the result; rotates change only CF and OF. A count of 0 changes no flag.',
      ]
    case 'control':
      return [
        '`jmp`, `call`, `loop`, and the conditional jumps take a target relative to the next instruction, so they work wherever the loader puts the bot. `jmp` and `call` with a register or memory operand go to the absolute address it holds.',
        'The conditional jumps, the `loop` forms, and `jcxz` are rel8 only: -128..+127 bytes from the next instruction. The assembler does not stretch them; a target out of reach is the error `jump-out-of-range`. For a far target, invert the condition and jump over a `jmp`:',
        fragment(
          'cmp ax, 0\njnz skip            ; jz target, out of reach\njmp target\nskip: times 200 nop\ntarget: nop',
          'the far jump',
        ),
        '## Conditions',
        'What each jump tests, and what it means after `cmp a, b`:',
        table(
          ['jump', 'also written', 'jumps when', 'after `cmp a, b`'],
          CONDITIONS.map(([m, flags, meaning]) => [
            link(m),
            (docs.mnemonics[m]?.aliases ?? []).map(code).join(', '),
            cell(flags),
            cell(meaning),
          ]),
        ),
      ]
    case 'string':
      return [
        'Block copies, fills, loads, and scans. Each uses si as the source and di as the destination, and steps them after it runs: by 1 for a byte and 2 for a word, up when DF = 0 and down when DF = 1. DF starts at 0.',
        'A prefix repeats an instruction, one iteration a cycle. After each iteration, while cx is not 0 (and, for `repe` and `repne`, while ZF says so), ip stays on the prefix, and the process runs the next iteration on its next turn. So `rep movsw` is not a free 64 KB copy, and an enemy can bomb a copy while it runs.',
      ]
    case 'flags':
      return [
        'Set, clear, or flip CF, and do nothing. DF has its own pair, [`cld`](/docs/reference/string#cld) and [`std`](/docs/reference/string#std), with the string instructions. The [flags](/docs/reference/flags) page says which instruction changes which flag.',
      ]
    case 'process':
      return [
        'The ASM Bots additions (ISA §3.6). On an 8086, `00` is `add r/m8, r8`, `60`..`62` are undefined, and `F4` and `CC` stop or trap; here they kill the process or start a new one (see [8086 divergences](/docs/reference/divergences)).',
        'A process dies with a reason, which the arena and the debugger show: `dat`, `hlt`, and `int3` for these instructions, `undefined` for any other opcode not in the table, and `div` for a bad divide.',
      ]
  }
}

function familyPage(family: Family, docs: OpcodeDocs, notes: Notes): ReferencePage {
  const { name, title, blurb } = FAMILY_PAGE[family]
  const mnemonics = [...FAMILY].filter(([, f]) => f === family).map(([m]) => m)
  const entries = mnemonics.map((m) => {
    const doc = docs.mnemonics[m]
    if (doc === undefined) throw new Error(`no mnemonic ${m}`)
    return mnemonicEntry(m, doc, notes)
  })
  if (family === 'string') {
    entries.push(...Object.keys(docs.prefixes).map((p) => prefixEntry(p, docs, notes)))
  }
  const intro = familyIntro(family, docs)
  // An intro that has sections of its own ends with them, after the list of the instructions.
  const split = intro.findIndex((block) => block.startsWith('## '))
  const before = split < 0 ? intro : intro.slice(0, split)
  const after = split < 0 ? [] : intro.slice(split)
  const list = `On this page: ${[
    ...mnemonics,
    ...(family === 'string' ? Object.keys(docs.prefixes) : []),
  ]
    .map(link)
    .join(' · ')}.`
  return {
    name,
    title,
    blurb,
    mdx: [`# ${sentence(title).slice(0, -1)}`, ...before, list, ...after, ...entries].join('\n\n'),
  }
}

// The machine pages.

const REG_ROLE: Readonly<Record<string, string>> = {
  ax: 'The accumulator. `mul`, `div`, `cbw`, `cwd`, `lods`, `stos`, and `scas` use it, and `xchg ax, r16` is 1 byte.',
  cx: 'The count. `loop`, `jcxz`, and the `rep` prefixes count it down, and cl is the shift count.',
  dx: 'The high half of a `mul` product and of a `div` dividend. Free otherwise.',
  bx: "A base for addressing (`[bx+label]`). The base idiom keeps the bot's base address here.",
  sp: 'The stack pointer. `push`, `pop`, `call`, and `ret` move it.',
  bp: 'The other base for addressing (`[bp+si]`, `[bp+4]`).',
  si: 'The source of `movs`, `lods`, and `cmps`, and an index for addressing.',
  di: 'The destination of `movs`, `stos`, `scas`, and `cmps`, and an index for addressing.',
}

const START: Readonly<Record<string, string>> = { sp: 'the base', ip: 'the base', flags: '0x0002' }

function registersPage(): ReferencePage {
  const halves = (r: string) =>
    ['ax', 'bx', 'cx', 'dx'].includes(r) ? `${code(`${r[0]}l`)}, ${code(`${r[0]}h`)}` : ''
  const order = ['ax', 'bx', 'cx', 'dx', 'si', 'di', 'bp', 'sp']
  const rows = [
    ...order.map((r) => [code(r), halves(r), START[r] ?? '0', cell(REG_ROLE[r] ?? '')]),
    [
      code('ip'),
      '',
      'the base',
      'The address of the next instruction. No instruction names it: jumps, calls, `ret`, and `loop` change it, and a `rep` holds it on the prefix.',
    ],
    ['FLAGS', '', code('0x0002'), 'The status flags and DF: see [flags](/docs/reference/flags).'],
  ]
  const codes = REG16_NAMES.map((r16, n) => [
    code(String(n)),
    code(n.toString(2).padStart(3, '0')),
    code(r16),
    code(REG8_NAMES[n] as string),
  ])
  return {
    name: 'registers',
    title: 'registers',
    blurb: 'the eight general registers, ip, and FLAGS: what each is for.',
    mdx: [
      '# Registers',
      'Each process has its own registers: eight 16-bit general registers, ip, and FLAGS (ISA §1). ax, bx, cx, and dx each split into two 8-bit halves: al is the low byte of ax, and ah the high byte. There are no segment registers: the core is one flat 64 KB.',
      '## The registers',
      table(['register', 'halves', 'at the start', 'in a bot'], rows),
      'A bot starts with one process, at its base: ip and sp hold the base address, FLAGS holds 0x0002 (bit 1 always reads 1), and the rest hold 0. The stack grows down from the base, into the core under the bot.',
      '## A new process',
      `A process that ${link('spl')} starts gets a copy of every register and flag of its parent at that moment, with ip at the target. The two share the core, and nothing else: a later change to a register of one does not reach the other.`,
      '## Registers in addresses',
      'Only bx and bp (the base) and si and di (the index) can be part of a memory operand: `[bx+si+4]`, `[bp+di]`, `[di-2]`. See [ModR/M addressing](/docs/reference/addressing).',
      '## Register codes',
      'The 3-bit code of each register, in the ModR/M `reg` and `r/m` fields and in the low bits of a `+r` opcode. An instruction on bytes reads the code as an 8-bit register, so code 4 is sp in a word instruction and ah in a byte one.',
      table(['code', 'bits', '16-bit', '8-bit'], codes),
    ].join('\n\n'),
  }
}

const FLAG_INFO: readonly (readonly [
  flag: string,
  bit: number,
  name: string,
  when: string,
  readBy: string,
])[] = [
  [
    'CF',
    0,
    'carry',
    'an add carries out of the top bit, a subtract borrows, or a shift pushes a 1 out',
    '`jc`, `jnc`, `ja`, `jna`, `adc`, `sbb`, `rcl`, `rcr`',
  ],
  ['PF', 2, 'parity', 'the low byte of the result has an even count of 1 bits', '`jpe`, `jpo`'],
  [
    'AF',
    4,
    'auxiliary carry',
    'a carry or borrow crosses bit 3 (for decimal math, which x16c leaves out)',
    '`lahf`, `pushf`',
  ],
  [
    'ZF',
    6,
    'zero',
    'the result is 0',
    '`jz`, `jnz`, `ja`, `jna`, `jg`, `jng`, `loope`, `loopne`, `repe`, `repne`',
  ],
  [
    'SF',
    7,
    'sign',
    'bit 15 of the result (bit 7 of a byte) is 1',
    '`js`, `jns`, `jl`, `jnl`, `jg`, `jng`',
  ],
  [
    'DF',
    10,
    'direction',
    '`std` sets it and `cld` clears it',
    'every string instruction: it steps si and di down when DF = 1',
  ],
  ['OF', 11, 'overflow', 'a signed result does not fit', '`jo`, `jno`, `jl`, `jnl`, `jg`, `jng`'],
]

function flagsPage(): ReferencePage {
  const effects = (flag: string, mark: string) => {
    const at = FLAG_NAMES.indexOf(flag[0] as string)
    return [...FLAGS]
      .filter(([, marks]) => marks[at] === mark)
      .map(([m]) => link(m))
      .join(', ')
  }
  return {
    name: 'flags',
    title: 'flags',
    blurb: 'the seven flags: what sets each one, and what reads it.',
    mdx: [
      '# Flags',
      'FLAGS is a 16-bit register of each process. x16c uses seven of its bits: six status flags, which instructions set from their results, and DF, which steers the string instructions. Bit 1 always reads 1, and every other bit reads 0, the I and T of the 8086 included. The debugger shows them in the 8086 order:',
      '<Flags set="ODSZAPC" />',
      '## The flags',
      table(
        ['flag', 'bit', 'name', 'is 1 when', 'read by'],
        FLAG_INFO.map(([flag, bit, name, when, readBy]) => [
          code(flag),
          String(bit),
          name,
          cell(when),
          cell(readBy),
        ]),
      ),
      '## What changes each flag',
      'Each instruction page shows its flags row. This is the same, flag by flag: "from the result" is set or cleared by what the instruction computed. An instruction not listed never changes the flag.',
      table(
        ['flag', 'from the result', 'set to 0', 'set to 1'],
        FLAG_INFO.map(([flag]) => [
          code(flag),
          effects(flag, '*'),
          effects(flag, '0'),
          effects(flag, '1'),
        ]),
      ),
      'Where the 8086 leaves a flag undefined, x16c gives it a fixed value, the one the silicon gives: `and`, `or`, `xor`, and `test` clear AF; `mul` and `imul` clear SF, ZF, AF, and PF; `div` and `idiv` change no flag. A shift or rotate by a count of 0 changes no flag.',
      '## Saving and loading',
      `${link('pushf')} and ${link('popf')} save and load all of FLAGS through the stack. ${link('lahf')} and ${link('sahf')} copy SF, ZF, AF, PF, and CF to and from ah. A child of ${link('spl')} starts with its parent's flags, DF included.`,
      '## Conditions',
      `The conditional jumps read the flags: [control flow](/docs/reference/control#conditions) has the table of what each one tests.`,
    ].join('\n\n'),
  }
}

function memoryPage(): ReferencePage {
  const { maxProcesses, minSpacing, maxCycles } = DEFAULT_CONFIG
  const base = [
    '%name     "Base"',
    '%strategy "Find my base, bomb one lap, then spin"',
    '',
    'LAP     equ     (0x10000 - (end - start)) / 8 - 1 ; bombs in a lap that stops short of home',
    '',
    'start:  call    .here',
    '.here:  pop     bx',
    '        sub     bx, .here               ; bx = our base',
    '        lea     di, [bx+end]            ; di = just past our body',
    '        mov     cx, LAP',
    'bomb:   add     di, 8',
    '        mov     word [di], 0',
    '        loop    bomb',
    '        jmp     $',
    'end:',
  ].join('\n')
  return {
    name: 'memory',
    title: 'memory model',
    blurb: 'the 64 KB core, empty core as DAT, ownership, placement, and the base idiom.',
    mdx: [
      '# Memory model',
      '## The core',
      `The core is 65,536 bytes, addresses ${code('0x0000')} to ${code('0xFFFF')}: one flat address space, shared by every bot, with no segments. Every address wraps: one past ${code('0xFFFF')} is ${code('0x0000')}. A word is 2 bytes, low byte first, and a word at ${code('0xFFFF')} takes its high byte from ${code('0x0000')}.`,
      '## Empty core is DAT',
      `The core starts as zeros, and ${code('00')} is ${link('dat')}. A process that runs into empty core dies, and so does one that walks off the end of its code. A bomb is 2 zero bytes: ${inline('mov word [di], 0', 'the bomb')}.`,
      '## Ownership',
      'Beside the core is an ownership map: one byte per address, which bot wrote it last. Loading a bot counts as its write. The arena colors the core by it. It has no effect on the battle: any process can read or write any address.',
      '## Placement',
      `A bot is at most ${MAX_BOT_BYTES} bytes. The loader puts each bot at a base address drawn from the battle's seed, at least ${minSpacing.toLocaleString('en-US')} bytes from every other bot, wrapping included, and does not move or relocate it. The same seed and the same bots give the same places, so every battle can be run again.`,
      `Each bot starts with one process at its base, and may have up to ${maxProcesses} (the process cap). A battle ends when one bot or none is alive, or at ${maxCycles.toLocaleString('en-US')} cycles (80,000 on the hills).`,
      '## The stack',
      `sp starts at the base, so a ${link('push')} or ${link('call')} writes the word just under the bot, and the stack grows down into the core. That core belongs to nobody: an enemy bomb there changes what ${link('pop')} and ${link('ret')} read.`,
      '## Position independence',
      `A label is an offset from the start of the bot, the address it would have at ${code('org 0')}. So \`[label]\` is an absolute address, \`[disp16]\`: the place \`label\` in the core, not the bot's copy of it. To reach its own data, a bot finds its base and adds the label to it:`,
      botBlock(base, 'imp', 'the base idiom'),
      `${link('call')} pushes the address of \`.here\`, ${link('pop')} takes it, and ${link('sub')} takes away the offset of \`.here\`, which leaves the base. From then on, \`[bx+label]\` is the bot's own \`label\`. The linter warns on a memory operand with no register, \`absolute-address\`. Jumps, calls, \`loop\`, and \`spl label\` are relative, and need no base.`,
    ].join('\n\n'),
  }
}

const MOD_NAMES = ['mod 00', 'mod 01: + disp8', 'mod 10: + disp16'] as const
const RM_ADDRESS = ['bx+si', 'bx+di', 'bp+si', 'bp+di', 'si', 'di', 'bp', 'bx'] as const

function addressingPage(): ReferencePage {
  /** `mov dx, [address]` and its bytes, checked to have `mod` and `rm` in its ModR/M byte. */
  const form = (address: string, mod: number, rm: number) => {
    const source = `mov dx, [${address}]`
    const bytes = assembled(source, 'ModR/M').bytes
    if (bytes[0] !== 0x8b || bytes[1] !== ((mod << 6) | (2 << 3) | rm)) {
      throw new Error(`\`${source}\` is ${hex(bytes)}: not mod ${mod}, r/m ${rm}`)
    }
    return `${code(source)} · ${code(hex(bytes))}`
  }
  const rows = RM_ADDRESS.map((address, rm) => [
    code(rm.toString(2).padStart(3, '0')),
    code(`[${address}]`),
    rm === 6 ? `${form('0x1234', 0, 6)}: \`[disp16]\`, absolute` : form(address, 0, rm),
    form(`${address}+4`, 1, rm),
    form(`${address}+0x1234`, 2, rm),
  ])
  const walk = 'mov word [bx+si+4], 0x41'
  const walkBytes = bytesOf(walk, 'the ModR/M walk')
  if (walkBytes !== 'C7 40 04 41 00') throw new Error(`\`${walk}\` is ${walkBytes}`)
  return {
    name: 'addressing',
    title: 'modr/m addressing',
    blurb: 'memory operands: the 8 base and index forms, and how they encode.',
    mdx: [
      '# ModR/M addressing',
      'A memory operand is a base register (bx or bp), an index register (si or di), and a constant displacement, each one optional, in any order: `[bx+si+4]`, `[4+si]`, `[di]`, `[bx+label]`, `[0x0100]` (ISA §2.2, §6.3). The byte after the opcode, ModR/M, says which of them an instruction uses.',
      '<Fig src="modrm" alt="the ModR/M byte: mod in bits 7 and 6, reg in bits 5 to 3, r/m in bits 2 to 0">mod picks memory or a register and the displacement size; reg is a register or an opcode extension; r/m picks the address.</Fig>',
      '## The fields',
      table(
        ['mod', 'means'],
        [
          [code('00'), 'memory, no displacement; with r/m 110, `[disp16]`'],
          [code('01'), 'memory, plus a signed disp8 (-128..127)'],
          [code('10'), 'memory, plus a disp16'],
          [code('11'), 'a register: r/m is a register code'],
        ],
      ),
      "reg holds the other operand's [register code](/docs/reference/registers#register-codes), or, in a group opcode such as `80` or `F7`, an extension that picks the instruction: `/0` is `add` and `/5` is `sub` under `83`.",
      '## The 8 forms',
      'Each r/m code with each mod, as `mov dx, …` (reg = 010, dx) assembles them:',
      table(['r/m', 'address', ...MOD_NAMES], rows),
      '`[bp]` alone has no mod 00 form: that slot is `[disp16]`. The assembler writes it as mod 01 with a disp8 of 0, one byte longer than `[bx]`.',
      '## One instruction, byte by byte',
      `<Encoding form="mov r/m16, imm16" />`,
      table(
        ['byte', 'is', 'means'],
        [
          [code('C7'), 'opcode', '`mov r/m16, imm16`, with ModR/M'],
          [
            code('40'),
            'ModR/M `01 000 000`',
            'mod 01: a disp8 follows; reg /0: `mov`; r/m 000: `[bx+si]`',
          ],
          [code('04'), 'disp8', '+4'],
          [code('41 00'), 'imm16', '0x0041, low byte first'],
        ],
      ),
      `So ${code(walk)} is ${code(walkBytes)}: 5 bytes.`,
      '## Rules',
      '- There is no `[bx+bp]` and no `[si+di]`: one base and one index at most. Such an operand is the error `invalid-address`.',
      '- A displacement of -128..127 takes a disp8, and any other a disp16. A label is a number like any other, so `[bx+label]` near the start of a bot is short.',
      '- `[label]` and `[0x0100]` are absolute: the linter warns with `absolute-address` (see [memory model](/docs/reference/memory#position-independence)).',
      '- When no operand is a register, the size must be said: `mov word [bx], 0`, not `mov [bx], 0` (`size-not-specified`).',
      '- `lea` computes the address and reads nothing: `lea di, [bx+end]` is `di = bx + end`.',
    ].join('\n\n'),
  }
}

// The language pages.

function directivesPage(): ReferencePage {
  const row = (source: string, does: string) => [
    cell(inline(source, `the directive ${source}`)),
    cell(does),
  ]
  const locals = [
    'scan:   add     di, 2',
    '.again: cmp     word [di], 0            ; scan.again',
    '        je      .again',
    'bomb:   mov     word [di], 0',
    '.again: jmp     scan                    ; bomb.again: a different label',
  ].join('\n')
  return {
    name: 'directives',
    title: 'directives',
    blurb: 'metadata, data, constants, times, align, labels, and size words.',
    mdx: [
      '# Directives',
      'The source is NASM syntax for the 16-bit 8086, `bits 16` implied (ISA §6). Mnemonics, registers, and directives take any case; labels are case-sensitive. A `;` starts a comment to the end of the line.',
      '## Metadata',
      table(
        ['directive', 'does'],
        [
          row('%name "Dwarf"', 'The name the arena and the hills show. Required, once.'),
          row('%author "A. K. Dewdney"', 'Who wrote it.'),
          row(
            '%strategy "Bomb every 4th byte"',
            'One line on the tactic. The linter warns without it (`no-strategy`).',
          ),
          row('%version "1.2"', 'Any text.'),
        ],
      ),
      '## Data and space',
      table(
        ['directive', 'does'],
        [
          row(
            'db 1, 2, "ab", 0',
            'Bytes. A string gives its bytes: UTF-8, with the escapes `\\n \\t \\r \\0 \\\\ \\\' \\"`.',
          ),
          row('dw 0x1234, $', 'Words, low byte first.'),
          row('resb 16', 'Reserves 16 zero bytes, which are DAT.'),
          row('resw 8', 'Reserves 8 zero words.'),
          row(
            'times 4 nop',
            'Repeats an instruction or data line. `$` is the address of the `times` line in every repeat.',
          ),
          row('align 4', 'Pads with `00` (DAT) to a multiple of 4. The power of 2 is required.'),
        ],
      ),
      '<Warn>\n\nThe zeros of `resb`, `resw`, and `align` are DAT: code that runs into them dies. Put data after the code, behind a jump (the linter warns: `dat-in-code`).\n\n</Warn>',
      '## Constants and macros',
      table(
        ['directive', 'does'],
        [
          row(
            'STRIDE equ 4',
            'A named number, from any constant expression. It can name labels: `SIZE equ end - start`.',
          ),
          row(
            '%define GAP 0x100',
            'A one-line text macro, no parameters. It applies from its line on.',
          ),
          row('org 0', 'Accepted; must be 0. Bots are position independent.'),
          row('bits 16', 'Accepted, and ignored.'),
        ],
      ),
      '## Labels',
      '- `name:` defines a label at the address of the line. The colon may be left out before a statement word: `size equ 4`, `msg db 1`.',
      '- `.name` is local to the last label without a dot, so each phase can have its own `.loop`. Its full name is `scan.again`.',
      '- `$` is the address of the line, and `$$` is 0. `jmp $` spins in place.',
      fragment(locals, 'local labels'),
      '## Size and jump words',
      table(
        ['word', 'does'],
        [
          row(
            'mov word [bx], 0',
            '`byte` and `word` give the size of a memory operand when no register does.',
          ),
          row('jmp short $+2', '`short` forces rel8.'),
          row('jmp near $+2', '`near` forces rel16.'),
          row(
            'add ax, strict word 5',
            '`strict` keeps the field size given: here an imm16 where an imm8 would do.',
          ),
        ],
      ),
      '## Not supported',
      'x16c leaves out what a one-file, one-segment bot has no use for, with an error that says so (`unsupported`): sections, `extern` and `global`, multi-line `%macro`, `%if`, `%include`, `incbin`, segment registers, far jumps, and 32-bit registers. See [diagnostics](/docs/reference/diagnostics#unsupported).',
    ].join('\n\n'),
  }
}

function expressionsPage(): ReferencePage {
  /** The word `expr` assembles to, as `dw` gives it. */
  const value = (expr: string) => {
    const bytes = assembled(`dw ${expr}`, `the expression ${expr}`).bytes
    return (bytes[0] ?? 0) | ((bytes[1] ?? 0) << 8)
  }
  const row = (expr: string, note: string) => {
    const v = value(expr)
    return [cell(code(expr)), `${code(hex4(v))} (${v})`, cell(note)]
  }
  return {
    name: 'expressions',
    title: 'expressions',
    blurb: 'numbers, operators, labels, and how values wrap.',
    mdx: [
      '# Expressions',
      'Anywhere a number goes, an expression can: an immediate, a displacement, a jump target, a `dw`, an `equ`, a `times` count. The assembler folds each one to a number (ISA §6.1).',
      '## Numbers',
      table(
        ['write', 'value', 'is'],
        [
          row('123', 'decimal'),
          row('0x1F', 'hexadecimal'),
          row('1Fh', 'hexadecimal, NASM suffix: it must start with a digit (`0FFh`)'),
          row('0b1010', 'binary'),
          row("'A'", 'a character: its code'),
          row('-7', 'a negative number, as 16 bits'),
        ],
      ),
      '## Operators',
      'C operators and C precedence, all left to right. From the first to bind to the last:',
      table(
        ['operators', 'are'],
        [
          ['`-x` `+x` `~x`', 'negate, plus, flip every bit'],
          ['`*` `/` `%`', 'multiply, divide, remainder'],
          ['`+` `-`', 'add, subtract'],
          ['`<<` `>>`', 'shift left, shift right'],
          ['`&`', 'and'],
          ['`^`', 'xor'],
          [cell('`|`'), 'or'],
          ['`( )`', 'group'],
        ],
      ),
      table(
        ['expression', 'value', 'because'],
        [
          row('2 + 3 * 4', '`*` binds first'),
          row('(2 + 3) * 4', 'parentheses first'),
          row('1 << 4 | 1', '`<<` binds before `|`'),
          row('0xFF & ~0x0F', '`~` flips every bit of 0x000F'),
          row('-5 / 3', '`/` is signed and rounds toward 0, as in C'),
          row('-5 % 3', '`%` takes the sign of the left side, as in C'),
          row('-1 >> 4', '`>>` is arithmetic: the sign stays'),
          row('(0x8000 * 4) / 8', 'the math is exact, and wraps to 16 bits once, at the end'),
          row('0x10000 + 5', 'a value wraps to 16 bits'),
        ],
      ),
      '<Note>\n\nNASM differs: its `/`, `%`, and `>>` are unsigned (its signed ones are `//`, `%%`, and `>>>`, which x16c does not have). See [8086 divergences](/docs/reference/divergences#where-the-assembler-differs-from-nasm).\n\n</Note>',
      '## Labels and $',
      'A label is a number: its offset from the start of the bot. So `end - start` is the size of the code between them, and `$` is the offset of the current line.',
      fragment(
        'SIZE    equ     end - start             ; bytes of code\nWORDS   equ     (SIZE + 1) / 2          ; words, rounded up\nstart:  mov     cx, WORDS\n        rep     movsw\n        jmp     $                       ; $: this line\nend:',
        'labels in expressions',
      ),
      '<Warn>\n\nA label is an offset, not an address in the core: `mov ax, [label]` reads the absolute address `label`. Add the base: `[bx+label]` (see [memory model](/docs/reference/memory#position-independence)).\n\n</Warn>',
      '## Errors',
      'A name no label or `equ` defines is `undefined-symbol`; a division by 0 is `div-zero`; an `equ` defined through itself is `circular-equ`; a value too big for its field is `out-of-range`. A byte field takes -256..255, a sign-extended byte -128..127, and a word any value, wrapped.',
    ].join('\n\n'),
  }
}

/** The text under a heading of the assembler's README, up to the next heading as high. */
function readmeSection(readme: string, heading: string): string {
  const level = heading.indexOf(' ')
  const lines = readme.split('\n')
  const start = lines.indexOf(heading)
  if (start < 0) throw new Error(`packages/asm/README.md has no \`${heading}\``)
  let fenced = false
  let end = start + 1
  for (; end < lines.length; end++) {
    const line = lines[end] ?? ''
    if (line.startsWith('```')) fenced = !fenced
    const hashes = /^(#+) /.exec(line)?.[1]
    if (!fenced && hashes !== undefined && hashes.length <= level) break
  }
  return lines.slice(start + 1, end).join('\n')
}

/** The rows of the first table under a heading of the README, as trimmed cells. */
function readmeTable(readme: string, heading: string): string[][] {
  const lines = readmeSection(readme, heading).split('\n')
  const first = lines.findIndex((l) => l.startsWith('|'))
  const rows: string[][] = []
  for (const line of lines.slice(first + 2)) {
    if (!line.startsWith('|')) break
    rows.push(
      line
        .slice(1, -1)
        .split(' | ')
        .map((c) => c.trim()),
    )
  }
  return rows
}

/** Source from a README cell of code spans, a line each: `` `ret`<br>`nop` ``. */
const cellSource = (text: string) =>
  text
    .split('<br>')
    .map((part) => /^`([^`]+)`$/.exec(part.trim())?.[1] ?? '')
    .join('\n')

/** README links go to its own sections; in the docs, those are these pages. */
const readmeProse = (text: string) =>
  text
    .replace(/\]\(#dialect\)/g, '](/docs/reference/directives#not-supported)')
    .replace(/\]\(#listing\)/g, '](/docs/reference/divergences)')

function diagnosticsPage(readme: string): ReferencePage {
  const rows = readmeTable(readme, '### Codes')
  const codes = rows.map((r) => (r[0] ?? '').slice(1, -1))
  if (codes.join() !== DIAG_CODES.join()) {
    throw new Error('packages/asm/README.md: the codes table is not DIAG_CODES')
  }
  const entry = ([cellCode, severity, from, example, meaning]: string[]) => {
    const name = (cellCode ?? '').slice(1, -1)
    const source = cellSource(example ?? '')
    const text = `${source}${name === 'missing-name' ? '' : '\n%name "t"'}${name === 'no-strategy' ? '' : '\n%strategy "s"'}`
    const bot = assemble(text)
    const found = [...bot.diagnostics, ...lint(text, bot)].find((d) => d.code === name)
    if (found === undefined) throw new Error(`the example of \`${name}\` does not give it`)
    return [
      `### ${name}`,
      `**${severity}**, from the ${from}. ${prose(readmeProse(meaning ?? ''))}`,
      ['```asm fragment', source, '```'].join('\n'),
      `> ${prose(found.message)}`,
      ...(found.fix === undefined ? [] : [`**Fix:** ${prose(found.fix)}`]),
    ].join('\n\n')
  }
  const errors = rows.filter((r) => r[1] === 'error')
  const warnings = rows.filter((r) => r[1] === 'warning')
  return {
    name: 'diagnostics',
    title: 'diagnostics',
    blurb: 'every assembler error and linter warning, with an example of each.',
    mdx: [
      '# Diagnostics',
      'The assembler gives errors, and a bot with an error has no bytes. The linter gives warnings about a bot that assembles but may not do what its author means; each comes with a fix. Each has a code, which the editor shows beside the message: `3:9: error: jump out of range [jump-out-of-range]`.',
      'Each example below gives its code and no other (after a `%name` and a `%strategy` line), and the quote under it is the message the editor shows for it.',
      '## Errors',
      ...errors.map(entry),
      '## Warnings',
      'A roster bot allows a warning it needs with a comment on its line: `; lint: allow hlt-in-code: dying at once is the whole bot`.',
      ...warnings.map(entry),
    ].join('\n\n'),
  }
}

function divergencesPage(readme: string): ReferencePage {
  const differs = readmeTable(readme, '### Different bytes').map(([source, x16c, nasm, why]) => {
    const text = cellSource(source ?? '')
    const bytes = bytesOf(text, 'a NASM difference')
    if (`\`${bytes}\`` !== x16c) throw new Error(`\`${text}\` is ${bytes}, not ${x16c}`)
    // MDX is JSX: a line break in a cell is `<br />`.
    const br = (text: string) => text.replace(/<br>/g, '<br />')
    return [br(source ?? ''), x16c ?? '', nasm ?? '', cell(readmeProse(why ?? ''))]
  })
  const datForm = assemble('add byte [bx], al\n%name "t"').diagnostics[0]
  if (datForm?.code !== 'dat-form') throw new Error('`add byte [bx], al` is not `dat-form`')
  return {
    name: 'divergences',
    title: '8086 divergences',
    blurb: 'where x16c is not an 8086, and where its assembler is not nasm.',
    mdx: [
      '# 8086 divergences',
      'x16c is real 8086 machine code: every instruction the assembler writes is the 8086 encoding, `ndisasm -b16` reads a bot, and any 8086 reference holds for it. It differs in three places, all on purpose (ISA §9).',
      '## 00 is DAT',
      `On the 8086, \`00 /r\` is \`add r/m8, r8\`. Here \`00\` is ${link('dat')}, whatever byte follows, because empty core must kill. So \`add byte [bx], al\` is an error:`,
      `> ${prose(datForm.message)}`,
      `A byte \`add\` of two registers takes the other encoding, \`02 /r\`: ${inline('add al, bl', 'add al, bl')} is ${code(bytesOf('add al, bl', 'add al, bl'))}.`,
      '## 60, 61, and 62 are spl',
      `On the 8086, \`60\`..\`62\` are undefined; the 80186 made them \`pusha\`, \`popa\`, and \`bound\`. Here they are ${link('spl')}: \`60 cb\`, \`61 cw\`, and \`62 /0\`.`,
      '## No segments, interrupts, I/O, or timing',
      '- One flat 64 KB core. No segment registers, segment prefixes, or far jumps and calls: those bytes are undefined, and kill.',
      `- ${link('hlt')}, ${link('int3')}, and every undefined opcode kill the process instead of stopping or trapping. There is no \`int n\`, \`in\`, \`out\`, \`cli\`, or \`sti\`.`,
      '- Every instruction takes one cycle. A `rep` instruction takes one cycle per iteration, and can be stopped between two, as an interrupt stops the 8086.',
      '## Where the 8086 decides',
      'Where the ISA leaves a behavior open, x16c does what the 8086 silicon does:',
      '- `push sp` pushes the value of sp after the decrement; the 80286 and later push the value before. `pop sp` leaves sp holding the popped word.',
      '- A shift count in cl is not masked to 5 bits, as later CPUs do: a count of 40 shifts 40 times.',
      '- `idiv` kills on a quotient of -32768 (-128 for a byte), as the 8086 does.',
      '- A shift or rotate by a count of 0 changes no flag, but writes its memory operand back.',
      '- The flags the 8086 manual leaves undefined have fixed values: see [flags](/docs/reference/flags#what-changes-each-flag).',
      '## Where the assembler differs from NASM',
      '`nasm -f bin` assembles most bots to the same bytes. Where the two differ, x16c gives an error instead of a guess, or these bytes:',
      table(['source', 'x16c', 'NASM', 'why'], differs),
    ].join('\n\n'),
  }
}

/** The reference's pages, in reading order. */
export function referencePages(
  notes: Notes,
  readme: string = readFileSync(ASM_README, 'utf8'),
): ReferencePage[] {
  const docs = generate(notes)
  const families = Object.keys(FAMILY_PAGE) as Family[]
  const pages = [
    ...families.map((family) => familyPage(family, docs, notes)),
    registersPage(),
    flagsPage(),
    memoryPage(),
    addressingPage(),
    directivesPage(),
    expressionsPage(),
    diagnosticsPage(readme),
    divergencesPage(readme),
  ]
  for (const page of pages) {
    if (page.title !== page.title.toLowerCase()) throw new Error(`${page.name}: title case`)
  }
  return pages
}

/** `nav.ts`: the sidebar section of the pages, formatted as Biome formats it. */
function navModule(pages: readonly ReferencePage[]): string {
  const entry = (p: ReferencePage) =>
    [
      '    {',
      `      slug: 'reference/${p.name}',`,
      `      file: 'generated/reference/${p.name}',`,
      `      title: '${p.title}',`,
      `      blurb: '${p.blurb.replace(/'/g, "\\'")}',`,
      `      load: () => import('./${p.name}.mdx'),`,
      '    },',
    ].join('\n')
  return [
    '/**',
    ' * The language reference in the docs sidebar. Written by `bun run opcodes`',
    ' * (scripts/gen-reference.ts) with the pages it lists: do not edit.',
    ' */',
    "import type { DocSection } from '../../nav'",
    '',
    'export const REFERENCE: DocSection = {',
    "  title: 'language reference',",
    '  pages: [',
    ...pages.map(entry),
    '  ],',
    '}',
    '',
  ].join('\n')
}

/** Each file of the reference, by path: the pages' MDX and `nav.ts`. */
export function referenceFiles(notes: Notes, readme?: string): Map<string, string> {
  const pages = referencePages(notes, readme)
  const files = new Map(pages.map((p) => [join(REFERENCE_DIR, `${p.name}.mdx`), `${p.mdx}\n`]))
  files.set(join(REFERENCE_DIR, 'nav.ts'), navModule(pages))
  return files
}

/** Files in the reference's folder that the generator no longer writes. */
export function staleFiles(files: ReadonlyMap<string, string>): string[] {
  let names: string[] = []
  try {
    names = readdirSync(REFERENCE_DIR)
  } catch {}
  return names.map((name) => join(REFERENCE_DIR, name)).filter((path) => !files.has(path))
}
