/**
 * x16c for CodeMirror 6 (ARCHITECTURE §6): a hand-written stream tokenizer, its highlight style,
 * and the editor's theme. Every color is one of the kit's CSS variables, so a theme switch (the
 * `data-theme` of `<html>`) recolors a live editor; nothing is created again.
 *
 * The tokenizer reads a line as `@asmbots/asm` does (ISA §6): `[label] [statement] [; comment]`,
 * with the lexer's characters and number forms and the parser's words (`WORDS`). No line depends on
 * the lines before it, so each starts from a fresh state, and `scanLine` gives the editor's tokens
 * anywhere else: the hover card, completion, and tests.
 */
import { WORDS } from '@asmbots/asm'
import {
  HighlightStyle,
  StreamLanguage,
  type StreamParser,
  StringStream,
} from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { type Tag, tags as t } from '@lezer/highlight'

/** The token classes of x16c source, each with its highlight tag. */
export const TOKEN_TAGS = {
  mnemonic: t.keyword,
  prefix: t.modifier,
  register: t.special(t.variableName),
  number: t.number,
  string: t.string,
  /** `$` and `$$`: the address of the line, and 0. */
  here: t.self,
  /** A label where it is defined: `start:`, `msg db 1`, `size equ 4`. */
  label: t.definition(t.labelName),
  /** Any other name: a label, an `equ` constant, or a `%define` macro where it is used. */
  symbol: t.labelName,
  /** The name a `%define` defines. */
  macro: t.definition(t.macroName),
  /** `%name`, `%define`, `db`, `times`, `equ`, and the other statement words of ISA §6.2. */
  directive: t.processingInstruction,
  /** `byte`, `word`, `short`, `near`, `strict`. */
  size: t.typeName,
  bracket: t.squareBracket,
  operator: t.operator,
  punctuation: t.punctuation,
  comment: t.lineComment,
  /** What the lexer rejects: a stray character, or a number in no ISA §6.1 form. */
  invalid: t.invalid,
} as const satisfies Record<string, Tag>

export type X16cToken = keyof typeof TOKEN_TAGS

/** Each token class's color: a kit token (DESIGN_SYSTEM §2), set in every theme. */
export const TOKEN_COLORS: Readonly<Record<X16cToken, string>> = {
  mnemonic: '--accent',
  prefix: '--accent',
  register: '--text-bright',
  number: '--info',
  string: '--info',
  here: '--info',
  label: '--warn',
  symbol: '--warn',
  macro: '--warn',
  directive: '--accent-2',
  size: '--text-muted',
  bracket: '--text-muted',
  operator: '--text-muted',
  punctuation: '--text-muted',
  comment: '--text-dim',
  invalid: '--danger',
}

/**
 * Where the tokenizer is in a line: before the statement (`head`, also after a label), after a
 * prefix, in the count of a `times`, at the name of a `%define`, or in the operands.
 */
export type Position = 'head' | 'prefix' | 'times' | 'define' | 'operands'

export interface X16cState {
  at: Position
  /** No token yet on this line: only here does `%` start a directive. */
  first: boolean
}

/** ISA §6.1 identifiers; a number is a word of the same characters, as the lexer reads it. */
const IDENT_START = /[A-Za-z_.$?]/
const IDENT_PART = /[A-Za-z0-9_.$?#@~]/
/** The lexer's whitespace: no other space character is one. */
const SPACE = /[ \t\v\f]/
const DIRECTIVE = /^%[A-Za-z_][A-Za-z0-9_]*/
const COLON_AHEAD = /^[ \t\v\f]*:/
const WORD_AHEAD = /^[ \t\v\f]+([A-Za-z_.$?][A-Za-z0-9_.$?#@~]*)/
const OPERATORS: ReadonlySet<string> = new Set('+-*/%&|^~()')

/**
 * Whether a number word has an ISA §6.1 form, by the lexer's rules: `123`, `0x1F`, `1Fh`,
 * `0b1010`, in any case, where a trailing `h` wins over `0b` (`0B800h` is hex), and the value is
 * exact (below 2^53).
 */
export function isNumber(word: string): boolean {
  let radix = 10
  let digits = word
  if (/[hH]$/.test(word)) {
    radix = 16
    digits = word.slice(0, -1)
  } else if (/^0[xXbB]/.test(word)) {
    radix = /^0[xX]/.test(word) ? 16 : 2
    digits = word.slice(2)
  }
  const valid = radix === 16 ? /^[0-9A-Fa-f]+$/ : radix === 2 ? /^[01]+$/ : /^[0-9]+$/
  return valid.test(digits) && Number.isSafeInteger(Number.parseInt(digits, radix))
}

/** The class of a word that starts a statement, or null. */
function statementWord(word: string): 'prefix' | 'mnemonic' | 'directive' | null {
  if (WORDS.prefixes.has(word)) return 'prefix'
  if (WORDS.mnemonics.has(word)) return 'mnemonic'
  if (WORDS.directives.has(word)) return 'directive'
  return null
}

/**
 * Whether the word just read, at the head of a line, is a label: a colon follows, or, as NASM
 * allows, a statement word does (`msg db 1`) and the word is not one itself.
 */
function labelAhead(stream: StringStream, word: string): boolean {
  if (stream.match(COLON_AHEAD, false)) return true
  if (statementWord(word) !== null) return false
  const next = stream.match(WORD_AHEAD, false)
  return Array.isArray(next) && statementWord((next[1] as string).toLowerCase()) !== null
}

/** Past the head of the line: a `times` count stays one until its statement word. */
function leaveHead(state: X16cState): void {
  if (state.at !== 'times') state.at = 'operands'
}

function word(stream: StringStream, state: X16cState): X16cToken {
  const text = stream.current()
  const lower = text.toLowerCase()
  const at = state.at
  if (at === 'define') {
    // `%define NAME text`: the text reads like a statement of its own.
    state.at = 'head'
    return 'macro'
  }
  if (at === 'head' && labelAhead(stream, lower)) return 'label'
  if (at !== 'operands') {
    const kind = statementWord(lower)
    if (kind !== null) {
      state.at = kind === 'prefix' ? 'prefix' : lower === 'times' ? 'times' : 'operands'
      return kind
    }
    leaveHead(state)
  }
  if (WORDS.registers.has(lower)) return 'register'
  if (WORDS.sizes.has(lower)) return 'size'
  if (text === '$' || text === '$$') return 'here'
  return 'symbol'
}

/**
 * A quoted literal, escapes included, to its closing quote or the end of the line. One character
 * is a number (`'A'` is 65, ISA §6.1), as in the lexer; any other length is a string.
 */
function quoted(stream: StringStream, quote: string, state: X16cState): X16cToken {
  leaveHead(state)
  let length = 0
  while (!stream.eol()) {
    const ch = stream.next()
    if (ch === quote) break
    if (ch === '\\') {
      if (stream.eol()) break
      stream.next()
    }
    length++
  }
  return length === 1 ? 'number' : 'string'
}

function token(stream: StringStream, state: X16cState): X16cToken | null {
  if (stream.sol()) {
    state.at = 'head'
    state.first = true
  }
  if (stream.eatWhile(SPACE)) return null
  const first = state.first
  state.first = false
  const c = stream.next() as string
  if (c === ';') {
    stream.skipToEnd()
    return 'comment'
  }
  if (c === '"' || c === "'") return quoted(stream, c, state)
  if (c >= '0' && c <= '9') {
    stream.eatWhile(IDENT_PART)
    leaveHead(state)
    return isNumber(stream.current()) ? 'number' : 'invalid'
  }
  if (IDENT_START.test(c)) {
    stream.eatWhile(IDENT_PART)
    return word(stream, state)
  }
  if (c === '%' && first) {
    stream.backUp(1)
    if (stream.match(DIRECTIVE)) {
      state.at = stream.current().toLowerCase() === '%define' ? 'define' : 'operands'
      return 'directive'
    }
    stream.next()
  }
  if (c === ':' || c === ',') return 'punctuation'
  if (c === '[' || c === ']' || OPERATORS.has(c) || ((c === '<' || c === '>') && stream.eat(c))) {
    leaveHead(state)
    return c === '[' || c === ']' ? 'bracket' : 'operator'
  }
  // A character the lexer rejects: one code point, and no token for the parser, so the line
  // reads on as if it were not there.
  const code = c.charCodeAt(0)
  if (code >= 0xd800 && code < 0xdc00) stream.eat(/[\udc00-\udfff]/)
  state.first = first
  return 'invalid'
}

export const x16cParser: StreamParser<X16cState> = {
  name: 'x16c',
  startState: () => ({ at: 'head', first: true }),
  token,
  tokenTable: TOKEN_TAGS,
  languageData: {
    commentTokens: { line: ';' },
    // `.loop`, `$ax`, and `..@x` are one word to double-click and to complete.
    wordChars: '.$?#@~',
  },
}

export const x16cLanguage = StreamLanguage.define(x16cParser)

export interface LineToken {
  /** Offsets in the line. */
  from: number
  to: number
  type: X16cToken
  /** Where the tokenizer was when the token began. */
  at: Position
}

/** A line's tokens (whitespace left out), and where the tokenizer is at its end. */
export function scan(text: string): { tokens: LineToken[]; at: Position } {
  const stream = new StringStream(text, 8, 8)
  const state: X16cState = { at: 'head', first: true }
  const tokens: LineToken[] = []
  while (!stream.eol()) {
    const at = state.at
    const type = token(stream, state)
    if (stream.pos === stream.start) throw new Error(`x16c: no token at ${stream.pos} of ${text}`)
    if (type !== null) tokens.push({ from: stream.start, to: stream.pos, type, at })
    stream.start = stream.pos
  }
  return { tokens, at: state.at }
}

/** A line's tokens, as the editor colors them. */
export function scanLine(text: string): LineToken[] {
  return scan(text).tokens
}

export const x16cHighlightStyle = HighlightStyle.define(
  (Object.keys(TOKEN_TAGS) as X16cToken[]).map((token) => ({
    tag: TOKEN_TAGS[token],
    color: `var(${TOKEN_COLORS[token]})`,
  })),
)

/**
 * The editor's look in the kit's tokens: the Code type (13/20, DESIGN_SYSTEM §3), the `--panel-2`
 * field of an input, and hairlines, not shadows. It sets each color CodeMirror's light and dark base
 * themes set, so the editor never needs to know which kind of theme is on.
 */
export const EDITOR_THEME = {
  '&': {
    color: 'var(--text)',
    backgroundColor: 'var(--panel-2)',
    fontSize: '13px',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '20px' },
  '.cm-content': { caretColor: 'var(--accent)', padding: '8px 0' },
  '.cm-line': { padding: '0 12px 0 8px' },
  '.cm-cursor, .cm-dropCursor': { borderLeft: '2px solid var(--accent)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    { backgroundColor: 'var(--accent-25)' },
  '.cm-activeLine': { backgroundColor: 'var(--accent-10)' },
  '.cm-gutters': {
    color: 'var(--text-dim)',
    backgroundColor: 'var(--panel-2)',
    borderRight: '1px solid var(--border)',
  },
  '.cm-activeLineGutter': { color: 'var(--text-muted)', backgroundColor: 'var(--accent-10)' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 12px', minWidth: '4ch' },
  '.cm-selectionMatch': { backgroundColor: 'var(--accent-10)' },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
    color: 'var(--text-bright)',
    backgroundColor: 'var(--accent-25)',
  },
  '.cm-nonmatchingBracket, &.cm-focused .cm-nonmatchingBracket': { color: 'var(--danger)' },
  '.cm-searchMatch': {
    backgroundColor: 'var(--accent-25)',
    outline: '1px solid var(--accent-45)',
  },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--accent-45)' },
  '.cm-panels': { color: 'var(--text)', backgroundColor: 'var(--panel)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
  '.cm-snippetField': { backgroundColor: 'var(--accent-10)' },
  '.cm-snippetFieldPosition': { borderLeft: '1px solid var(--accent)' },
  '.cm-tooltip': {
    color: 'var(--text)',
    backgroundColor: 'var(--panel)',
    border: '1px solid var(--border-strong)',
    borderRadius: 'var(--radius-md)',
  },
  '.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--font-mono)', maxHeight: '15em' },
  '.cm-tooltip-autocomplete > ul > li': { padding: '1px 12px 1px 8px', lineHeight: '20px' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    color: 'var(--text-bright)',
    backgroundColor: 'var(--accent-10)',
    boxShadow: 'inset 2px 0 0 var(--accent)',
  },
  '.cm-completionMatchedText': { color: 'var(--accent)', textDecoration: 'none' },
  '.cm-completionDetail': { color: 'var(--text-muted)', fontStyle: 'normal', marginLeft: '2ch' },
  '.cm-tooltip.cm-completionInfo': { padding: '0' },

  // The reference card (card.ts): a hover tooltip, and the info beside a completion.
  '.cm-x16c-card': {
    padding: '10px 12px',
    maxWidth: '460px',
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    lineHeight: '18px',
    fontVariantNumeric: 'tabular-nums',
  },
  '.cm-x16c-card-head': { display: 'flex', alignItems: 'baseline', gap: '12px' },
  '.cm-x16c-card-name': {
    color: 'var(--accent)',
    fontSize: '11px',
    fontWeight: '600',
    letterSpacing: '0.10em',
    textTransform: 'uppercase',
  },
  '.cm-x16c-card-aliases': { color: 'var(--text-muted)' },
  '.cm-x16c-card-family': {
    marginLeft: 'auto',
    color: 'var(--text-muted)',
    fontSize: '10px',
    letterSpacing: '0.10em',
    textTransform: 'uppercase',
  },
  '.cm-x16c-card-summary': { margin: '4px 0 0', color: 'var(--text)' },
  '.cm-x16c-card-kills': { color: 'var(--danger)' },
  '.cm-x16c-card-section': {
    marginTop: '8px',
    paddingTop: '6px',
    borderTop: '1px solid var(--border)',
  },
  '.cm-x16c-card-label': {
    marginBottom: '2px',
    color: 'var(--text-muted)',
    fontSize: '10px',
    letterSpacing: '0.10em',
    textTransform: 'uppercase',
  },
  '.cm-x16c-card-rows': {
    display: 'grid',
    gridTemplateColumns: 'max-content max-content',
    columnGap: '3ch',
    whiteSpace: 'pre',
  },
  '.cm-x16c-card-code': { color: 'var(--text-bright)' },
  '.cm-x16c-card-bytes': { color: 'var(--text-muted)' },
  '.cm-x16c-card-flags': {
    display: 'grid',
    gridTemplateColumns: 'repeat(9, 2.5ch)',
    textAlign: 'center',
  },
  '.cm-x16c-card-flag': { color: 'var(--text-dim)' },
  '.cm-x16c-card-flag[data-on]': { color: 'var(--accent)' },
} as const

export const x16cTheme = EditorView.theme(EDITOR_THEME)
