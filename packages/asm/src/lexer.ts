import type { Diag, DiagCode } from './diag'

/**
 * Token kinds. Mnemonics, registers, keywords (`byte`, `times`, `equ`, ...), `$`, and `$$` are
 * all `ident`; the parser tells them apart. A `directive` is a `%` name that starts a line;
 * anywhere else `%` is the modulo operator. A `comment` runs from `;` to the end of its line, and
 * only `tokenize` with `comments: true` yields one.
 */
export type TokenKind =
  | 'ident'
  | 'number'
  | 'string'
  | 'char'
  | 'punct'
  | 'directive'
  | 'comment'
  | 'newline'
  | 'eof'

interface TokenBase {
  /** The source text: quotes included, the line break of a `newline`, `''` for `eof`. */
  text: string
  /** 1-based. */
  line: number
  /** 1-based, in UTF-16 code units, so a tab is 1 column. */
  col: number
  /** Columns covered. */
  len: number
}

/** A number, or a literal of exactly one character in either quote (`'A'`, `'\n'`): its code. */
export interface NumberToken extends TokenBase {
  kind: 'number' | 'char'
  value: number
}

/** A quoted literal of any other length, escapes resolved. */
export interface StringToken extends TokenBase {
  kind: 'string'
  value: string
}

export interface PlainToken extends TokenBase {
  kind: 'ident' | 'punct' | 'directive' | 'comment' | 'newline' | 'eof'
}

export type Token = NumberToken | StringToken | PlainToken

export interface TokenizeOptions {
  /** Keep each `;` comment as a `comment` token, for the formatter. The parser skips them. */
  comments?: boolean
}

/** ISA §6.1 identifiers: `[A-Za-z_.$?][A-Za-z0-9_.$?#@~]*`. A number is a word of IDENT_PART too. */
const IDENT_START = /[A-Za-z_.$?]/
const IDENT_PART = /[A-Za-z0-9_.$?#@~]/
/** Sticky, so it matches in place and leaves the end of the match in `lastIndex`. */
const DIRECTIVE = /%[A-Za-z_][A-Za-z0-9_]*/y
const PUNCT: ReadonlySet<string> = new Set('[],:+-*/%&|^~()')

/** Escape letter → character, in strings and character literals. */
const ESCAPES: ReadonlyMap<string, string> = new Map([
  ['n', '\n'],
  ['t', '\t'],
  ['r', '\r'],
  ['0', '\0'],
  ['\\', '\\'],
  ["'", "'"],
  ['"', '"'],
])
const ESCAPE_LIST = [...ESCAPES.keys()].map((e) => `\\${e}`).join(' ')

const DIGITS = { 2: /[01]/, 10: /[0-9]/, 16: /[0-9A-Fa-f]/ } as const
const RADIX_NAME = { 2: 'binary', 10: 'decimal', 16: 'hex' } as const

const isBreak = (c: string) => c === '\n' || c === '\r'
const isDigit = (c: string) => c >= '0' && c <= '9'

/** `'!'` for printable ASCII, else the code point: `U+00A0`. */
const describeChar = (code: number) =>
  code > 0x20 && code < 0x7f
    ? `'${String.fromCharCode(code)}'`
    : `U+${code.toString(16).toUpperCase().padStart(4, '0')}`

/**
 * The value of a number word (ISA §6.1): `123`, `0x1F`, `1Fh`, `0b1010`, in any case. A trailing
 * `h` wins over a `0b` prefix, so `0B800h` is hex. For a word that is not a number, the reason.
 * Values are exact up to 2^53; the evaluator wraps the final value to 16 bits.
 */
function numberValue(word: string): number | string {
  let radix: 2 | 10 | 16 = 10
  let digits = word
  if (/[hH]$/.test(word)) {
    radix = 16
    digits = word.slice(0, -1)
  } else if (/^0[xXbB]/.test(word)) {
    radix = /^0[xX]/.test(word) ? 16 : 2
    digits = word.slice(2)
    if (digits === '') return `no digits after '${word}'`
  }
  for (const d of digits) {
    if (!DIGITS[radix].test(d)) {
      const hint = radix === 10 ? ' (hex needs 0x or an h suffix, binary needs 0b)' : ''
      return `'${d}' is not a ${RADIX_NAME[radix]} digit${hint}`
    }
  }
  const value = Number.parseInt(digits, radix)
  return Number.isSafeInteger(value) ? value : 'too large'
}

/**
 * Splits x16c source (ISA §6.1) into tokens, ending with `eof`. Every line break (`\n`, `\r\n`,
 * or a lone `\r`) is a `newline` token; whitespace is dropped, and so are `;` comments unless
 * `opts.comments` keeps them. Lexing never stops: a bad number still yields a number token
 * (value 0), an unterminated literal runs to the end of its line, an unexpected character yields
 * no token, and each error goes to `diags`.
 */
export function tokenize(source: string, diags: Diag[] = [], opts: TokenizeOptions = {}): Token[] {
  const tokens: Token[] = []
  let line = 1
  /** Index of the first character of the current line. */
  let lineStart = 0
  let i = 0

  const col = (at: number) => at - lineStart + 1
  /** Position and text of the token from `start` to `i`. */
  const span = (start: number) => ({
    text: source.slice(start, i),
    line,
    col: col(start),
    len: i - start,
  })
  const error = (code: DiagCode, at: number, len: number, message: string) => {
    diags.push({ severity: 'error', line, col: col(at), len, message, code })
  }
  /** Whether a directive starts at `at`: a `%` name that is the first token of its line. */
  const directiveAt = (at: number) => {
    const last = tokens.at(-1)
    if (last !== undefined && last.kind !== 'newline') return false
    DIRECTIVE.lastIndex = at
    return DIRECTIVE.test(source)
  }

  while (i < source.length) {
    const start = i
    const c = source.charAt(i)

    if (c === ' ' || c === '\t' || c === '\v' || c === '\f') {
      i++
    } else if (isBreak(c)) {
      i += c === '\r' && source.charAt(i + 1) === '\n' ? 2 : 1
      tokens.push({ kind: 'newline', ...span(start) })
      line++
      lineStart = i
    } else if (c === ';') {
      while (i < source.length && !isBreak(source.charAt(i))) i++
      if (opts.comments === true) tokens.push({ kind: 'comment', ...span(start) })
    } else if (c === '"' || c === "'") {
      let value = ''
      let closed = false
      i++
      while (i < source.length && !isBreak(source.charAt(i))) {
        const ch = source.charAt(i)
        if (ch === c) {
          i++
          closed = true
          break
        }
        if (ch !== '\\') {
          value += ch
          i++
          continue
        }
        const e = source.charAt(i + 1)
        if (e === '' || isBreak(e)) {
          i++
          break
        }
        const escaped = ESCAPES.get(e)
        if (escaped === undefined) {
          error('bad-escape', i, 2, `unknown escape '\\${e}'; the escapes are ${ESCAPE_LIST}`)
        }
        value += escaped ?? e
        i += 2
      }
      if (!closed) {
        error('unterminated-string', start, i - start, `unterminated string: no closing ${c}`)
      }
      tokens.push(
        value.length === 1
          ? { kind: 'char', value: value.charCodeAt(0), ...span(start) }
          : { kind: 'string', value, ...span(start) },
      )
    } else if (isDigit(c)) {
      while (IDENT_PART.test(source.charAt(i))) i++
      const word = source.slice(start, i)
      const value = numberValue(word)
      if (typeof value === 'string') {
        error('bad-number', start, i - start, `invalid number '${word}': ${value}`)
      }
      tokens.push({ kind: 'number', value: typeof value === 'number' ? value : 0, ...span(start) })
    } else if (IDENT_START.test(c)) {
      i++
      while (IDENT_PART.test(source.charAt(i))) i++
      tokens.push({ kind: 'ident', ...span(start) })
    } else if (c === '%' && directiveAt(i)) {
      i = DIRECTIVE.lastIndex
      tokens.push({ kind: 'directive', ...span(start) })
    } else if (source.startsWith('<<', i) || source.startsWith('>>', i)) {
      i += 2
      tokens.push({ kind: 'punct', ...span(start) })
    } else if (PUNCT.has(c)) {
      i++
      tokens.push({ kind: 'punct', ...span(start) })
    } else {
      const code = source.codePointAt(i) ?? 0
      i += code > 0xffff ? 2 : 1
      error('bad-char', start, i - start, `unexpected character ${describeChar(code)}`)
    }
  }
  tokens.push({ kind: 'eof', text: '', line, col: col(i), len: 0 })
  return tokens
}
