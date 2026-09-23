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
 * - Linter warnings: `absolute-address` (`[label]` with no register), `unreachable` (code after a
 *   `jmp`, `ret`, `hlt`, `int3`, or DAT with no label), `dat-in-code` (DAT bytes that code falls
 *   into), `size-near-cap` (90% of the size limit or more), `no-strategy` (no `%strategy` text),
 *   `hlt-in-code` (a `hlt` the bot runs), and `uninitialized-di` (a string instruction that uses
 *   di before any line sets di).
 */
export type DiagCode = (typeof DIAG_CODES)[number]

/** Every `DiagCode`, in the order of the list above. The package README has a row for each. */
export const DIAG_CODES = [
  'bad-char',
  'bad-escape',
  'bad-number',
  'unterminated-string',
  'syntax',
  'unknown-mnemonic',
  'invalid-address',
  'bad-operand',
  'bad-label',
  'bad-directive',
  'unsupported',
  'undefined-symbol',
  'div-zero',
  'invalid-prefix',
  'invalid-operands',
  'size-not-specified',
  'size-mismatch',
  'dat-form',
  'jump-out-of-range',
  'out-of-range',
  'duplicate-symbol',
  'circular-equ',
  'missing-name',
  'no-convergence',
  'size-over-cap',
  'absolute-address',
  'unreachable',
  'dat-in-code',
  'size-near-cap',
  'no-strategy',
  'hlt-in-code',
  'uninitialized-di',
] as const

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
  /** What to do about it. Every linter warning has one; assembler errors say it in `message`. */
  fix?: string
}

/**
 * `d` on one line, the way compilers print a finding, so that editors and terminals link the
 * place: `dwarf.asm:3:9: error: jump out of range [jump-out-of-range]`. Without `file`, the line
 * starts at `3:9:`. The `fix` is left out.
 */
export function formatDiag(d: Diag, file?: string): string {
  const where = file === undefined ? `${d.line}:${d.col}` : `${file}:${d.line}:${d.col}`
  return `${where}: ${d.severity}: ${d.message} [${d.code}]`
}
