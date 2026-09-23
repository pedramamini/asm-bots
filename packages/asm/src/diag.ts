/**
 * Stable diagnostic identifiers, for tests, docs, and editor quick fixes.
 * - Lexer: `bad-char` (a character no token starts with), `bad-escape`, `bad-number`, and
 *   `unterminated-string`.
 * - Parser: `syntax` (a token out of place), `unknown-mnemonic`, `invalid-address` (a memory
 *   operand the 8086 cannot address), `bad-operand` (an operand of the wrong kind), `bad-label`
 *   (a reserved word as a label), `bad-directive` (a directive with a value it cannot take), and
 *   `unsupported` (a NASM feature x16c leaves out, ISA §6.2).
 * - Expressions: `undefined-symbol` and `div-zero`.
 * - Encoder, one code per `EncodeErrorCode` of the codec: `unknown-mnemonic`, `invalid-address`,
 *   `invalid-prefix`, `invalid-operands`, `size-not-specified`, `size-mismatch`, `dat-form` (the
 *   `add <mem8>, r8` form that encodes as DAT), `jump-out-of-range`, and `out-of-range` (a value
 *   too big for its field).
 * - Assembler: `duplicate-symbol` (a label or `equ` name defined twice), `circular-equ` (an `equ`
 *   defined in terms of itself), `missing-name` (no `%name`), `no-convergence` (instruction sizes
 *   that do not settle), and `size-over-cap` (a bot bigger than the size limit). It also gives
 *   `bad-directive` for a metadata directive given twice, an empty `%name`, a count out of range
 *   (`times`, `resb`, `resw`), and an `align` that is not a power of 2.
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
  | 'invalid-prefix'
  | 'invalid-operands'
  | 'size-not-specified'
  | 'size-mismatch'
  | 'dat-form'
  | 'jump-out-of-range'
  | 'out-of-range'
  | 'duplicate-symbol'
  | 'circular-equ'
  | 'missing-name'
  | 'no-convergence'
  | 'size-over-cap'

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
