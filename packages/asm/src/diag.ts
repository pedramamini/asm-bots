/**
 * Stable diagnostic identifiers, for tests, docs, and editor quick fixes. The lexer's:
 * `bad-char` (a character no token starts with), `bad-escape`, `bad-number`, and
 * `unterminated-string`.
 */
export type DiagCode = 'bad-char' | 'bad-escape' | 'bad-number' | 'unterminated-string'

/** One assembler or linter finding, located in the source (ISA §6.5). */
export interface Diag {
  severity: 'error' | 'warning'
  /** 1-based. */
  line: number
  /** 1-based, in UTF-16 code units, so a tab is 1 column. */
  col: number
  /** Columns covered. */
  len: number
  message: string
  code: DiagCode
}
