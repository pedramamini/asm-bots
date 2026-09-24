/**
 * Breakpoint conditions (PRODUCT_SPEC §3): `ax == 0x10 && cx < 3`. `@asmbots/asm` reads them with
 * the parser of source (`parseCondition`); here each name becomes a place in a process: a register,
 * IP, FLAGS, or one flag, in any case. `$` is the process's IP.
 *
 * Values (`compileValue`): a watch's address and the memory panel's `goto` are one expression of
 * the same kind, `di + 4`, `bomb`, whose other names are the bot's labels.
 */
import {
  type Condition,
  type Expr,
  evaluate,
  evaluateCondition,
  parseCondition,
} from '@asmbots/asm'
import { AX, BP, BX, CX, DI, DX, FLAGS, getReg8, IP, type ProcRow, SI, SP } from '@asmbots/engine'

type Read = (row: ProcRow) => number

const word =
  (field: number): Read =>
  (row) =>
    row[field] as number

const byte =
  (code: number): Read =>
  (row) =>
    getReg8(row, code)

const flag =
  (bit: number): Read =>
  (row) =>
    ((row[FLAGS] as number) >> bit) & 1

/** Each name a condition can read, lowercase. The flags are the bits of FLAGS (ISA §1). */
const NAMES: ReadonlyMap<string, Read> = new Map([
  ['ax', word(AX)],
  ['bx', word(BX)],
  ['cx', word(CX)],
  ['dx', word(DX)],
  ['si', word(SI)],
  ['di', word(DI)],
  ['bp', word(BP)],
  ['sp', word(SP)],
  ['ip', word(IP)],
  ['flags', word(FLAGS)],
  ['al', byte(0)],
  ['cl', byte(1)],
  ['dl', byte(2)],
  ['bl', byte(3)],
  ['ah', byte(4)],
  ['ch', byte(5)],
  ['dh', byte(6)],
  ['bh', byte(7)],
  ['cf', flag(0)],
  ['pf', flag(2)],
  ['af', flag(4)],
  ['zf', flag(6)],
  ['sf', flag(7)],
  ['tf', flag(8)],
  ['if', flag(9)],
  ['df', flag(10)],
  ['of', flag(11)],
])

/** The names a condition can read, lowercase. */
export const CONDITION_NAMES: readonly string[] = [...NAMES.keys()]

/** A condition that parsed and names only what a process has. */
export interface CompiledCondition {
  /** As typed. */
  readonly text: string
  readonly condition: Condition
  /** The names it reads, lowercase, once each. */
  readonly names: readonly string[]
}

/** Why a text is not a condition, at a 1-based column of it. */
export interface ConditionError {
  readonly col: number
  readonly len: number
  readonly message: string
}

export type CompileResult =
  | { readonly ok: true; readonly compiled: CompiledCondition }
  | { readonly ok: false; readonly error: ConditionError }

/** `text` as a condition to test on processes, or the first thing wrong with it. */
export function compileCondition(text: string): CompileResult {
  const parsed = parseCondition(text)
  if (!parsed.ok) {
    const { col, len, message } = parsed.diag
    return { ok: false, error: { col, len, message } }
  }
  const names = new Set<string>()
  const unknown = nameAll(parsed.condition, names)
  if (unknown !== undefined) {
    const message = `\`${unknown.name}\` is not a register or a flag`
    return { ok: false, error: { col: unknown.col, len: unknown.len, message } }
  }
  return { ok: true, compiled: { text, condition: parsed.condition, names: [...names] } }
}

type Sym = Extract<Expr, { kind: 'sym' }>

/**
 * Puts each name of `c` in lowercase and in `names`. The tree is the caller's own, fresh from
 * the parser. Returns the first name that is not a place in a process.
 */
function nameAll(c: Condition, names: Set<string>): Sym | undefined {
  switch (c.kind) {
    case 'value':
      return nameExpr(c.expr, names)
    case 'compare':
      return nameExpr(c.left, names) ?? nameExpr(c.right, names)
    case 'not':
      return nameAll(c.arg, names)
    case 'logic':
      return nameAll(c.left, names) ?? nameAll(c.right, names)
  }
}

function nameExpr(e: Expr, names: Set<string>): Sym | undefined {
  switch (e.kind) {
    case 'sym': {
      const name = e.name.toLowerCase()
      if (!NAMES.has(name)) return e
      e.name = name
      names.add(name)
      return undefined
    }
    case 'unary':
      return nameExpr(e.arg, names)
    case 'binary':
      return nameExpr(e.left, names) ?? nameExpr(e.right, names)
    default:
      return undefined
  }
}

/**
 * Whether `c` holds for the process in `row`, or, when it cannot be evaluated there (a division
 * by zero), why not.
 */
export function testCondition(c: CompiledCondition, row: ProcRow): boolean | string {
  const values = new Map<string, number>()
  for (const name of c.names) values.set(name, (NAMES.get(name) as Read)(row))
  const held = evaluateCondition(c.condition, values, row[IP] as number)
  return typeof held === 'boolean' ? held : held.message
}

/** A value that parsed: an address to read. */
export interface CompiledValue {
  /** As typed. */
  readonly text: string
  readonly expr: Expr
  /** The names of a process it reads, lowercase, once each; its other names are labels. */
  readonly names: readonly string[]
}

export type CompileValueResult =
  | { readonly ok: true; readonly compiled: CompiledValue }
  | { readonly ok: false; readonly error: ConditionError }

/** `text` as one value (`di + 4`, `bomb`, `0x1A2F`), or the first thing wrong with it. */
export function compileValue(text: string): CompileValueResult {
  const parsed = parseCondition(text)
  if (!parsed.ok) {
    const { col, len, message } = parsed.diag
    return { ok: false, error: { col, len, message } }
  }
  const { condition } = parsed
  if (condition.kind !== 'value') {
    const message = 'an address is one value: this compares or joins values'
    return { ok: false, error: { col: condition.col, len: condition.len, message } }
  }
  const names = new Set<string>()
  nameRegisters(condition.expr, names)
  return { ok: true, compiled: { text, expr: condition.expr, names: [...names] } }
}

/** Puts each name of `e` that is a place in a process in lowercase and in `names`. */
function nameRegisters(e: Expr, names: Set<string>): void {
  switch (e.kind) {
    case 'sym': {
      const name = e.name.toLowerCase()
      if (!NAMES.has(name)) return
      e.name = name
      names.add(name)
      return
    }
    case 'unary':
      nameRegisters(e.arg, names)
      return
    case 'binary':
      nameRegisters(e.left, names)
      nameRegisters(e.right, names)
      return
    default:
      return
  }
}

/**
 * The value of `c` for the process in `row`, a word, with `labels` for the names that are not a
 * register; or, when it has none (a name that is no label, a division by zero), why not.
 */
export function evaluateValue(
  c: CompiledValue,
  row: ProcRow,
  labels: ReadonlyMap<string, number>,
): number | string {
  const values = new Map(labels)
  for (const name of c.names) values.set(name, (NAMES.get(name) as Read)(row))
  const v = evaluate(c.expr, values, row[IP] as number)
  return typeof v === 'number' ? v : v.message
}
