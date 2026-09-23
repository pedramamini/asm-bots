import type { BinaryOp, Expr, RawExpr, RegExpr, Span, UnaryOp } from './ast'
import type { Cursor } from './cursor'
import { join } from './cursor'
import { isRegister, isReserved, UNSUPPORTED } from './keywords'
import type { Token } from './lexer'

/** Binding power of each binary operator: C precedence (ISA §6.1). All are left-associative. */
const BINARY: ReadonlyMap<string, number> = new Map([
  ['|', 1],
  ['^', 2],
  ['&', 3],
  ['<<', 4],
  ['>>', 4],
  ['+', 5],
  ['-', 5],
  ['*', 6],
  ['/', 6],
  ['%', 6],
])

const UNARY: ReadonlySet<string> = new Set(['-', '+', '~'])

/** `t` is a binary operator, so an expression goes on past the token before it. */
export function isOperator(t: Token): boolean {
  return t.kind === 'punct' && BINARY.has(t.text)
}

/*
 * Limits for untrusted source (the API assembles submissions): past them an expression is an
 * error, not a stack overflow in the parser, the evaluator, or the address splitter.
 */
/** Parentheses and unary operators, nested. */
const MAX_DEPTH = 256
/** Operators in one expression. */
const MAX_NODES = 1024

interface State {
  readonly c: Cursor
  nodes: number
}

/**
 * Reads one expression (ISA §6.1) and stops at the first token that cannot continue it. Atoms are
 * numbers, character literals, symbols, `$`, `$$`, and registers, which only a memory operand may
 * keep. A syntax error throws through `c`.
 */
export function parseExpr(c: Cursor): RawExpr {
  return binary({ c, nodes: 0 }, 1, 0)
}

function count(s: State, at: Span) {
  if (++s.nodes > MAX_NODES) s.c.fail('syntax', 'expression is too long', at)
}

function binary(s: State, min: number, depth: number): RawExpr {
  let left = unary(s, depth)
  for (;;) {
    const t = s.c.peek()
    const power = t.kind === 'punct' ? BINARY.get(t.text) : undefined
    if (power === undefined || power < min) return left
    s.c.next()
    count(s, t)
    const right = binary(s, power + 1, depth)
    left = { kind: 'binary', op: t.text as BinaryOp, left, right, ...join(left, right) }
  }
}

function unary(s: State, depth: number): RawExpr {
  const { c } = s
  const t = c.next()
  if (depth >= MAX_DEPTH) c.fail('syntax', 'expression is nested too deeply', t)
  if (t.kind === 'punct' && UNARY.has(t.text)) {
    count(s, t)
    const arg = unary(s, depth + 1)
    return { kind: 'unary', op: t.text as UnaryOp, arg, ...join(t, arg) }
  }
  if (t.kind === 'punct' && t.text === '(') {
    const inner = binary(s, 1, depth + 1)
    const close = c.next()
    if (close.kind !== 'punct' || close.text !== ')') c.unexpected(close, '`)`')
    return { ...inner, ...join(t, close) }
  }
  if (t.kind === 'number' || t.kind === 'char') {
    return { kind: 'num', value: t.value, col: t.col, len: t.len }
  }
  if (t.kind === 'ident') return word(c, t)
  if (t.kind === 'string') {
    c.fail('bad-operand', 'a string can only stand alone, as a `db` item or directive text', t)
  }
  return c.unexpected(t, 'an expression')
}

function word(c: Cursor, t: Token): RawExpr {
  const span = { col: t.col, len: t.len }
  if (t.text === '$') return { kind: 'here', ...span }
  if (t.text === '$$') return { kind: 'origin', ...span }
  const lower = t.text.toLowerCase()
  if (isRegister(lower)) return { kind: 'reg', name: lower, ...span }
  const unsupported = UNSUPPORTED.get(lower)
  if (unsupported !== undefined) c.fail('unsupported', unsupported, t)
  if (isReserved(lower)) c.unexpected(t, 'an expression')
  return { kind: 'sym', name: c.name(t), ...span }
}

/** The first register in `e`, left to right. */
export function findRegister(e: RawExpr): RegExpr | undefined {
  switch (e.kind) {
    case 'reg':
      return e
    case 'unary':
      return findRegister(e.arg)
    case 'binary':
      return findRegister(e.left) ?? findRegister(e.right)
    default:
      return undefined
  }
}

/** Why an expression has no value: a symbol not defined (yet), or a division by zero. */
export interface Unresolved extends Span {
  readonly kind: 'unresolved'
  readonly code: 'undefined-symbol' | 'div-zero'
  readonly message: string
}

const unresolved = (code: Unresolved['code'], message: string, at: Span): Unresolved => ({
  kind: 'unresolved',
  code,
  message,
  col: at.col,
  len: at.len,
})

/** NASM takes a shift count mod 64, the way x86 does: `1 << 64` is 1. */
const shiftCount = (n: number) => ((n % 64) + 64) % 64

/**
 * The value of `expr` with `$` = `here` and `$$` = 0 (ISA §6.1). The math is on JS numbers, exact
 * for integers up to 2^53, with C semantics: `/` truncates toward zero, `%` takes the sign of the
 * dividend, `>>` is arithmetic. Only the result wraps, to 0..0xFFFF, so `0x8000 * 4 / 8` is
 * 0x4000. A symbol missing from `symbols`, or a division by zero, gives `Unresolved` at the
 * symbol or the divisor; when there are several, the leftmost.
 */
export function evaluate(
  expr: Expr,
  symbols: ReadonlyMap<string, number>,
  here: number,
): number | Unresolved {
  const v = value(expr, symbols, here)
  return typeof v === 'number' ? v & 0xffff : v
}

function value(e: Expr, symbols: ReadonlyMap<string, number>, here: number): number | Unresolved {
  switch (e.kind) {
    case 'num':
      return e.value
    case 'here':
      return here
    case 'origin':
      return 0
    case 'sym':
      return (
        symbols.get(e.name) ?? unresolved('undefined-symbol', `undefined symbol \`${e.name}\``, e)
      )
    case 'unary': {
      const a = value(e.arg, symbols, here)
      if (typeof a !== 'number') return a
      return e.op === '-' ? -a : e.op === '~' ? ~a : a
    }
    case 'binary': {
      const l = value(e.left, symbols, here)
      if (typeof l !== 'number') return l
      const r = value(e.right, symbols, here)
      if (typeof r !== 'number') return r
      return apply(e.op, l, r, e.right)
    }
  }
}

function apply(op: BinaryOp, l: number, r: number, divisor: Span): number | Unresolved {
  switch (op) {
    case '+':
      return l + r
    case '-':
      return l - r
    case '*':
      return l * r
    case '/':
      return r === 0 ? unresolved('div-zero', 'division by zero', divisor) : Math.trunc(l / r)
    case '%':
      return r === 0 ? unresolved('div-zero', 'division by zero', divisor) : l % r
    case '<<':
      return l * 2 ** shiftCount(r)
    case '>>':
      return Math.floor(l / 2 ** shiftCount(r))
    case '&':
      return l & r
    case '^':
      return l ^ r
    case '|':
      return l | r
  }
}
