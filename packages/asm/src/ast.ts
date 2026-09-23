import type { REG8_NAMES, REG16_NAMES } from '@asmbots/codec'

/** A place on one source line: 1-based column and length, in UTF-16 code units. */
export interface Span {
  col: number
  len: number
}

/** A register name, lowercase. */
export type RegName = (typeof REG16_NAMES)[number] | (typeof REG8_NAMES)[number]

/** 8 for `byte`, 16 for `word`. */
export type Size = 8 | 16

/** A number or a one-character literal (`'A'` is 65). */
export interface NumExpr extends Span {
  kind: 'num'
  value: number
}

/** A label or `equ` name. A `.local` name carries the label it belongs to: `start.loop`. */
export interface SymExpr extends Span {
  kind: 'sym'
  name: string
}

/** `$`, the address of the current line. */
export interface HereExpr extends Span {
  kind: 'here'
}

/** `$$`, the start of the bot, which is always 0. */
export interface OriginExpr extends Span {
  kind: 'origin'
}

/** A register inside a memory operand, before the parser takes it out of the address. */
export interface RegExpr extends Span {
  kind: 'reg'
  name: RegName
}

export type UnaryOp = '-' | '+' | '~'
export type BinaryOp = '*' | '/' | '%' | '+' | '-' | '<<' | '>>' | '&' | '^' | '|'

export type ExprLeaf = NumExpr | SymExpr | HereExpr | OriginExpr

export interface UnaryExpr<Leaf = ExprLeaf> extends Span {
  kind: 'unary'
  op: UnaryOp
  arg: Leaf | UnaryExpr<Leaf> | BinaryExpr<Leaf>
}

export interface BinaryExpr<Leaf = ExprLeaf> extends Span {
  kind: 'binary'
  op: BinaryOp
  left: Leaf | UnaryExpr<Leaf> | BinaryExpr<Leaf>
  right: Leaf | UnaryExpr<Leaf> | BinaryExpr<Leaf>
}

/**
 * A constant expression (ISA §6.1). A node's span covers its source text, parentheses included.
 * A node the parser makes up (the `0` of `[bx]`, the `-` of `[bx-2]`) takes a nearby span.
 */
export type Expr = ExprLeaf | UnaryExpr | BinaryExpr

/** An expression as read. Only a memory operand keeps registers, and the parser takes them out. */
export type RawExpr =
  | ExprLeaf
  | RegExpr
  | UnaryExpr<ExprLeaf | RegExpr>
  | BinaryExpr<ExprLeaf | RegExpr>

export interface RegAst extends Span {
  kind: 'reg'
  name: RegName
}

/**
 * A value. `size` comes from `byte` or `word` before it, which gives the size of the operation
 * (`mov [bx], word 0`). With `strict`, the size is that of the immediate field instead
 * (`add ax, strict word 5`), which is how the disassembler pins a longer encoding.
 */
export interface ImmAst extends Span {
  kind: 'imm'
  expr: Expr
  size?: Size
  strict?: true
}

/**
 * `[base + index + disp]` (ISA §6.3). `size` is the data size (`word [bx]`); `dispSize` pins the
 * displacement field (`[byte bx+0]`, `[word 0x0100]`). No base and no index is `[disp16]`.
 */
export interface MemAst extends Span {
  kind: 'mem'
  base?: 'bx' | 'bp'
  index?: 'si' | 'di'
  disp: Expr
  size?: Size
  dispSize?: Size
}

/**
 * The address a jump, call, or `spl` goes to. `short` forces rel8, `near` rel16, and `auto`
 * leaves the choice to the assembler (ISA §6.3).
 */
export interface TargetAst extends Span {
  kind: 'target'
  expr: Expr
  hint: 'short' | 'near' | 'auto'
}

/** A quoted literal that stands alone: a `db` item or the text of a metadata directive. */
export interface StrAst extends Span {
  kind: 'str'
  value: string
}

export type OperandAst = RegAst | ImmAst | MemAst | TargetAst | StrAst

/** A label definition. `name` is the full name, so a `.local` label carries its global label. */
export interface Label extends Span {
  name: string
}

/**
 * One source line. The span covers the statement after the label, from the prefix or keyword to
 * the end of the last operand; an empty line has col 1 and len 0.
 */
interface LineBase extends Span {
  /** 1-based. */
  line: number
  label?: Label
  operands: OperandAst[]
}

/** A blank, comment-only, or label-only line, or a line with a syntax error. */
export interface EmptyLine extends LineBase {
  kind: 'empty'
}

/** An instruction. `mnemonic` and `prefix` are as written (an alias stays one), in lowercase. */
export interface InstrLine extends LineBase {
  kind: 'instr'
  mnemonic: string
  prefix?: string
}

/** `db` takes values and strings; `dw` values; `resb` and `resw` a count. */
export interface DataLine extends LineBase {
  kind: 'data'
  mnemonic: 'db' | 'dw' | 'resb' | 'resw'
}

/** A directive that emits nothing. `%define` has no operands: the parser has expanded it. */
export interface DirectiveLine extends LineBase {
  kind: 'directive'
  mnemonic: 'org' | 'bits' | 'align' | '%name' | '%author' | '%strategy' | '%version' | '%define'
}

/** `name equ value`: the label is the name, the one operand the value. */
export interface EquLine extends LineBase {
  kind: 'equ'
  mnemonic: 'equ'
  label: Label
}

/** `times count body`: the one operand is the count. */
export interface TimesLine extends LineBase {
  kind: 'times'
  mnemonic: 'times'
  body: InstrLine | DataLine
}

export type Line = EmptyLine | InstrLine | DataLine | DirectiveLine | EquLine | TimesLine
