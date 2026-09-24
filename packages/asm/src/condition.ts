/**
 * Conditions: the expressions of ISA §6.1 compared and joined, for the debugger's conditional
 * breakpoints (`ax == 0x10 && cx < 3`). The operands are the assembler's own expressions, read
 * by the same parser, so a number, an operator, and a precedence mean what they mean in source.
 * Registers are values here, not address parts: each becomes a symbol of its lowercase name, and
 * the caller evaluates the condition with a table of register values.
 */
import type { Expr, RawExpr, Span } from './ast'
import { Cursor, join, ParseError } from './cursor'
import type { Diag } from './diag'
import { evaluate, parseExpr, type Unresolved } from './expr'
import { type Token, tokenize } from './lexer'

export type CompareOp = '==' | '!=' | '<' | '<=' | '>' | '>='
export type LogicOp = '&&' | '||'

/** A value on its own: true when it is not 0. */
export interface ValueCondition extends Span {
  kind: 'value'
  expr: Expr
}

/** Two values compared, as unsigned words. */
export interface CompareCondition extends Span {
  kind: 'compare'
  op: CompareOp
  left: Expr
  right: Expr
}

export interface NotCondition extends Span {
  kind: 'not'
  arg: Condition
}

/** `&&` and `||`. The right side is evaluated only when the left one does not decide. */
export interface LogicCondition extends Span {
  kind: 'logic'
  op: LogicOp
  left: Condition
  right: Condition
}

/** A parsed condition. A node's span covers its text, parentheses included. */
export type Condition = ValueCondition | CompareCondition | NotCondition | LogicCondition

/** A condition, or why the text is not one. */
export type ParsedCondition =
  | { readonly ok: true; readonly condition: Condition }
  | { readonly ok: false; readonly diag: Diag }

const COMPARE: ReadonlySet<string> = new Set(['==', '!=', '<', '<=', '>', '>='])

/** Limits, as for expressions: past them a condition is an error, not a stack overflow. */
const MAX_DEPTH = 256
const MAX_NODES = 1024

interface State {
  nodes: number
}

/** A limit reached. The parser never reads the text another way after one. */
class LimitError extends ParseError {}

function limit(c: Cursor, message: string, at: Span): never {
  const { line } = c
  throw new LimitError({
    severity: 'error',
    line,
    col: at.col,
    len: at.len,
    message,
    code: 'syntax',
  })
}

const isPunct = (t: Token, text: string) => t.kind === 'punct' && t.text === text

/**
 * Parses one condition (see the package README): values compared with `== != < <= > >=`, joined
 * with `&&` and `||`, negated with `!`, and grouped with parentheses. Precedence, loosest first:
 * `||`, `&&`, `!`, the comparisons, then the operators of ISA §6.1, so `ax & 0xFF == 0x10` is
 * `(ax & 0xFF) == 0x10`. A value on its own is true when it is not 0. The result has the first
 * error, at its column on line 1.
 */
export function parseCondition(text: string): ParsedCondition {
  const diags: Diag[] = []
  const tokens = tokenize(text, diags, { conditions: true })
  const lineBreak = tokens.find((t) => t.kind === 'newline')
  if (lineBreak !== undefined) {
    const { line, col } = lineBreak
    const message = 'a condition is one line'
    return { ok: false, diag: { severity: 'error', line, col, len: 1, message, code: 'syntax' } }
  }
  const first = diags[0]
  if (first !== undefined) {
    const equals = first.code === 'bad-char' && text.charAt(first.col - 1) === '='
    return {
      ok: false,
      diag: equals ? { ...first, message: '`=` alone: compare with `==`' } : first,
    }
  }
  const c = new Cursor(tokens, 1, '')
  try {
    const condition = or(c, { nodes: 0 }, 0)
    const t = c.peek()
    if (t.kind === 'punct' && COMPARE.has(t.text)) {
      c.fail('syntax', `\`${t.text}\` compares values, not conditions`, t)
    }
    if (!c.atEnd) c.unexpected(t, 'an operator')
    return { ok: true, condition }
  } catch (e) {
    if (e instanceof ParseError) return { ok: false, diag: e.diag }
    throw e
  }
}

function count(c: Cursor, s: State, at: Span): void {
  if (++s.nodes > MAX_NODES) limit(c, 'condition is too long', at)
}

function or(c: Cursor, s: State, depth: number): Condition {
  let left = and(c, s, depth)
  while (isPunct(c.peek(), '||')) {
    count(c, s, c.next())
    const right = and(c, s, depth)
    left = { kind: 'logic', op: '||', left, right, ...join(left, right) }
  }
  return left
}

function and(c: Cursor, s: State, depth: number): Condition {
  let left = unary(c, s, depth)
  while (isPunct(c.peek(), '&&')) {
    count(c, s, c.next())
    const right = unary(c, s, depth)
    left = { kind: 'logic', op: '&&', left, right, ...join(left, right) }
  }
  return left
}

function unary(c: Cursor, s: State, depth: number): Condition {
  const t = c.peek()
  if (depth >= MAX_DEPTH) limit(c, 'condition is nested too deeply', t)
  if (isPunct(t, '!')) {
    count(c, s, c.next())
    const arg = unary(c, s, depth + 1)
    return { kind: 'not', arg, ...join(t, arg) }
  }
  if (!isPunct(t, '(')) return comparison(c, s)
  // `(` opens a group of conditions, `(cx < 3 || dx == 0)`, or a value, `(ax + 1) * 2 == 4`: try
  // the group, and read a comparison when it is not one. Should both fail, the error that got
  // farther is the one to show.
  const at = c.mark()
  const nodes = s.nodes
  let groupError: ParseError | undefined
  try {
    const group = parenthesized(c, s, depth)
    if (group !== undefined) return group
  } catch (e) {
    if (!(e instanceof ParseError) || e instanceof LimitError) throw e
    groupError = e
  }
  c.rewind(at)
  s.nodes = nodes
  try {
    return comparison(c, s)
  } catch (e) {
    if (!(e instanceof ParseError) || groupError === undefined) throw e
    throw groupError.diag.col > e.diag.col ? groupError : e
  }
}

/** A condition in parentheses, or undefined when what they hold is a value. */
function parenthesized(c: Cursor, s: State, depth: number): Condition | undefined {
  const open = c.next()
  const inner = or(c, s, depth + 1)
  const close = c.next()
  if (!isPunct(close, ')')) c.unexpected(close, '`)`')
  return inner.kind === 'value' ? undefined : { ...inner, ...join(open, close) }
}

function comparison(c: Cursor, s: State): Condition {
  const left = values(parseExpr(c))
  const t = c.peek()
  if (t.kind !== 'punct' || !COMPARE.has(t.text)) {
    return { kind: 'value', expr: left, ...span(left) }
  }
  count(c, s, c.next())
  const right = values(parseExpr(c))
  return { kind: 'compare', op: t.text as CompareOp, left, right, ...join(left, right) }
}

const span = (e: Span): Span => ({ col: e.col, len: e.len })

/** `e` with each register a symbol of its name. */
function values(e: RawExpr): Expr {
  switch (e.kind) {
    case 'reg':
      return { kind: 'sym', name: e.name, ...span(e) }
    case 'unary':
      return { kind: 'unary', op: e.op, arg: values(e.arg), ...span(e) }
    case 'binary':
      return { kind: 'binary', op: e.op, left: values(e.left), right: values(e.right), ...span(e) }
    default:
      return e
  }
}

/**
 * Whether `condition` holds, with `symbols` for the names in it (the registers, as their
 * lowercase names) and `here` for `$`. Each value wraps to a word (0..0xFFFF), and comparisons
 * are unsigned: `ax == -1` is `ax == 0xFFFF`. `&&` and `||` evaluate their right side only when
 * the left one does not decide, so `cx != 0 && 100 / cx > 3` never divides by zero. A name not in
 * `symbols`, or a division by zero, gives `Unresolved`.
 */
export function evaluateCondition(
  condition: Condition,
  symbols: ReadonlyMap<string, number>,
  here: number,
): boolean | Unresolved {
  switch (condition.kind) {
    case 'value': {
      const v = evaluate(condition.expr, symbols, here)
      return typeof v === 'number' ? v !== 0 : v
    }
    case 'compare': {
      const l = evaluate(condition.left, symbols, here)
      if (typeof l !== 'number') return l
      const r = evaluate(condition.right, symbols, here)
      if (typeof r !== 'number') return r
      return compare(condition.op, l, r)
    }
    case 'not': {
      const v = evaluateCondition(condition.arg, symbols, here)
      return typeof v === 'boolean' ? !v : v
    }
    case 'logic': {
      const l = evaluateCondition(condition.left, symbols, here)
      if (typeof l !== 'boolean' || l === (condition.op === '||')) return l
      return evaluateCondition(condition.right, symbols, here)
    }
  }
}

function compare(op: CompareOp, l: number, r: number): boolean {
  switch (op) {
    case '==':
      return l === r
    case '!=':
      return l !== r
    case '<':
      return l < r
    case '<=':
      return l <= r
    case '>':
      return l > r
    case '>=':
      return l >= r
  }
}
