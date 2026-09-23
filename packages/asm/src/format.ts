import type { Line } from './ast'
import type { Diag } from './diag'
import { isRegister, startsStatement } from './keywords'
import { type Token, tokenize } from './lexer'
import { parse } from './parser'

/*
 * Columns count from 0 here, with a tab stop every 8, which is how the text reads on screen. A
 * field starts at its column, or one space after the field before it when that one runs long.
 */
const MNEMONIC_COL = 8
const OPERAND_COL = 16
const COMMENT_COL = 40
/** Metadata text lines up one column past `%strategy`, the longest metadata directive (ISA §6). */
const META_COL = 10
const TAB = 8

/** Operand keywords. They are reserved words, so no symbol has one of these names. */
const OPERAND_WORDS: ReadonlySet<string> = new Set(['byte', 'word', 'strict', 'short', 'near'])
/** Operators that are always binary; `+` and `-` are unary where no value comes before them. */
const BINARY: ReadonlySet<string> = new Set(['*', '/', '%', '<<', '>>', '&', '|', '^'])

/**
 * Formats x16c source in the canonical layout (ARCHITECTURE §4):
 *
 * - A label at column 0 with a `:`, the mnemonic at 8, the operands at 16, and a comment at 40.
 *   An `equ` name has no `:`. A prefix takes the mnemonic column and its instruction the operand
 *   column (`rep     movsw`). Metadata text goes at column 10 (`%name     "Dwarf"`), and a
 *   `%define` name at 8 with its text at 16; both texts stay as written.
 * - Mnemonics, prefixes, registers, directives, and keywords in lowercase; labels and symbols as
 *   written. Hex numbers as `0x` and uppercase digits (`1fh` is `0x1F`), binary as `0b`.
 * - Operands separated by `, `; binary operators spaced outside `[ ]` and packed inside them
 *   (`$ + 2`, `[bx+si+4]`).
 * - A comment-only line stays at column 0 if it starts there, and goes to 8 otherwise, or under
 *   the comment of the line above when it continues it (starts in the same column).
 * - One blank line between global-label blocks when either block has two or more lines, with the
 *   comment lines right above a label kept with it. Runs of blank lines become one, and there are
 *   none at the start or the end. Lines end in `\n`.
 *
 * Formatting never changes what the source assembles to. It changes only whitespace, the case of
 * words the assembler reads in any case, the spelling of numbers, and the colon after a label.
 * A line with a lexer or parser error stays exactly as written, and so does the case of any word
 * that is, or in lowercase is, the name of a `%define` macro. `formatSource(formatSource(s))` is
 * `formatSource(s)`.
 */
export function formatSource(source: string): string {
  const diags: Diag[] = []
  const tokens = tokenize(source, diags, { comments: true })
  const parsed = parse(tokens)
  const broken = new Set([...diags, ...parsed.diags].map((d) => d.line))
  const texts = source.split(/\r\n|\r|\n/)
  const perLine = byLine(tokens, texts.length)
  const macros = new Set<string>()
  const rows: Row[] = []
  for (const [i, text] of texts.entries()) {
    const { code, comment } = perLine[i] as LineTokens
    const line = parsed.lines[i] as Line
    rows.push(row(text, code, comment, line, broken.has(i + 1), rows[i - 1], macros))
    const [first, name] = code
    if (first?.kind === 'directive' && first.text.toLowerCase() === '%define') {
      if (name?.kind === 'ident') macros.add(name.text)
    }
  }
  return arrange(rows)
}

/** A line of the output, with what the blank-line pass needs to know about it. */
interface Row {
  text: string
  kind: 'blank' | 'comment' | 'code'
  /**
   * Where the comment of a code line, or of a line that continues one, starts: in the source and
   * in the output. A comment-only line that starts in the same source column continues it.
   */
  comment: { from: number; to: number } | undefined
  /** A comment-only line under the comment of the line above. */
  continues: boolean
  /** A code line whose label starts a `.local` scope, which starts a block. */
  opens: boolean
  /** A label and nothing else. */
  bare: boolean
}

interface LineTokens {
  code: Token[]
  comment: Token | undefined
}

/** The tokens of each line, and its comment. */
function byLine(tokens: readonly Token[], count: number): LineTokens[] {
  const lines: LineTokens[] = Array.from({ length: count }, () => ({
    code: [],
    comment: undefined,
  }))
  for (const t of tokens) {
    const at = lines[t.line - 1]
    if (at === undefined || t.kind === 'newline' || t.kind === 'eof') continue
    if (t.kind === 'comment') at.comment = t
    else at.code.push(t)
  }
  return lines
}

function row(
  text: string,
  code: readonly Token[],
  comment: Token | undefined,
  line: Line,
  broken: boolean,
  above: Row | undefined,
  macros: ReadonlySet<string>,
): Row {
  const from = comment === undefined ? 0 : width(text.slice(0, comment.col - 1))
  const note = comment === undefined ? '' : trimEnd(comment.text)
  const plain = { continues: false, opens: false, bare: false }
  if (code.length === 0) {
    if (comment === undefined) return { text: '', kind: 'blank', comment: undefined, ...plain }
    const continues = above?.comment?.from === from
    const to = continues ? (above?.comment?.to ?? 0) : from === 0 ? 0 : MNEMONIC_COL
    const at = continues ? { from, to } : undefined
    return { text: ' '.repeat(to) + note, kind: 'comment', comment: at, ...plain, continues }
  }
  const opens = opensBlock(code, line, macros)
  if (broken) {
    // Even trailing blanks stay: they are part of an unterminated string.
    const at = comment === undefined ? undefined : { from, to: from }
    return { text, kind: 'code', comment: at, ...plain, opens }
  }
  const bare = line.kind === 'empty' && line.label !== undefined
  const out = render(fields(code, line, macros), note)
  const at = out.at === undefined ? undefined : { from, to: out.at }
  return { text: out.text, kind: 'code', comment: at, continues: false, opens, bare }
}

/**
 * Whether the label of the line starts a `.local` scope, as the parser decides: a label that is
 * not `.local` (or `..@`), before anything but `equ`. A label from a macro is left out.
 */
function opensBlock(code: readonly Token[], line: Line, macros: ReadonlySet<string>): boolean {
  const [name, second, third] = code
  if (line.label === undefined || name?.kind !== 'ident' || name.col !== line.label.col) {
    return false
  }
  if (affected(name, macros) || name.text.replace(/^\$/, '').startsWith('.')) return false
  const next = isPunct(second, ':') ? third : second
  return !(next?.kind === 'ident' && next.text.toLowerCase() === 'equ')
}

/** A field: the column it starts at, and its text. */
type Cell = readonly [col: number, text: string]

/** The fields of a line that parsed: label, mnemonic, and operands. */
function fields(code: readonly Token[], line: Line, macros: ReadonlySet<string>): Cell[] {
  const [first, name, ...text] = code as [Token, ...Token[]]
  if (first.kind === 'directive') {
    const word = first.text.toLowerCase()
    const cells: Cell[] = [[0, word]]
    if (word !== '%define') cells.push([META_COL, spelled(code.slice(1))])
    else cells.push([MNEMONIC_COL, name?.text ?? ''], [OPERAND_COL, spelled(text)])
    return cells
  }
  const start = line.kind === 'empty' ? Number.POSITIVE_INFINITY : line.col
  const label = code.filter((t) => t.col < start)
  const cells: Cell[] = [[0, labelText(label, line, macros)]]
  const [head, ...rest] = code.filter((t) => t.col >= start)
  if (head === undefined) return cells
  cells.push([MNEMONIC_COL, tokenText(head, true, macros)])
  cells.push([OPERAND_COL, operandText(rest, keywords(rest, head, line, macros), macros)])
  return cells
}

/**
 * The label field: `name:`, or `name` for an `equ` (with the colon only where the parser needs
 * it: `loop: equ 4`). Tokens it cannot read as a plain label, such as a macro, stay as written.
 */
function labelText(label: readonly Token[], line: Line, macros: ReadonlySet<string>): string {
  const [name, colon, ...more] = label
  if (name === undefined) return ''
  const plain =
    name.kind === 'ident' &&
    !affected(name, macros) &&
    more.length === 0 &&
    (colon === undefined || isPunct(colon, ':'))
  if (!plain) return spelled(label)
  if (line.kind === 'equ' && !startsStatement(name.text.toLowerCase())) return name.text
  return `${name.text}:`
}

/**
 * The positions in `rest`, the tokens after the first word of the statement, of the words that
 * start an instruction: the mnemonic after a prefix, and the statement that `times` repeats.
 */
function keywords(
  rest: readonly Token[],
  head: Token,
  line: Line,
  macros: ReadonlySet<string>,
): number[] {
  const words: number[] = []
  /** The mnemonic at `at`, after the prefix of `stmt` (unless a macro wrote the prefix). */
  const prefixed = (at: number, stmt: Line) => {
    if (stmt.kind !== 'instr' || stmt.prefix === undefined) return
    const prefix = at === 0 ? head : rest[at - 1]
    if (prefix !== undefined && !affected(prefix, macros) && rest[at]?.kind === 'ident') {
      words.push(at)
    }
  }
  prefixed(0, line)
  if (line.kind === 'times') {
    const at = rest.findIndex((t) => t.col === line.body.col)
    if (at >= 0) {
      words.push(at)
      prefixed(at + 1, line.body)
    }
  }
  return words
}

type Operator = 'binary' | 'unary' | undefined

/**
 * Operand tokens with canonical spacing: `, ` between operands, a space after a keyword
 * (`word [bx]`, `short $`), binary operators spaced outside `[ ]` and packed inside, and unary
 * operators packed onto their operand (`-1`, `~0x80`, `-(4)`). Two words never touch.
 */
function operandText(
  tokens: readonly Token[],
  keywordAt: readonly number[],
  macros: ReadonlySet<string>,
): string {
  const kw = tokens.map(
    (t, i) =>
      keywordAt.includes(i) || (t.kind === 'ident' && OPERAND_WORDS.has(t.text.toLowerCase())),
  )
  const ops = tokens.map((t, i): Operator => {
    if (t.kind !== 'punct') return undefined
    if (t.text === '~') return 'unary'
    if (BINARY.has(t.text)) return 'binary'
    if (t.text !== '+' && t.text !== '-') return undefined
    const prev = tokens[i - 1]
    return prev !== undefined && endsValue(prev, kw[i - 1] === true) ? 'binary' : 'unary'
  })
  let out = ''
  let depth = 0
  for (const [i, t] of tokens.entries()) {
    const prev = tokens[i - 1]
    if (prev !== undefined) {
      const space = spaced(prev, t, {
        kw: [kw[i - 1] === true, kw[i] === true],
        ops: [ops[i - 1], ops[i]],
        depth,
      })
      if (space) out += ' '
    }
    out += tokenText(t, keywordAt.includes(i), macros)
    if (isPunct(t, '[')) depth++
    else if (isPunct(t, ']') && depth > 0) depth--
  }
  return out
}

/** A token after which `+` and `-` are binary. */
function endsValue(t: Token, keyword: boolean): boolean {
  if (t.kind === 'ident') return !keyword
  return (
    t.kind === 'number' ||
    t.kind === 'char' ||
    t.kind === 'string' ||
    isPunct(t, ')') ||
    isPunct(t, ']')
  )
}

interface Around {
  /** Whether the token before, and the token, are keywords. */
  kw: readonly [boolean, boolean]
  ops: readonly [Operator, Operator]
  /** How deep in `[ ]` the token is. */
  depth: number
}

/** Whether a space goes between `prev` and `t`. */
function spaced(prev: Token, t: Token, { kw, ops, depth }: Around): boolean {
  if (isPunct(t, ',')) return false
  if (isPunct(prev, ',')) return true
  if (isPunct(prev, '(') || isPunct(prev, '[') || isPunct(t, ')') || isPunct(t, ']')) return false
  if (kw[0] || kw[1]) return true
  if (ops[0] === 'binary' || ops[1] === 'binary') return depth === 0
  // A unary operator after a word keeps its space: `a~b` would read as one name.
  if (ops[1] === 'unary') return ops[0] !== 'unary'
  return ops[0] !== 'unary'
}

/**
 * Tokens as written, with the spacing of the source: one space where it had any, none where it
 * had none. For metadata text, and for a macro's text, which means nothing until it is used.
 */
function spelled(tokens: readonly Token[]): string {
  let out = ''
  for (const [i, t] of tokens.entries()) {
    const prev = tokens[i - 1]
    if (prev !== undefined && prev.col + prev.len < t.col) out += ' '
    out += t.text
  }
  return out
}

/** A token as the output writes it; `keyword` marks a word the assembler reads in any case. */
function tokenText(t: Token, keyword: boolean, macros: ReadonlySet<string>): string {
  if (t.kind === 'number') return numberText(t.text)
  if (t.kind === 'directive') return t.text.toLowerCase()
  if (t.kind !== 'ident' || affected(t, macros)) return t.text
  const lower = t.text.toLowerCase()
  return keyword || isRegister(lower) || OPERAND_WORDS.has(lower) ? lower : t.text
}

/**
 * A valid number in canonical form: hex as `0x` and uppercase digits, binary as `0b`, decimal as
 * written. The leading `0` that NASM needs before a letter in the `h` form goes: `0FFh` is `0xFF`.
 */
function numberText(text: string): string {
  if (/[hH]$/.test(text)) {
    const digits = text.slice(0, -1)
    return `0x${(/^0[A-Fa-f]/.test(digits) ? digits.slice(1) : digits).toUpperCase()}`
  }
  if (/^0[xX]/.test(text)) return `0x${text.slice(2).toUpperCase()}`
  if (/^0[bB]/.test(text)) return `0b${text.slice(2)}`
  return text
}

/**
 * A word whose case must stay: the name of a `%define` macro, as written or in lowercase. The
 * macros are the ones defined on the lines before, as the parser has them.
 */
function affected(t: Token, macros: ReadonlySet<string>): boolean {
  return t.kind === 'ident' && (macros.has(t.text) || macros.has(t.text.toLowerCase()))
}

const isPunct = (t: Token | undefined, text: string) => t?.kind === 'punct' && t.text === text

/** `s` without the whitespace the lexer skips at its end. */
const trimEnd = (s: string) => s.replace(/[ \t\v\f]+$/, '')

/** The column after `s` when it starts at column `from`, with a tab stop every 8 columns. */
function width(s: string, from = 0): number {
  let w = from
  for (let i = 0; i < s.length; i++) w = s.charCodeAt(i) === 9 ? w - (w % TAB) + TAB : w + 1
  return w
}

/** The cells in their columns, then the comment. `at` is the column the comment starts at. */
function render(cells: readonly Cell[], note: string): { text: string; at: number | undefined } {
  let text = ''
  let w = 0
  const put = (col: number, s: string) => {
    const start = text === '' ? col : Math.max(col, w + 1)
    text += ' '.repeat(start - w) + s
    w = width(s, start)
    return start
  }
  for (const [col, s] of cells) if (s !== '') put(col, s)
  const at = note === '' ? undefined : put(COMMENT_COL, note)
  return { text, at }
}

/**
 * Joins the rows, placing blank lines: one before each block (a global label and the comment
 * lines right above it) when it or the block before it has two or more code lines, unless a bare
 * label comes right before it. Runs of blank lines become one; none lead or trail.
 */
function arrange(rows: readonly Row[]): string {
  const starts = new Set<number>()
  for (const [i, r] of rows.entries()) {
    if (!r.opens) continue
    let s = i
    while (s > 0 && rows[s - 1]?.kind === 'comment' && rows[s - 1]?.continues === false) s--
    starts.add(s)
  }
  const block: number[] = []
  const sizes: number[] = [0]
  for (const [i, r] of rows.entries()) {
    if (starts.has(i)) sizes.push(0)
    block.push(sizes.length - 1)
    if (r.kind === 'code') sizes[sizes.length - 1] = (sizes.at(-1) ?? 0) + 1
  }
  const out: string[] = []
  let gap = false
  let last: Row | undefined
  for (const [i, r] of rows.entries()) {
    if (r.kind === 'blank') {
      gap = out.length > 0
      continue
    }
    if (starts.has(i) && out.length > 0 && last?.bare !== true) {
      const b = block[i] ?? 0
      if ((sizes[b] ?? 0) >= 2 || (sizes[b - 1] ?? 0) >= 2) gap = true
    }
    if (gap) out.push('')
    gap = false
    out.push(r.text)
    last = r
  }
  return out.length === 0 ? '' : `${out.join('\n')}\n`
}
