/**
 * Breakpoint conditions over a process (`src/features/editor/debug/condition.ts`): the names a
 * condition reads, and their values in a process row.
 */
import { describe, expect, it } from 'bun:test'
import { AF, AX, BX, CF, CX, DF, FLAGS, IP, OF, PF, PROC_FIELDS, SF, SP, ZF } from '@asmbots/engine'
import {
  CONDITION_NAMES,
  type CompiledCondition,
  compileCondition,
  testCondition,
} from '../src/features/editor/debug/condition'

function compiled(text: string): CompiledCondition {
  const c = compileCondition(text)
  if (!c.ok) throw new Error(`${text}: ${c.error.col}: ${c.error.message}`)
  return c.compiled
}

/** A process row with `fields` set. */
function row(fields: Record<number, number>): Uint16Array {
  const r = new Uint16Array(PROC_FIELDS)
  for (const [k, v] of Object.entries(fields)) r[Number(k)] = v
  return r
}

const holds = (text: string, fields: Record<number, number>) =>
  testCondition(compiled(text), row(fields))

describe('compileCondition', () => {
  it('reads the registers, IP, FLAGS, and each flag, in any case', () => {
    expect(CONDITION_NAMES).toEqual([
      'ax',
      'bx',
      'cx',
      'dx',
      'si',
      'di',
      'bp',
      'sp',
      'ip',
      'flags',
      'al',
      'cl',
      'dl',
      'bl',
      'ah',
      'ch',
      'dh',
      'bh',
      'cf',
      'pf',
      'af',
      'zf',
      'sf',
      'tf',
      'if',
      'df',
      'of',
    ])
    const c = compiled('AX == 0x10 && Ip > 3 || ZF && ax')
    expect(c.names).toEqual(['ax', 'ip', 'zf'])
    expect(c.text).toBe('AX == 0x10 && Ip > 3 || ZF && ax')
  })

  it('names the first name that is not a place in a process, at its column', () => {
    expect(compileCondition('ax == 1 && foo < bar')).toEqual({
      ok: false,
      error: { col: 12, len: 3, message: '`foo` is not a register or a flag' },
    })
    expect(compileCondition('eip == 1')).toEqual({
      ok: false,
      error: { col: 1, len: 3, message: '`eip` is not a register or a flag' },
    })
  })

  it('passes the errors of the parser on, at their columns', () => {
    expect(compileCondition('ax = 1')).toEqual({
      ok: false,
      error: { col: 4, len: 1, message: '`=` alone: compare with `==`' },
    })
    expect(compileCondition('(cx < 3 ||')).toMatchObject({ ok: false, error: { col: 11 } })
  })
})

describe('testCondition', () => {
  it('reads each register of the row', () => {
    expect(holds('ax == 0x10 && cx < 3', { [AX]: 0x10, [CX]: 2 })).toBe(true)
    expect(holds('ax == 0x10 && cx < 3', { [AX]: 0x10, [CX]: 3 })).toBe(false)
    expect(holds('sp == 0xFFFE && ip == 0x1234', { [SP]: 0xfffe, [IP]: 0x1234 })).toBe(true)
  })

  it('reads the byte halves', () => {
    const r = { [AX]: 0x1234, [BX]: 0xabcd }
    expect(holds('al == 0x34 && ah == 0x12', r)).toBe(true)
    expect(holds('bl == 0xCD && bh == 0xAB', r)).toBe(true)
  })

  it('reads FLAGS and each flag as 0 or 1', () => {
    const r = { [FLAGS]: 0x0002 | CF | ZF | OF }
    expect(holds('flags == 0x0843', r)).toBe(true)
    expect(holds('cf && zf && of', r)).toBe(true)
    expect(holds('cf == 1 && pf == 0 && af == 0 && sf == 0 && df == 0', r)).toBe(true)
    expect(holds('pf || af || sf || df || tf || if', r)).toBe(false)
    expect(holds('pf && af && sf && df', { [FLAGS]: PF | AF | SF | DF })).toBe(true)
  })

  it('reads $ as IP', () => {
    expect(holds('$ == 0x0100', { [IP]: 0x0100 })).toBe(true)
  })

  it('says why a condition cannot be evaluated', () => {
    expect(holds('100 / cx > 1', { [CX]: 0 })).toBe('division by zero')
    expect(holds('cx && 100 / cx > 1', { [CX]: 0 })).toBe(false)
  })
})
