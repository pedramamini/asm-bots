/**
 * The debugger's helpers (`src/features/editor/debug/`): the trace lines, value expressions for
 * `goto` and the watches, the memory window's sweeps, the loaded bot's image, and what a new
 * session takes from the old one.
 */
import { describe, expect, it } from 'bun:test'
import { assembleOrThrow } from '@asmbots/asm'
import { loadRoster } from '@asmbots/bots'
import { AX, BX, DI, FLAGS, IP, PROC_FIELDS, type ProcRow } from '@asmbots/engine'
import type { CatalogBot } from '../src/features/arena/setup/bots'
import { compileValue, evaluateValue } from '../src/features/editor/debug/condition'
import { botImage, inImage, labelOf, shortLabel } from '../src/features/editor/debug/image'
import { carryBreakpoints, debugBots } from '../src/features/editor/debug/load'
import {
  FOLLOW_MARGIN,
  followStart,
  MEMORY_ROWS,
  ROWS_BEFORE,
  sweep,
  windowStart,
} from '../src/features/editor/debug/memory'
import type { Breakpoint } from '../src/features/editor/debug/session'
import {
  flagLetters,
  TRACE_HEADER,
  type TraceEntry,
  traceLine,
  traceText,
} from '../src/features/editor/debug/trace'

const DWARF = loadRoster().get('dwarf')?.source ?? ''

/** A process row with `values` set. */
function rowOf(values: Partial<Record<number, number>>): ProcRow {
  const row = new Uint16Array(PROC_FIELDS)
  for (const [field, v] of Object.entries(values)) row[Number(field)] = v as number
  return row
}

/** A 64 KB core with `bytes` at `at`. */
function coreWith(at: number, bytes: readonly number[]): Uint8Array {
  const core = new Uint8Array(0x10000)
  bytes.forEach((b, k) => {
    core[(at + k) & 0xffff] = b
  })
  return core
}

describe('trace lines', () => {
  const entry: TraceEntry = {
    cycle: 12,
    bot: 0,
    row: 3,
    addr: 0x0a12,
    bytes: new Uint8Array([0xc7, 0x05, 0x00, 0x00]),
    regs: { ax: 1, bx: 0x3051, cx: 0x3ffa, dx: 0, si: 0, di: 0x304d, bp: 0, sp: 0x3051 },
    flags: 0x0816,
  }

  it("write the CLI's format: cycle bot proc addr bytes text | ax..sp | ODITSZAPC", () => {
    expect(traceLine(entry)).toBe(
      '        12   0    3 0x0a12 c7 05 00 00       mov word [di], 0         | 0001 3051 3ffa 0000 0000 304d 0000 3051 | OditszAPc',
    )
    expect(traceText(entry)).toBe('mov word [di], 0')
  })

  it('line up with their header', () => {
    const line = traceLine(entry)
    const bars = (text: string) => [...text.matchAll(/\|/g)].map((m) => m.index)
    expect(bars(TRACE_HEADER)).toEqual(bars(line))
    expect(TRACE_HEADER.indexOf('ODITSZAPC')).toBe(line.indexOf('OditszAPc'))
    expect(TRACE_HEADER.indexOf('addr')).toBe(line.indexOf('0x0a12'))
  })

  it('spell FLAGS uppercase for a set flag, lowercase for a clear one', () => {
    expect(flagLetters(0x0002)).toBe('oditszapc')
    expect(flagLetters(0x0fd5)).toBe('ODITSZAPC')
    expect(flagLetters(0x0001)).toBe('oditszapC')
    expect(flagLetters(0x0800)).toBe('Oditszapc')
  })
})

describe('value expressions', () => {
  const labels = new Map([
    ['bomb', 0x1234],
    ['start.here', 0x2000],
  ])
  const row = rowOf({ [AX]: 0x00ff, [BX]: 0x0010, [DI]: 0xfffe, [IP]: 0x0400, [FLAGS]: 0x0041 })
  const value = (text: string) => {
    const compiled = compileValue(text)
    if (!compiled.ok) return `error: ${compiled.error.message}`
    return evaluateValue(compiled.compiled, row, labels)
  }

  it('read registers in any case, labels as the source names them, and $ as IP', () => {
    expect(value('di + 4')).toBe(0x0002)
    expect(value('DI')).toBe(0xfffe)
    expect(value('bomb')).toBe(0x1234)
    expect(value('bomb + bx * 2')).toBe(0x1254)
    expect(value('start.here')).toBe(0x2000)
    expect(value('$')).toBe(0x0400)
    expect(value('ah')).toBe(0)
    expect(value('al')).toBe(0xff)
    expect(value('zf')).toBe(1)
    expect(value('0x10000 - 1')).toBe(0xffff)
  })

  it('say why a text is no single value, and a name that is no label', () => {
    expect(value('ax == 1')).toMatch(/^error: an address is one value/)
    expect(value('ax +')).toMatch(/^error: /)
    expect(value('nowhere')).toBe('undefined symbol `nowhere`')
    expect(value('bx / 0')).toMatch(/zero/)
  })
})

describe('the memory window', () => {
  // mov ax, 0x1234 (B8 34 12) · nop (90) · jmp short -3, to the nop (EB FD) · dat (00 00)
  const code = [0xb8, 0x34, 0x12, 0x90, 0xeb, 0xfd, 0x00, 0x00]

  it('sweeps rows from a start, wrapping at 64 KB', () => {
    const core = coreWith(0xfffe, code)
    const rows = sweep(core, 0xfffe, 4)
    expect(rows.map((r) => [r.address, r.text])).toEqual([
      [0xfffe, 'mov ax, 0x1234'],
      [0x0001, 'nop'],
      [0x0002, 'jmp short 0x0001'],
      [0x0004, 'dat'],
    ])
    expect(sweep(core, 0, MEMORY_ROWS)).toHaveLength(MEMORY_ROWS)
  })

  it('names jump targets, and starts a row at each known start', () => {
    const core = coreWith(0x100, code)
    expect(sweep(core, 0x100, 3, new Map([[0x103, 'top']]))[2]?.text).toBe('jmp short top')
    // A start at 0x101 cuts the mov: its first byte is a `db`, and the sweep goes on from there.
    const cut = sweep(core, 0x100, 3, undefined, new Set([0x101]))
    expect(cut.map((r) => r.text)).toEqual(['db 0xB8', 'xor al, 0x12', 'nop'])
  })

  it('finds a start whose sweep lands on the target, ROWS_BEFORE rows down', () => {
    const core = coreWith(0x2000, [...code, ...code, ...code, ...code])
    const target = 0x2000 + 3 * code.length
    const start = windowStart(core, target)
    const rows = sweep(core, start)
    expect(rows.findIndex((r) => r.address === target)).toBe(ROWS_BEFORE)
    expect(rows.slice(0, ROWS_BEFORE).every((r) => r.kind !== 'undefined')).toBe(true)
  })

  it("reads a bot's code from its known start, whatever lies before it", () => {
    // A stray 0x30 before the bot: a sweep would read `30 E8` as one instruction.
    const core = coreWith(0x3050, [0x30, 0xe8, 0x00, 0x00, 0x5b])
    const start = windowStart(core, 0x3054, 4, new Set([0x3051, 0x3054]))
    const rows = sweep(core, start, 6, undefined, new Set([0x3051, 0x3054]))
    expect(rows.map((r) => r.text)).toContain('call 0x3054')
    expect(rows.find((r) => r.address === 0x3054)?.text).toBe('pop bx')
  })

  it('keeps its start while the target moves inside it, and starts again when it leaves', () => {
    const core = coreWith(0x4000, Array(64).fill(0x90))
    const start = windowStart(core, 0x4010)
    expect(followStart(core, start, 0x4012)).toBe(start)
    expect(followStart(core, start, start + FOLLOW_MARGIN)).toBe(start)
    expect(followStart(core, start, start + 1)).not.toBe(start)
    expect(followStart(core, start, start + MEMORY_ROWS - 1)).not.toBe(start)
    expect(followStart(core, null, 0x4020)).toBe(windowStart(core, 0x4020))
  })
})

describe('the bot image', () => {
  const assembled = assembleOrThrow(DWARF)
  const image = botImage(DWARF, assembled, 0x3051)

  it('holds each line with bytes at its address in the core', () => {
    const lines = assembled.listing.filter((l) => l.bytes.length > 0)
    expect(image.lines).toEqual(
      lines.map((l) => ({ lineNo: l.lineNo, addr: 0x3051 + l.address, length: l.bytes.length })),
    )
    expect(image.size).toBe(assembled.bytes.length)
  })

  it("holds the labels, not the equ's, a .local one by its full name", () => {
    expect([...image.labels.keys()]).toEqual(['start', 'start.here', 'lap', 'lap.bomb', 'end'])
    expect(image.labels.get('lap.bomb')).toBe(0x3051 + (assembled.symbols.get('lap.bomb') ?? 0))
    expect(image.names.get(0x3051)).toBe('start')
  })

  it('tells its bytes, and an address as a label and an offset', () => {
    expect(inImage(image, 0x3051)).toBe(true)
    expect(inImage(image, 0x3051 + image.size)).toBe(false)
    expect(inImage(image, 0x3050)).toBe(false)
    const bomb = image.labels.get('lap.bomb') ?? 0
    expect(labelOf(image, bomb)).toBe('lap.bomb')
    expect(labelOf(image, bomb + 3)).toBe('lap.bomb+3')
    expect(labelOf(image, 0x3050)).toBeNull()
    expect(shortLabel('lap.bomb')).toBe('.bomb')
    expect(shortLabel('start')).toBe('start')
    expect(shortLabel('..@x')).toBe('..@x')
  })

  it('wraps at 64 KB', () => {
    const wrapped = botImage(DWARF, assembled, 0xfffa)
    expect(inImage(wrapped, 0x0001)).toBe(true)
    expect(wrapped.lines.at(-1)?.addr).toBeLessThan(0x100)
  })
})

describe('loading a session', () => {
  const catalog = (name: string, source: string) =>
    ({ name, assembled: assembleOrThrow(source) }) as unknown as CatalogBot

  it("names the battle's bots, the editor's first, a repeated name numbered", () => {
    const mine = assembleOrThrow(DWARF)
    const bots = debugBots(mine, [catalog('Dwarf', DWARF), catalog('Imp', '%name "Imp"\nnop')])
    expect(bots.map((b) => b.name)).toEqual(['Dwarf', 'Dwarf 2', 'Imp'])
    expect(bots[0]?.bytes).toBe(mine.bytes)
    expect(bots[0]?.meta).toEqual({ author: 'ASM Bots', strategy: mine.strategy, version: '' })
    expect(debugBots({ ...mine, name: '' }, [])[0]?.name).toBe('my bot')
  })

  it("moves a breakpoint in the bot's bytes with its line, and keeps one elsewhere", () => {
    const bp = (addr: number, condition = ''): Breakpoint => ({
      addr,
      enabled: true,
      condition,
      hits: 4,
    })
    // The old bot was at 0x100: line 5 at 0x100 (2 bytes), line 6 at 0x102 (3 bytes). In the new
    // one, line 5 is gone, and line 6 moved to line 7, at 0x200 (1 byte).
    const lineOf = (addr: number) =>
      addr === 0x102 || addr === 0x104 ? { lineNo: 7, offset: addr - 0x102 } : null
    const carried = carryBreakpoints(
      [bp(0x100), bp(0x102, 'ax == 1'), bp(0x104), bp(0x9000), bp(0x200)],
      {
        lineOf,
        inOld: (addr) => addr >= 0x100 && addr < 0x105,
        lineBytes: (lineNo) => (lineNo === 7 ? { addr: 0x200, length: 1 } : null),
      },
    )
    // 0x100 went with its line; 0x102 and 0x104 both land on 0x200's first byte, with the first
    // one's condition; 0x9000 stays; the old 0x200 (outside the old bot) merges into it.
    expect(carried).toEqual([
      { addr: 0x200, enabled: true, condition: 'ax == 1', hits: 0 },
      { addr: 0x9000, enabled: true, condition: '', hits: 0 },
    ])
  })
})
