/**
 * Stable diagnostic identifiers, for tests, docs, and editor quick fixes.
 * - Lexer: `bad-char` (a character no token starts with), `bad-escape`, `bad-number`, and
 *   `unterminated-string`.
 * - Parser: `syntax` (a token out of place), `unknown-mnemonic`, `invalid-address` (a memory
 *   operand the 8086 cannot address), `bad-operand` (an operand of the wrong kind), `bad-label`
 *   (a reserved word as a label), `bad-directive` (a directive with a value it cannot take), and
 *   `unsupported` (a NASM feature x16c leaves out, ISA §6.2).
 * - Expressions: `undefined-symbol` and `div-zero`.
 */
export type DiagCode =
  | 'bad-char'
  | 'bad-escape'
  | 'bad-number'
  | 'unterminated-string'
  | 'syntax'
  | 'unknown-mnemonic'
  | 'invalid-address'
  | 'bad-operand'
  | 'bad-label'
  | 'bad-directive'
  | 'unsupported'
  | 'undefined-symbol'
  | 'div-zero'

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
