import type {
  DataLine,
  DirectiveLine,
  EmptyLine,
  Expr,
  ImmAst,
  InstrLine,
  Label,
  Line,
  MemAst,
  OperandAst,
  RawExpr,
  RegName,
  Size,
  Span,
} from './ast'
import { Cursor, join, ParseError } from './cursor'
import { Defines } from './define'
import type { Diag } from './diag'
import { evaluate, findRegister, isOperator, parseExpr } from './expr'
import {
  BYTE_REGISTERS,
  DATA_WORDS,
  DIRECTIVE_WORDS,
  isRegister,
  isReserved,
  META_WORDS,
  MNEMONIC_WORDS,
  PREFIX_WORDS,
  SIZES,
  startsStatement,
  TARGET_WORDS,
  UNSUPPORTED,
  unsupportedDirective,
} from './keywords'
import type { Token } from './lexer'

export interface Parsed {
  /** One per source line, in order: `lines[i].line === i + 1`. */
  lines: Line[]
  diags: Diag[]
}

const INVALID_ADDRESS = 'invalid effective address (8086 allows bx/bp + si/di + disp)'
const FAR = 'far pointers (segment:offset) are not supported: x16c has no segments'
const NO_SYMBOLS: ReadonlyMap<string, number> = new Map()

/**
 * Parses the tokens of `tokenize` into one `Line` per source line (ISA §6), expanding `%define`
 * macros first. It never stops: the first error on a line goes to `diags` and the line becomes
 * `empty`, keeping its label if the label was sound. `.local` names come out as full names
 * (`start.loop`). Values are left to the assembler, except that `org` must be 0 and `bits` 16.
 * Comment tokens are skipped.
 */
export function parse(tokens: readonly Token[]): Parsed {
  const lines: Line[] = []
  const diags: Diag[] = []
  const state: LineState = { scope: '', defines: new Defines() }
  const all = withEof(tokens.filter((t) => t.kind !== 'comment'))
  let start = 0
  for (let n = 1; ; n++) {
    let end = start
    while (!isEnd(all[end] as Token)) end++
    try {
      lines.push(parseLine(all.slice(start, end + 1), n, state))
    } catch (e) {
      if (!(e instanceof ParseError)) throw e
      diags.push(e.diag)
      lines.push(empty(n, state.label))
    }
    if (all[end]?.kind === 'eof') return { lines, diags }
    start = end + 1
  }
}

/** What carries from line to line, and the label of the line being parsed. */
interface LineState {
  scope: string
  defines: Defines
  label?: Label | undefined
}

const isEnd = (t: Token) => t.kind === 'newline' || t.kind === 'eof'

/** `tokens` ending in `eof`, as `tokenize` makes them. */
function withEof(tokens: readonly Token[]): readonly Token[] {
  const last = tokens.at(-1)
  if (last?.kind === 'eof') return tokens
  const at =
    last === undefined ? { line: 1, col: 1 } : { line: last.line, col: last.col + last.len }
  return [...tokens, { kind: 'eof', text: '', ...at, len: 0 }]
}

/** The lowercase text of an identifier; `''` for any other token. */
const keyword = (t: Token) => (t.kind === 'ident' ? t.text.toLowerCase() : '')

const isPunct = (t: Token, text: string) => t.kind === 'punct' && t.text === text

/** `{ key: value }`, or nothing when the value is undefined (exactOptionalPropertyTypes). */
function opt<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V }
}

function empty(line: number, label: Label | undefined): EmptyLine {
  return { line, kind: 'empty', ...opt('label', label), operands: [], col: 1, len: 0 }
}

function parseLine(tokens: readonly Token[], line: number, state: LineState): Line {
  state.label = undefined
  const first = tokens[0] as Token
  if (first.kind === 'directive' && first.text.toLowerCase() === '%define') {
    const c = new Cursor(tokens, line, state.scope)
    state.defines.define(c)
    return { line, kind: 'directive', mnemonic: '%define', operands: [], ...join(first, c.last) }
  }
  const c = new Cursor(
    state.defines.expand(tokens, new Cursor(tokens, line, '')),
    line,
    state.scope,
  )
  if (c.peek().kind === 'directive') return percent(c)
  const label = parseLabel(c)
  state.scope = c.scope
  state.label = label
  if (c.atEnd) return empty(line, label)
  return statement(c, label)
}

/**
 * A label: a word and a colon, or, as NASM allows, a word right before a statement keyword
 * (`msg db 1`, `size equ 4`).
 */
function parseLabel(c: Cursor): Label | undefined {
  const t = c.peek()
  if (t.kind !== 'ident') return undefined
  const word = t.text.toLowerCase()
  const next = c.peek(1)
  const colon = isPunct(next, ':')
  if (!colon && (startsStatement(word) || !startsStatement(keyword(next)))) return undefined
  const unsupported = UNSUPPORTED.get(word)
  if (unsupported !== undefined) c.fail('unsupported', unsupported, t)
  if (t.text === '$' || t.text === '$$' || isReserved(word)) {
    const what = isRegister(word) ? 'a register' : 'a reserved word'
    c.fail('bad-label', `\`${t.text}\` is ${what}, not a label name`, t)
  }
  c.next()
  if (colon) c.next()
  const name = c.name(t)
  // NASM: an `equ` name, and a `..@name`, leave `.local` names where they were.
  const local = t.text.replace(/^\$/, '').startsWith('.')
  if (!local && keyword(c.peek()) !== 'equ') c.scope = name
  return { name, col: t.col, len: t.len }
}

/** A `%name`-style line; `%define` never gets here. */
function percent(c: Cursor): DirectiveLine {
  const t = c.next()
  const word = t.text.toLowerCase()
  if (!META_WORDS.has(word)) c.fail('unsupported', unsupportedDirective(t.text), t)
  const s = c.next()
  if (s.kind !== 'string' && s.kind !== 'char') {
    c.fail('bad-directive', `\`${word}\` needs a quoted string: \`${word} "..."\``, c.where(s))
  }
  expectEnd(c)
  const value = s.kind === 'string' ? s.value : String.fromCharCode(s.value)
  return {
    line: c.line,
    kind: 'directive',
    mnemonic: word as DirectiveLine['mnemonic'],
    operands: [{ kind: 'str', value, col: s.col, len: s.len }],
    ...join(t, c.last),
  }
}

/** The statement after the label: anything but a `%` directive. */
function statement(c: Cursor, label: Label | undefined): Line {
  const t = c.peek()
  const word = keyword(t)
  const { line } = c
  const labeled = opt('label', label)
  if (word === 'equ') {
    if (label === undefined) c.fail('bad-directive', '`equ` needs a name: `size equ 4`', t)
    c.next()
    const value = immediate(c)
    expectEnd(c)
    return { line, kind: 'equ', label, mnemonic: 'equ', operands: [value], ...join(t, c.last) }
  }
  if (word === 'times') {
    c.next()
    const count = immediate(c)
    const body = repeatable(c, undefined, true)
    const span = join(t, c.last)
    return { line, kind: 'times', ...labeled, mnemonic: 'times', operands: [count], body, ...span }
  }
  if (DIRECTIVE_WORDS.has(word)) {
    c.next()
    const value = immediate(c)
    expectEnd(c)
    const want = word === 'org' ? 0 : word === 'bits' ? 16 : undefined
    if (want !== undefined && evaluate(value.expr, NO_SYMBOLS, 0) !== want) {
      const message =
        word === 'org'
          ? '`org` must be 0: bots are position independent (ISA §6.4)'
          : '`bits` must be 16: x16c is 8086 code'
      c.fail('bad-directive', message, value)
    }
    const mnemonic = word as DirectiveLine['mnemonic']
    return { line, kind: 'directive', ...labeled, mnemonic, operands: [value], ...join(t, c.last) }
  }
  if (isPunct(t, '[') && label === undefined) {
    c.fail('unsupported', 'the bracket form of a directive is not supported: drop the [ ]', t)
  }
  return repeatable(c, label, false)
}

/** An instruction or data: what `times` can repeat. */
function repeatable(c: Cursor, label: Label | undefined, inTimes: boolean): InstrLine | DataLine {
  const t = c.peek()
  if (t.kind !== 'ident') {
    c.unexpected(t, inTimes ? 'an instruction or data to repeat' : 'an instruction')
  }
  const word = t.text.toLowerCase()
  const { line } = c
  const labeled = opt('label', label)
  if (PREFIX_WORDS.has(word)) {
    c.next()
    const m = c.peek()
    const mnemonic = keyword(m)
    if (!MNEMONIC_WORDS.has(mnemonic)) c.unexpected(m, `an instruction after \`${t.text}\``)
    c.next()
    const operands = list(c, TARGET_WORDS.has(mnemonic))
    const span = join(t, c.last)
    return { line, kind: 'instr', ...labeled, prefix: word, mnemonic, operands, ...span }
  }
  if (MNEMONIC_WORDS.has(word)) {
    c.next()
    const operands = list(c, TARGET_WORDS.has(word))
    return { line, kind: 'instr', ...labeled, mnemonic: word, operands, ...join(t, c.last) }
  }
  if (DATA_WORDS.has(word)) {
    c.next()
    const mnemonic = word as DataLine['mnemonic']
    const operands = data(c, mnemonic)
    return { line, kind: 'data', ...labeled, mnemonic, operands, ...join(t, c.last) }
  }
  if (inTimes && (DIRECTIVE_WORDS.has(word) || word === 'equ' || word === 'times')) {
    c.fail('bad-directive', `\`times\` repeats an instruction or data, not \`${t.text}\``, t)
  }
  const unsupported = UNSUPPORTED.get(word)
  if (unsupported !== undefined) c.fail('unsupported', unsupported, t)
  const lone = !inTimes && label === undefined && isEnd(c.peek(1))
  const hint = lone ? ` (if it is a label, add a colon: \`${t.text}:\`)` : ''
  return c.fail('unknown-mnemonic', `unknown mnemonic \`${t.text}\`${hint}`, t)
}

function expectEnd(c: Cursor) {
  if (!c.atEnd) c.unexpected(c.peek(), 'end of line')
}

/** Instruction operands: none, or a comma-separated list to the end of the line. */
function list(c: Cursor, target: boolean): OperandAst[] {
  const operands: OperandAst[] = []
  if (c.atEnd) return operands
  for (;;) {
    operands.push(operand(c, target))
    if (c.atEnd) return operands
    const t = c.next()
    if (isPunct(t, ':')) c.fail('unsupported', FAR, t)
    if (!isPunct(t, ',')) c.unexpected(t, '`,` or end of line')
  }
}

/** `db` items (values and strings), `dw` values, or the count of `resb` and `resw`. */
function data(c: Cursor, word: DataLine['mnemonic']): OperandAst[] {
  if (word === 'resb' || word === 'resw') {
    const count = immediate(c)
    expectEnd(c)
    return [count]
  }
  const items: OperandAst[] = []
  for (;;) {
    const t = c.peek()
    const next = c.peek(1)
    const alone = isEnd(next) || isPunct(next, ',')
    if (alone && t.kind === 'string' && word === 'dw') {
      c.fail('bad-operand', '`dw` takes numbers; a string goes in `db`', t)
    }
    if (alone && word === 'db' && (t.kind === 'string' || t.kind === 'char')) {
      c.next()
      const value = t.kind === 'string' ? t.value : String.fromCharCode(t.value)
      items.push({ kind: 'str', value, col: t.col, len: t.len })
    } else {
      items.push(immediate(c))
    }
    if (c.atEnd) return items
    const sep = c.next()
    if (!isPunct(sep, ',')) c.unexpected(sep, '`,` or end of line')
  }
}

/** A value with no size keyword: a count, an `equ`, a `db` item. */
function immediate(c: Cursor): ImmAst {
  const first = c.peek()
  const expr = valueExpr(c, parseExpr(c))
  return { kind: 'imm', expr, ...join(first, c.last) }
}

/** `raw`, which must hold no register. */
function valueExpr(c: Cursor, raw: RawExpr): Expr {
  const reg = findRegister(raw)
  if (reg !== undefined) {
    c.fail(
      'bad-operand',
      `\`${reg.name}\` cannot be part of a value; registers go in [ ] addresses`,
      reg,
    )
  }
  return raw as Expr
}

/**
 * One instruction operand (ISA §6.3): a register, `[address]`, a value, or, for a mnemonic that
 * takes a relative target, an address to go to. Before it may come `byte` or `word`, `strict`
 * and a size (immediates), or `short` or `near` (targets).
 */
function operand(c: Cursor, target: boolean): OperandAst {
  const first = c.peek()
  let t = first
  let strict: Token | undefined
  let sized: Token | undefined
  let hint: Token | undefined
  if (keyword(t) === 'strict') {
    strict = c.next()
    t = c.peek()
    if (!SIZES.has(keyword(t))) c.unexpected(t, '`byte` or `word` after `strict`')
  }
  if (SIZES.has(keyword(t))) {
    sized = c.next()
    t = c.peek()
  }
  if (keyword(t) === 'short' || keyword(t) === 'near') {
    hint = c.next()
    t = c.peek()
    if (!target) c.fail('bad-operand', `\`${hint.text}\` applies only to a jump target`, hint)
  }
  const size = sized === undefined ? undefined : SIZES.get(keyword(sized))
  const reg = keyword(t)
  const direct = !isPunct(t, '[') && !(isRegister(reg) && !isOperator(c.peek(1)))
  if (hint !== undefined && !direct) {
    c.fail(
      'bad-operand',
      `\`${hint.text}\` needs an address after it: \`jmp ${hint.text} label\``,
      hint,
    )
  }
  if (strict !== undefined && !(direct && !target)) {
    c.fail('bad-operand', '`strict` applies only to an immediate: `add ax, strict word 5`', strict)
  }
  if (sized !== undefined && hint !== undefined) {
    c.fail('bad-operand', `\`${sized.text}\` and \`${hint.text}\` do not go together`, sized)
  }
  if (isPunct(t, '[')) return memory(c, first, size)
  if (!direct && isRegister(reg)) {
    c.next()
    const regSize: Size = BYTE_REGISTERS.has(reg) ? 8 : 16
    if (sized !== undefined && size !== regSize) {
      const kind = regSize === 8 ? 'byte' : 'word'
      c.fail(
        'bad-operand',
        `\`${sized.text}\` does not fit \`${t.text}\`, a ${kind} register`,
        sized,
      )
    }
    return { kind: 'reg', name: reg as RegName, ...join(first, t) }
  }
  const expr = valueExpr(c, parseExpr(c))
  const span = join(first, c.last)
  if (!target) {
    const pinned = strict === undefined ? undefined : (true as const)
    return { kind: 'imm', expr, ...opt('size', size), ...opt('strict', pinned), ...span }
  }
  if (sized !== undefined) {
    c.fail('bad-operand', `a jump target takes \`short\` or \`near\`, not \`${sized.text}\``, sized)
  }
  const kind = hint === undefined ? 'auto' : (keyword(hint) as 'short' | 'near')
  return { kind: 'target', expr, hint: kind, ...span }
}

/** `[...]`, with the data size given before it and an optional displacement size inside. */
function memory(c: Cursor, first: Token, size: Size | undefined): MemAst {
  c.next()
  const dispSize = SIZES.get(keyword(c.peek()))
  if (dispSize !== undefined) c.next()
  const raw = parseExpr(c)
  const close = c.next()
  if (!isPunct(close, ']')) c.unexpected(close, '`]`')
  const { base, index, disp } = address(c, raw, close)
  return {
    kind: 'mem',
    ...opt('base', base),
    ...opt('index', index),
    disp,
    ...opt('size', size),
    ...opt('dispSize', dispSize),
    ...join(first, close),
  }
}

interface Term {
  e: RawExpr
  neg: boolean
}

/** The `+`/`-` terms of `e`, through parentheses and unary signs, with the sign of each. */
function terms(e: RawExpr, neg: boolean, out: Term[]): Term[] {
  if (e.kind === 'binary' && (e.op === '+' || e.op === '-')) {
    terms(e.left, neg, out)
    terms(e.right, e.op === '-' ? !neg : neg, out)
  } else if (e.kind === 'unary' && (e.op === '+' || e.op === '-')) {
    terms(e.arg, e.op === '-' ? !neg : neg, out)
  } else {
    out.push({ e, neg })
  }
  return out
}

/**
 * Splits an address (ISA §6.3) into at most one base (`bx`, `bp`), one index (`si`, `di`), and
 * the displacement: the sum of the other terms, in any order. A register anywhere else, or
 * subtracted, is an error at that register.
 */
function address(
  c: Cursor,
  raw: RawExpr,
  close: Span,
): { base?: 'bx' | 'bp' | undefined; index?: 'si' | 'di' | undefined; disp: Expr } {
  let base: 'bx' | 'bp' | undefined
  let index: 'si' | 'di' | undefined
  let disp: Expr | undefined
  for (const { e, neg } of terms(raw, false, [])) {
    if (e.kind === 'reg') {
      const { name } = e
      if (neg) c.fail('invalid-address', INVALID_ADDRESS, e)
      if ((name === 'bx' || name === 'bp') && base === undefined) base = name
      else if ((name === 'si' || name === 'di') && index === undefined) index = name
      else c.fail('invalid-address', INVALID_ADDRESS, e)
      continue
    }
    const reg = findRegister(e)
    if (reg !== undefined) c.fail('invalid-address', INVALID_ADDRESS, reg)
    const term = e as Expr
    if (disp === undefined) {
      disp = neg ? { kind: 'unary', op: '-', arg: term, col: term.col, len: term.len } : term
    } else {
      disp = { kind: 'binary', op: neg ? '-' : '+', left: disp, right: term, ...join(disp, term) }
    }
  }
  return { base, index, disp: disp ?? { kind: 'num', value: 0, col: close.col, len: 0 } }
}
