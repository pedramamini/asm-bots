import { describe, expect, it } from 'bun:test'
import type { Expr } from '../src/ast'
import { type Condition, evaluateCondition, parseCondition } from '../src/condition'
import { Cursor } from '../src/cursor'
import type { Diag } from '../src/diag'
import { evaluate, parseExpr } from '../src/expr'
import { tokenize } from '../src/lexer'

/** The condition of `text`, or a failed test. */
function parsed(text: string): Condition {
  const p = parseCondition(text)
  if (!p.ok) throw new Error(`${text}: ${p.diag.col}: ${p.diag.message}`)
  return p.condition
}

/** The error of `text`, or a failed test. */
function failed(text: string): Diag {
  const p = parseCondition(text)
  if (p.ok) throw new Error(`${text} parsed as ${show(p.condition)}`)
  return p.diag
}

const error = (col: number, len: number, code: Diag['code'], message: string): Diag => ({
  severity: 'error',
  line: 1,
  col,
  len,
  message,
  code,
})

function expr(e: Expr): string {
  switch (e.kind) {
    case 'num':
      return String(e.value)
    case 'sym':
      return e.name
    case 'here':
      return '$'
    case 'origin':
      return '$$'
    case 'unary':
      return `(${e.op} ${expr(e.arg)})`
    case 'binary':
      return `(${e.op} ${expr(e.left)} ${expr(e.right)})`
  }
}

/** A condition as an S-expression; a value on its own is `[value]`. */
function show(c: Condition): string {
  switch (c.kind) {
    case 'value':
      return `[${expr(c.expr)}]`
    case 'compare':
      return `(${c.op} ${expr(c.left)} ${expr(c.right)})`
    case 'not':
      return `(! ${show(c.arg)})`
    case 'logic':
      return `(${c.op} ${show(c.left)} ${show(c.right)})`
  }
}

/** `text` evaluated with `symbols`, `$` = `here`. */
function holds(text: string, symbols: Record<string, number> = {}, here = 0) {
  return evaluateCondition(parsed(text), new Map(Object.entries(symbols)), here)
}

describe('parseCondition: grammar', () => {
  it('reads the example of the task: registers compared and joined', () => {
    expect(show(parsed('ax == 0x10 && cx < 3'))).toBe('(&& (== ax 16) (< cx 3))')
  })

  it('binds || loosest, then &&, then !, then the comparisons, then ISA §6.1', () => {
    expect(show(parsed('a <= 3 || b >= 4 && c != 5'))).toBe('(|| (<= a 3) (&& (>= b 4) (!= c 5)))')
    expect(show(parsed('!a == 1 && b > 2'))).toBe('(&& (! (== a 1)) (> b 2))')
    // Unlike C, a comparison binds looser than `&`, `|`, and the shifts.
    expect(show(parsed('ax & 0xFF == 0x10'))).toBe('(== (& ax 255) 16)')
    expect(show(parsed('ax | 1 != bx ^ 2'))).toBe('(!= (| ax 1) (^ bx 2))')
    expect(show(parsed('ax << 2 < 3'))).toBe('(< (<< ax 2) 3)')
    expect(show(parsed('1 + 2 * 3 > ax >> 1'))).toBe('(> (+ 1 (* 2 3)) (>> ax 1))')
  })

  it('associates && and || to the left', () => {
    expect(show(parsed('a && b && c'))).toBe('(&& (&& [a] [b]) [c])')
    expect(show(parsed('a || b || c'))).toBe('(|| (|| [a] [b]) [c])')
  })

  it('tells a group of conditions from a value in parentheses', () => {
    expect(show(parsed('(cx < 3 || dx == 0) && ax'))).toBe('(&& (|| (< cx 3) (== dx 0)) [ax])')
    expect(show(parsed('(ax + 1) * 2 == 4'))).toBe('(== (* (+ ax 1) 2) 4)')
    expect(show(parsed('((ax))'))).toBe('[ax]')
    expect(show(parsed('!(ax & 1)'))).toBe('(! [(& ax 1)])')
    expect(show(parsed('((a == 1)) || (b)'))).toBe('(|| (== a 1) [b])')
    expect(show(parsed('!!(a)'))).toBe('(! (! [a]))')
  })

  it('reads every register as a value, in any case, and keeps other names as written', () => {
    expect(show(parsed('AX + Bl == sI - dh'))).toBe('(== (+ ax bl) (- si dh))')
    expect(show(parsed('IP == zf'))).toBe('(== IP zf)')
    expect(show(parsed("al == 'A' && $ == $$ + 0b101 + 1Fh"))).toBe(
      '(&& (== al 65) (== $ (+ (+ $$ 5) 31)))',
    )
  })

  it('reads each operand with the parser of source, so its expression is the same', () => {
    for (const text of ['1 | 2 ^ 3 & 4 << 1 + 2 * 3', '-(x + 2) * ~y % 3', "$ - 'A' / 0x1F"]) {
      const c = parsed(text)
      expect(c.kind).toBe('value')
      if (c.kind === 'value') expect(c.expr).toEqual(parseExpr(new Cursor(tokenize(text), 1, '')))
    }
  })

  it('gives each node the span of its text, parentheses included', () => {
    expect(parsed('(ax == 1) && !bx')).toEqual({
      kind: 'logic',
      op: '&&',
      left: {
        kind: 'compare',
        op: '==',
        left: { kind: 'sym', name: 'ax', col: 2, len: 2 },
        right: { kind: 'num', value: 1, col: 8, len: 1 },
        col: 1,
        len: 9,
      },
      right: {
        kind: 'not',
        arg: { kind: 'value', expr: { kind: 'sym', name: 'bx', col: 15, len: 2 }, col: 15, len: 2 },
        col: 14,
        len: 3,
      },
      col: 1,
      len: 16,
    })
  })

  it('skips a comment, as source does', () => {
    expect(show(parsed('ax == 1 ; the first pass'))).toBe('(== ax 1)')
  })
})

describe('parseCondition: errors', () => {
  it('gives the lexer errors, and a hint for `=`', () => {
    expect(failed('ax = 1')).toEqual(error(4, 1, 'bad-char', '`=` alone: compare with `==`'))
    expect(failed('ax == 1 @')).toEqual(error(9, 1, 'bad-char', "unexpected character '@'"))
    expect(failed('ax == 1010b').code).toBe('bad-number')
  })

  it('takes one comparison at a time: a condition is not a value', () => {
    const chained = error(9, 2, 'syntax', '`==` compares values, not conditions')
    expect(failed('ax == 1 == 2')).toEqual(chained)
    expect(failed('(ax == 1) == 1')).toEqual({ ...chained, col: 11 })
    expect(failed('ax < bx > cx')).toEqual(
      error(9, 1, 'syntax', '`>` compares values, not conditions'),
    )
  })

  it('names what it expected, at the token it found', () => {
    expect(failed('ax 1')).toEqual(error(4, 1, 'syntax', 'expected an operator, found `1`'))
    expect(failed('')).toEqual(error(1, 0, 'syntax', 'expected an expression, found end of line'))
    expect(failed('ax ==')).toEqual(
      error(6, 0, 'syntax', 'expected an expression, found end of line'),
    )
    expect(failed('ax && || bx')).toEqual(
      error(7, 2, 'syntax', 'expected an expression, found `||`'),
    )
  })

  it('shows the error that got farther when a parenthesis reads neither way', () => {
    expect(failed('(ax == 1 && )')).toEqual(
      error(13, 1, 'syntax', 'expected an expression, found `)`'),
    )
    expect(failed('(ax + 1 == 2')).toEqual(
      error(13, 0, 'syntax', 'expected `)`, found end of line'),
    )
    expect(failed('(ax + 1')).toEqual(error(8, 0, 'syntax', 'expected `)`, found end of line'))
  })

  it('refuses a string and a line break', () => {
    expect(failed('al == "ab"').code).toBe('bad-operand')
    expect(failed('ax\n== 1')).toEqual(error(3, 1, 'syntax', 'a condition is one line'))
  })

  it('stops at its limits instead of overflowing the stack', () => {
    expect(failed(`${'!'.repeat(300)}ax`).message).toBe('condition is nested too deeply')
    expect(failed(`${'('.repeat(300)}ax == 1${')'.repeat(300)}`).message).toContain('deeply')
    expect(failed(Array(1100).fill('ax').join(' && ')).message).toBe('condition is too long')
    expect(show(parsed(Array(1000).fill('ax').join(' && '))).length).toBeGreaterThan(5000)
  })
})

describe('evaluateCondition', () => {
  it('holds when the registers match', () => {
    expect(holds('ax == 0x10 && cx < 3', { ax: 0x10, cx: 2 })).toBe(true)
    expect(holds('ax == 0x10 && cx < 3', { ax: 0x10, cx: 3 })).toBe(false)
    expect(holds('ax == 0x10 && cx < 3', { ax: 0x11, cx: 0 })).toBe(false)
  })

  it('compares every way', () => {
    const cases: [string, boolean][] = [
      ['5 == 5', true],
      ['5 != 5', false],
      ['4 < 5', true],
      ['5 < 5', false],
      ['5 <= 5', true],
      ['6 <= 5', false],
      ['6 > 5', true],
      ['5 > 5', false],
      ['5 >= 5', true],
      ['4 >= 5', false],
    ]
    for (const [text, want] of cases) expect([text, holds(text)]).toEqual([text, want])
  })

  it('wraps each value to a word and compares unsigned', () => {
    expect(holds('ax == -1', { ax: 0xffff })).toBe(true)
    expect(holds('ax < 0', { ax: 0xffff })).toBe(false)
    expect(holds('ax >= 0x8000', { ax: 0xffff })).toBe(true)
    expect(holds('0x10000 == 0')).toBe(true)
    expect(holds('ax * 2 == 0xFFFE', { ax: 0xffff })).toBe(true)
  })

  it('takes a value alone as true when it is not 0, and ! as its opposite', () => {
    expect(holds('cx', { cx: 0 })).toBe(false)
    expect(holds('cx', { cx: 0x100 })).toBe(true)
    expect(holds('!cx', { cx: 0 })).toBe(true)
    expect(holds('ax & 1', { ax: 3 })).toBe(true)
    expect(holds('0x10000')).toBe(false)
  })

  it('reads $ as `here`', () => {
    expect(holds('$ == 0x1234', {}, 0x1234)).toBe(true)
    expect(holds('$ + 2 == ip', { ip: 0x1236 }, 0x1234)).toBe(true)
  })

  it('evaluates the right side only when the left one does not decide', () => {
    expect(holds('cx != 0 && 100 / cx > 3', { cx: 0 })).toBe(false)
    expect(holds('cx == 0 || 100 / cx > 3', { cx: 0 })).toBe(true)
    expect(holds('cx != 0 && 100 / cx > 3', { cx: 10 })).toBe(true)
    expect(holds('ax == 1 || nowhere', { ax: 1 })).toBe(true)
  })

  it('gives Unresolved for a missing name and a division by zero, at its place', () => {
    expect(holds('ax == 1 && nowhere', { ax: 1 })).toMatchObject({
      kind: 'unresolved',
      code: 'undefined-symbol',
      symbol: 'nowhere',
      col: 12,
      len: 7,
    })
    expect(holds('!(100 / cx)', { cx: 0 })).toMatchObject({ code: 'div-zero', col: 9, len: 2 })
    expect(holds('ax > 100 % cx', { ax: 1, cx: 0 })).toMatchObject({ code: 'div-zero' })
  })

  it('agrees with evaluate on each operand', () => {
    const symbols = new Map([
      ['ax', 0x8001],
      ['bx', 7],
    ])
    for (const text of ['ax * 3 - bx', '~ax >> 2', '-bx % 3', 'ax / bx | 0x40']) {
      const c = parsed(`${text} == 0`)
      if (c.kind !== 'compare') throw new Error(text)
      const value = evaluate(c.left, symbols, 0) as number
      expect(holds(`${text} == ${value}`, Object.fromEntries(symbols))).toBe(true)
      expect(holds(`${text} != ${value}`, Object.fromEntries(symbols))).toBe(false)
    }
  })
})

describe('tokenize: condition operators', () => {
  const texts = (source: string, conditions: boolean) =>
    tokenize(source, [], { conditions }).map((t) => `${t.kind}:${t.text}`)

  it('reads them only with the option', () => {
    expect(texts('a==b!=c<=d>=e&&f||!g<h>i', true)).toEqual([
      'ident:a',
      'punct:==',
      'ident:b',
      'punct:!=',
      'ident:c',
      'punct:<=',
      'ident:d',
      'punct:>=',
      'ident:e',
      'punct:&&',
      'ident:f',
      'punct:||',
      'punct:!',
      'ident:g',
      'punct:<',
      'ident:h',
      'punct:>',
      'ident:i',
      'eof:',
    ])
    const diags: Diag[] = []
    expect(tokenize('a < b && c', diags).map((t) => t.text)).toEqual(['a', 'b', '&', '&', 'c', ''])
    expect(diags.map((d) => d.code)).toEqual(['bad-char'])
  })

  it('keeps the shifts, and leaves `=` alone an error', () => {
    expect(texts('a<<b>>c', true)).toEqual([
      'ident:a',
      'punct:<<',
      'ident:b',
      'punct:>>',
      'ident:c',
      'eof:',
    ])
    const diags: Diag[] = []
    tokenize('a = b', diags, { conditions: true })
    expect(diags.map((d) => d.code)).toEqual(['bad-char'])
  })
})
