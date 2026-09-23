import { describe, expect, it } from 'bun:test'
import type { Expr, RawExpr } from '../src/ast'
import { Cursor, ParseError } from '../src/cursor'
import type { Diag } from '../src/diag'
import { evaluate, findRegister, parseExpr, type Unresolved } from '../src/expr'
import { tokenize } from '../src/lexer'

/** `text` read as one whole expression, or the diagnostic. */
function read(text: string, scope = ''): RawExpr | Diag {
  const c = new Cursor(tokenize(text), 1, scope)
  try {
    const e = parseExpr(c)
    if (!c.atEnd) c.unexpected(c.peek(), 'end of line')
    return e
  } catch (e) {
    if (e instanceof ParseError) return e.diag
    throw e
  }
}

function parsed(text: string, scope = ''): Expr {
  const e = read(text, scope)
  if ('severity' in e) throw new Error(`${text}: ${e.message}`)
  expect(findRegister(e)).toBeUndefined()
  return e as Expr
}

/** An expression as an S-expression: `(+ 1 (* 2 3))`. */
function show(e: RawExpr): string {
  switch (e.kind) {
    case 'num':
      return String(e.value)
    case 'sym':
      return e.name
    case 'reg':
      return `%${e.name}`
    case 'here':
      return '$'
    case 'origin':
      return '$$'
    case 'unary':
      return `(${e.op} ${show(e.arg)})`
    case 'binary':
      return `(${e.op} ${show(e.left)} ${show(e.right)})`
  }
}

const computed = (text: string, symbols: Record<string, number> = {}, here = 0) =>
  evaluate(parsed(text), new Map(Object.entries(symbols)), here)

const error = (col: number, len: number, code: Diag['code'], message: string): Diag => ({
  severity: 'error',
  line: 1,
  col,
  len,
  message,
  code,
})

describe('parseExpr: grammar', () => {
  it('binds with C precedence, as NASM does', () => {
    // NASM 3.02 assembles `dw 1 | 2 ^ 3 & 4 << 1 + 2 * 3` to 3.
    const e = parsed('1 | 2 ^ 3 & 4 << 1 + 2 * 3')
    expect(show(e)).toBe('(| 1 (^ 2 (& 3 (<< 4 (+ 1 (* 2 3))))))')
    expect(evaluate(e, new Map(), 0)).toBe(3)
    expect(show(parsed('a * b + c % d - e / f'))).toBe('(- (+ (* a b) (% c d)) (/ e f))')
    expect(show(parsed('a >> 1 & b << 2 | c ^ d'))).toBe('(| (& (>> a 1) (<< b 2)) (^ c d))')
  })

  it('associates every binary operator to the left', () => {
    expect(show(parsed('10 - 3 - 2'))).toBe('(- (- 10 3) 2)')
    expect(show(parsed('64 / 4 / 2 % 3'))).toBe('(% (/ (/ 64 4) 2) 3)')
    expect(show(parsed('1 << 2 >> 3'))).toBe('(>> (<< 1 2) 3)')
    expect(show(parsed('a & b & c | d | e'))).toBe('(| (| (& (& a b) c) d) e)')
  })

  it('reads unary -, +, and ~, parentheses, and every atom', () => {
    expect(show(parsed('-2 * -3'))).toBe('(* (- 2) (- 3))')
    expect(show(parsed('- -~+5'))).toBe('(- (- (~ (+ 5))))')
    expect(show(parsed('-(1 + 2) * (3)'))).toBe('(* (- (+ 1 2)) 3)')
    expect(show(parsed("$ - $$ + 'A' + 0x1F + 1Fh + 0b101 + '\\n'"))).toBe(
      '(+ (+ (+ (+ (+ (- $ $$) 65) 31) 31) 5) 10)',
    )
  })

  it('stops at the first token that cannot continue the expression', () => {
    const c = new Cursor(tokenize('4 + 2 nop'), 1, '')
    expect(show(parseExpr(c))).toBe('(+ 4 2)')
    expect(c.peek().text).toBe('nop')
    const d = new Cursor(tokenize('2*8 ]'), 1, '')
    expect(show(parseExpr(d))).toBe('(* 2 8)')
    expect(d.peek().text).toBe(']')
  })

  it('names symbols in full: .local gets the scope, and $ escapes a reserved word', () => {
    expect(show(parsed('.loop + end - start.x', 'start'))).toBe('(- (+ start.loop end) start.x)')
    expect(show(parsed('.loop'))).toBe('.loop')
    expect(show(parsed('$ax + $.x + $$ + $', 'start'))).toBe('(+ (+ (+ ax start.x) $$) $)')
    expect(show(parsed('..@tmp', 'start'))).toBe('..@tmp')
  })

  it('reads registers as register atoms, case-insensitively, for memory operands', () => {
    const e = read('BX + si*2 + 4') as RawExpr
    expect(show(e)).toBe('(+ (+ %bx (* %si 2)) 4)')
    expect(findRegister(e)).toEqual({ kind: 'reg', name: 'bx', col: 1, len: 2 })
    expect(findRegister(read('4 + (2 * Di)') as RawExpr)).toEqual({
      kind: 'reg',
      name: 'di',
      col: 10,
      len: 2,
    })
  })

  it('gives each node the span of its source text, parentheses included', () => {
    expect(parsed('(1 + 2) * 3')).toEqual({
      kind: 'binary',
      op: '*',
      left: {
        kind: 'binary',
        op: '+',
        left: { kind: 'num', value: 1, col: 2, len: 1 },
        right: { kind: 'num', value: 2, col: 6, len: 1 },
        col: 1,
        len: 7,
      },
      right: { kind: 'num', value: 3, col: 11, len: 1 },
      col: 1,
      len: 11,
    })
    expect(parsed('\t-x')).toEqual({
      kind: 'unary',
      op: '-',
      arg: { kind: 'sym', name: 'x', col: 3, len: 1 },
      col: 2,
      len: 2,
    })
  })
})

describe('parseExpr: errors', () => {
  it('reports a missing operand or parenthesis at the end of the line', () => {
    expect(read('1 +')).toEqual(error(4, 0, 'syntax', 'expected an expression, found end of line'))
    expect(read('(1 + 2 ; c')).toEqual(error(7, 0, 'syntax', 'expected `)`, found end of line'))
    expect(read('')).toEqual(error(1, 0, 'syntax', 'expected an expression, found end of line'))
  })

  it('reports a token that cannot start an expression', () => {
    expect(read('* 3')).toEqual(error(1, 1, 'syntax', 'expected an expression, found `*`'))
    expect(read('1 + )')).toEqual(error(5, 1, 'syntax', 'expected an expression, found `)`'))
    expect(read('(1, 2)')).toEqual(error(3, 1, 'syntax', 'expected `)`, found `,`'))
    expect(read('2 + word 3')).toEqual(
      error(5, 4, 'syntax', 'expected an expression, found `word`'),
    )
    expect(read('SHORT')).toEqual(error(1, 5, 'syntax', 'expected an expression, found `SHORT`'))
  })

  it('reports a string, which cannot be a value', () => {
    const message = 'a string can only stand alone, as a `db` item or directive text'
    expect(read('"ab" + 1')).toEqual(error(1, 4, 'bad-operand', message))
    expect(read("'A' + 1")).not.toHaveProperty('severity')
  })

  it('reports NASM words x16c leaves out, and the $ hex prefix', () => {
    const segments = 'segment registers are not supported: x16c has one flat 64 KB address space'
    expect(read('es')).toEqual(error(1, 2, 'unsupported', segments))
    expect(read('1 + EAX')).toEqual(
      error(5, 3, 'unsupported', '`eax` is a 32-bit register; the 8086 has 16-bit and 8-bit ones'),
    )
    expect(read('far')).toEqual(
      error(1, 3, 'unsupported', 'far jumps and pointers are not supported: x16c has no segments'),
    )
    expect(read('$1F + 2')).toEqual(
      error(1, 3, 'bad-number', "NASM's `$` hex prefix is not supported: write 0x1F or 1Fh"),
    )
  })

  it('stops at a nesting or length limit instead of overflowing the stack', () => {
    const deep = `${'('.repeat(100_000)}1${')'.repeat(100_000)}`
    expect(read(deep)).toEqual(error(257, 1, 'syntax', 'expression is nested too deeply'))
    expect(read(`${'-'.repeat(300)}1`)).toMatchObject({ code: 'syntax', col: 257 })
    expect(read(`${'('.repeat(200)}1${')'.repeat(200)}`)).toMatchObject({ kind: 'num' })
    const chain = (n: number) => Array.from({ length: n + 1 }, () => '1').join('+')
    expect(evaluate(parsed(chain(1024)), new Map(), 0)).toBe(1025)
    expect(read(chain(1025))).toEqual(error(2050, 1, 'syntax', 'expression is too long'))
    expect(read(`1${'+1'.repeat(100_000)}`)).toMatchObject({ message: 'expression is too long' })
  })
})

describe('evaluate', () => {
  it('computes with intermediate values past 16 bits and wraps only the result', () => {
    expect(computed('0x8000 * 4 / 8')).toBe(0x4000)
    expect(computed('(0xFFFF + 1) / 2')).toBe(0x8000)
    expect(computed('0x12345 >> 4')).toBe(0x1234)
    expect(computed('0x10000 - 1')).toBe(0xffff)
    expect(computed('0x10000')).toBe(0)
    expect(computed('0x12345')).toBe(0x2345)
    expect(computed('9007199254740991')).toBe(0xffff)
  })

  it('wraps negative results into 0..0xFFFF', () => {
    expect(computed('-1')).toBe(0xffff)
    expect(computed('-0x8000')).toBe(0x8000)
    expect(computed('-0x10000')).toBe(0)
    expect(computed('0 - 7')).toBe(0xfff9)
    expect(computed('-0')).toBe(0)
    expect(computed('-(1 + 2)')).toBe(0xfffd)
  })

  it('divides like C: toward zero, remainder with the sign of the dividend', () => {
    expect(computed('7 / 2')).toBe(3)
    expect(computed('-7 / 2')).toBe(0xfffd)
    expect(computed('7 / -2')).toBe(0xfffd)
    expect(computed('-8 / 2')).toBe(0xfffc)
    expect(computed('7 % 3')).toBe(1)
    expect(computed('-7 % 3')).toBe(0xffff)
    expect(computed('7 % -3')).toBe(1)
  })

  it('shifts like NASM: the count mod 64, >> arithmetic', () => {
    expect(computed('1 << 15')).toBe(0x8000)
    expect(computed('1 << 16')).toBe(0)
    expect(computed('0x8000 >> 15')).toBe(1)
    // NASM 3.02: `dw -16 >> 2, -1 >> 48, 1 << 64, 1 >> 64, 1 << -1` is FFFC FFFF 0001 0001 0000.
    expect(computed('-16 >> 2')).toBe(0xfffc)
    expect(computed('-1 >> 48')).toBe(0xffff)
    expect(computed('1 << 64')).toBe(1)
    expect(computed('1 >> 64')).toBe(1)
    expect(computed('1 << -1')).toBe(0)
    expect(computed('3 << 100')).toBe(0)
  })

  it('does bitwise and unary math', () => {
    expect(computed('0xF0F0 & 0xFF00')).toBe(0xf000)
    expect(computed('0xF0 | 0x0F')).toBe(0xff)
    expect(computed('0xFF ^ 0x0F')).toBe(0xf0)
    expect(computed('~0')).toBe(0xffff)
    expect(computed('~0x80')).toBe(0xff7f)
    expect(computed('+5')).toBe(5)
    expect(computed('- -3')).toBe(3)
    expect(computed('-2 * -3')).toBe(6)
  })

  it('reads $ as the address of the line and $$ as 0', () => {
    expect(computed('$', {}, 0x40)).toBe(0x40)
    expect(computed('$$', {}, 0x40)).toBe(0)
    expect(computed('$ - $$', {}, 0x40)).toBe(0x40)
    expect(computed('$ + 0x200', {}, 0x40)).toBe(0x240)
    expect(computed('$ - 10', {}, 0)).toBe(0xfff6)
  })

  it('looks symbols up by full name', () => {
    const symbols = { start: 0x10, end: 0x30, 'start.loop': 0x14 }
    expect(computed('end - start', symbols)).toBe(0x20)
    expect(evaluate(parsed('.loop + 1', 'start'), new Map(Object.entries(symbols)), 0)).toBe(0x15)
    expect(computed("'A' + 1")).toBe(66)
  })

  it('reports the leftmost undefined symbol', () => {
    const unresolved = (col: number, len: number, name: string): Unresolved => ({
      kind: 'unresolved',
      code: 'undefined-symbol',
      message: `undefined symbol \`${name}\``,
      col,
      len,
    })
    expect(computed('x + 1')).toEqual(unresolved(1, 1, 'x'))
    expect(computed('1 + x * y')).toEqual(unresolved(5, 1, 'x'))
    expect(computed('a / 0 + b')).toEqual(unresolved(1, 1, 'a'))
    expect(evaluate(parsed('.nope', 'start'), new Map(), 0)).toEqual(unresolved(1, 5, 'start.nope'))
  })

  it('reports a division by zero at the divisor', () => {
    const divZero = (col: number, len: number): Unresolved => ({
      kind: 'unresolved',
      code: 'div-zero',
      message: 'division by zero',
      col,
      len,
    })
    expect(computed('1 / 0')).toEqual(divZero(5, 1))
    expect(computed('1 % 0')).toEqual(divZero(5, 1))
    expect(computed('4 / (x - x)', { x: 7 })).toEqual(divZero(5, 7))
    expect(computed('a / 0 + b', { a: 1 })).toEqual(divZero(5, 1))
    expect(computed('1 / -0')).toEqual(divZero(5, 2))
  })
})
