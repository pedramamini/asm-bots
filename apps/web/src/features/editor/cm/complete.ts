/**
 * Completion for x16c (PRODUCT_SPEC §3). What it offers depends on where the word is (x16c.ts
 * `scan`):
 *
 * - at the head of a statement: the mnemonics (each with its summary, and its reference card
 *   beside it), their aliases, the prefixes, the directives, and two snippets, the base idiom and
 *   an `spl` fork;
 * - after a prefix: the string instructions it takes;
 * - `%` at the start of a line: the `%` directives;
 * - in operands: the registers, the size words, and the labels of the last assemble without
 *   errors (assembled.ts), jump targets first after a jump. A `.local` label of the scope the
 *   cursor is in comes as `.name`, any other by its full name.
 */
import { WORDS } from '@asmbots/asm'
import { ALIASES, MNEMONICS, REG8_NAMES, REG16_NAMES } from '@asmbots/codec'
import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  pickedCompletion,
  snippet,
  snippetCompletion,
} from '@codemirror/autocomplete'
import type { EditorState, Text } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { assembledField } from './assembled'
import { opcodeCard } from './card'
import { opcodeEntry } from './opcodes'
import { type LineToken, scan, scanLine } from './x16c'

/** A word being typed: an ISA §6.1 identifier up to the cursor. */
const WORD = /[A-Za-z_.$?][A-Za-z0-9_.$?#@~]*$/
const VALID_FOR = /^[A-Za-z_.$?][A-Za-z0-9_.$?#@~]*$/

const REGISTER_DETAILS: Readonly<Record<string, string>> = {
  ax: 'accumulator',
  cx: 'count: loop, rep, shift by cl',
  dx: 'data; high word of mul and div',
  bx: 'base: [bx+...]',
  sp: 'stack pointer: push, pop, call, ret',
  bp: 'base pointer: [bp+...]',
  si: 'source index: [si], movs, lods',
  di: 'destination index: [di], movs, stos, scas',
}

const SIZE_DETAILS: Readonly<Record<string, string>> = {
  byte: '8-bit operand: mov byte [di], 0',
  word: '16-bit operand: mov word [di], 0',
  short: 'rel8 jump: jmp short label',
  near: 'rel16 jump: jmp near label',
  strict: 'keep the field size: add ax, strict word 1',
}

/** What each statement word of `WORDS.directives` does. */
export const DIRECTIVE_DETAILS: Readonly<Record<string, string>> = {
  db: 'bytes: db 0x41, "text"',
  dw: 'words: dw 0x1234, label',
  resb: 'n zero bytes, which are DAT',
  resw: 'n zero words, which are DAT',
  align: 'pad with 00 (DAT) to a multiple of n',
  org: 'accepted; must be 0',
  bits: 'accepted; must be 16',
  equ: 'a constant: size equ end - start',
  times: 'repeat: times 4 nop',
}

/** The `%` directives, laid out as the formatter lays them out (text at column 10). */
const PERCENT_OPTIONS: readonly Completion[] = [
  snippetCompletion('%name     "#{name}"', { label: '%name', detail: "the bot's name (required)" }),
  snippetCompletion('%author   "#{author}"', { label: '%author', detail: 'who wrote it' }),
  snippetCompletion('%strategy "#{strategy}"', {
    label: '%strategy',
    detail: 'how it fights, in a line',
  }),
  snippetCompletion('%version  "#{version}"', { label: '%version', detail: 'its version' }),
  snippetCompletion('%define #{NAME}    #{text}', {
    label: '%define',
    detail: 'a one-line text macro',
  }),
].map((option) => ({ ...option, type: 'keyword' }))

/** A mnemonic or prefix by `label`, which is `name` or one of its aliases. */
function opcodeOption(label: string, name: string, boost = 0): Completion {
  const entry = opcodeEntry(name)
  if (entry === undefined) return { label, type: 'keyword', boost }
  const summary = label === name ? entry.doc.summary : `${name}: ${entry.doc.summary}`
  return { label, type: 'keyword', boost, detail: summary, info: () => opcodeCard(entry) }
}

const MNEMONIC_OPTIONS: readonly Completion[] = [
  ...MNEMONICS.map((m) => opcodeOption(m, m)),
  ...[...ALIASES].map(([alias, m]) => opcodeOption(alias, m, -1)),
]

const PREFIX_OPTIONS: readonly Completion[] = [...WORDS.prefixes].map((p) => {
  const name = opcodeEntry(p)?.name ?? p
  return opcodeOption(p, name, p === name ? 0 : -1)
})

const DIRECTIVE_OPTIONS: readonly Completion[] = [...WORDS.directives].map((d) => ({
  label: d,
  type: 'keyword',
  detail: DIRECTIVE_DETAILS[d] ?? '',
}))

/** Ahead of the labels, except after a jump, where the labels come first (`operandOptions`). */
const REGISTER_OPTIONS: readonly Completion[] = [
  ...REG16_NAMES.map((r) => ({
    label: r,
    type: 'variable',
    detail: REGISTER_DETAILS[r] ?? '',
    boost: 1,
  })),
  ...REG8_NAMES.map((r) => ({
    label: r,
    type: 'variable',
    detail: `${r.endsWith('l') ? 'low' : 'high'} byte of ${r[0]}x`,
  })),
]

const SIZE_OPTIONS: readonly Completion[] = [...WORDS.sizes].map((s) => ({
  label: s,
  type: 'keyword',
  detail: SIZE_DETAILS[s] ?? '',
}))

/**
 * A snippet that lays itself out from the start of its line, as the formatter would: labels at
 * column 0 and instructions at 8. CodeMirror indents a snippet's later lines by its line's
 * indentation, so typed after the usual 8 spaces, the snippet would take those out first; it does,
 * in the same transaction.
 */
function lineSnippet(template: string, option: Omit<Completion, 'apply'>): Completion {
  const insert = snippet(template)
  return {
    ...option,
    apply(view: EditorView, completion: Completion, from: number, to: number) {
      const line = view.state.doc.lineAt(from)
      const indent = from - line.from
      if (!/^[ \t]*$/.test(line.text.slice(0, indent))) return insert(view, completion, from, to)
      const unindent = view.state.update({ changes: { from: line.from, to: from } })
      insert(
        {
          state: unindent.state,
          dispatch: (tr) =>
            view.dispatch({
              changes: unindent.changes.compose(tr.changes),
              selection: tr.selection,
              effects: tr.effects,
              annotations: pickedCompletion.of(completion),
              userEvent: 'input.complete',
              scrollIntoView: true,
            }),
        },
        completion,
        line.from,
        to - indent,
      )
    },
  }
}

/** The snippets of PRODUCT_SPEC §3's templates that fit inside a bot. */
export const SNIPPETS: readonly Completion[] = [
  lineSnippet(
    [
      '#{start}:  call    .here',
      '.here:  pop     bx',
      '        sub     bx, .here               ; bx = our base address',
      '        #{}',
    ].join('\n'),
    {
      label: 'base idiom',
      detail: 'call, pop, sub: bx = our base address',
      type: 'text',
      boost: -2,
    },
  ),
  lineSnippet(
    [
      '        spl     #{child}                ; a new process starts there',
      '#{parent}:                              ; this one goes on here',
      '        #{}',
      '#{child}:',
    ].join('\n'),
    {
      label: 'spl fork',
      detail: 'a new process: parent and child labels',
      type: 'text',
      boost: -2,
    },
  ),
]

/** What can start a statement. Snippets bring their own labels, so only on a line of their own. */
const STATEMENT_OPTIONS: readonly Completion[] = [
  ...MNEMONIC_OPTIONS,
  ...PREFIX_OPTIONS,
  ...DIRECTIVE_OPTIONS,
]
const LINE_OPTIONS: readonly Completion[] = [...STATEMENT_OPTIONS, ...SNIPPETS]

/** Tokens a word cannot follow without a space: after `0x1F` or `"text"` there is nothing to add. */
const LITERALS: ReadonlySet<string> = new Set(['number', 'string', 'invalid'])

/** A symbol's value in the listing's hex, or in decimal when it is no address. */
function valueText(value: number): string {
  return Number.isInteger(value) && value >= 0 && value <= 0xffff
    ? `0x${value.toString(16).toUpperCase().padStart(4, '0')}`
    : String(value)
}

/**
 * The global label whose scope line `lineNo` is in: the last one defined on it or above it, not
 * counting `.local` names, `..@` names, and `equ` names, which do not start a scope (NASM).
 */
export function scopeAt(doc: Text, lineNo: number): string {
  for (let n = lineNo; n >= 1; n--) {
    const text = doc.line(n).text
    const tokens = scanLine(text)
    const first = tokens[0]
    if (first?.type !== 'label') continue
    const name = text.slice(first.from, first.to).replace(/^\$/, '')
    const next = tokens.find((t) => t.from > first.from && t.type !== 'punctuation')
    const equ = next !== undefined && text.slice(next.from, next.to).toLowerCase() === 'equ'
    if (!name.startsWith('.') && !equ) return name
  }
  return ''
}

/** The labels and constants of the last good assemble, as the line at `lineNo` names them. */
function labelOptions(state: EditorState, lineNo: number, boost: number): Completion[] {
  const bot = state.field(assembledField, false)
  if (bot === undefined || bot === null) return []
  const scope = scopeAt(state.doc, lineNo)
  return [...bot.symbols].map(([name, value]) => ({
    label: scope !== '' && name.startsWith(`${scope}.`) ? name.slice(scope.length) : name,
    type: 'variable',
    detail: valueText(value),
    boost,
  }))
}

/** The options for a word in the operands of a line whose tokens so far are `tokens`. */
function operandOptions(
  state: EditorState,
  lineNo: number,
  tokens: readonly LineToken[],
  text: string,
): Completion[] {
  const mnemonic = tokens.find((t) => t.type === 'mnemonic')
  const jump =
    mnemonic !== undefined &&
    WORDS.targets.has(text.slice(mnemonic.from, mnemonic.to).toLowerCase())
  let depth = 0
  for (const t of tokens) {
    if (t.type === 'bracket') depth += text[t.from] === '[' ? 1 : -1
  }
  const labels = labelOptions(state, lineNo, jump ? 2 : 0)
  return depth > 0
    ? [...REGISTER_OPTIONS, ...labels]
    : [...REGISTER_OPTIONS, ...SIZE_OPTIONS, ...labels]
}

export function x16cCompletions(context: CompletionContext): CompletionResult | null {
  const { state, pos } = context
  const line = state.doc.lineAt(pos)
  const before = line.text.slice(0, pos - line.from)

  const percent = /^[ \t]*(%[A-Za-z_]*)$/.exec(before)?.[1]
  if (percent !== undefined) {
    return { from: pos - percent.length, options: PERCENT_OPTIONS, validFor: /^%[A-Za-z_]*$/ }
  }

  const { tokens, at } = scan(before)
  const last = tokens.at(-1)
  if (last?.type === 'comment') return null
  const typed = context.matchBefore(WORD)
  // A word completes only as a token of its own: not the tail of a number (`0x1F`) or a string.
  const typing = typed !== null && last !== undefined && line.from + last.from === typed.from
  if (typed !== null ? !typing : !context.explicit) return null
  if (!typing && last !== undefined && last.to === before.length && LITERALS.has(last.type)) {
    return null
  }
  const where = typing ? (last as LineToken).at : at
  const words = typing ? tokens.slice(0, -1) : tokens

  let options: readonly Completion[]
  switch (where) {
    case 'head':
      options = words.length === 0 ? LINE_OPTIONS : STATEMENT_OPTIONS
      break
    case 'prefix': {
      const prefix = words.at(-1)
      const entry =
        prefix === undefined ? undefined : opcodeEntry(before.slice(prefix.from, prefix.to))
      const takes: readonly string[] = entry?.kind === 'prefix' ? entry.doc.takes : []
      options = MNEMONIC_OPTIONS.filter((o) => takes.includes(o.label))
      break
    }
    case 'times':
      options = [...STATEMENT_OPTIONS, ...labelOptions(state, line.number, 1)]
      break
    case 'operands':
      options = operandOptions(state, line.number, words, before)
      break
    default:
      return null
  }
  return { from: typed?.from ?? pos, options, validFor: VALID_FOR }
}
