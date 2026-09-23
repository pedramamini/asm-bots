import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Line } from '../src/ast'
import type { Diag } from '../src/diag'
import { tokenize } from '../src/lexer'
import { parse } from '../src/parser'

/*
 * Fixtures: `fixtures/parse/<name>.asm` parses to `<name>.json`, `{ lines, diags }`;
 * `fixtures/parse/errors/<name>.asm` gives the diagnostics in `<name>.json`. After a deliberate
 * change, regenerate with `UPDATE_FIXTURES=1 bun test packages/asm` and review the diff.
 */
const FIXTURES = join(import.meta.dir, 'fixtures', 'parse')
const ERRORS = join(FIXTURES, 'errors')
const UPDATE = process.env.UPDATE_FIXTURES === '1'

/** Lexer and parser diagnostics together, as the assembler will report them. */
function run(source: string): { lines: Line[]; diags: Diag[] } {
  const diags: Diag[] = []
  const parsed = parse(tokenize(source, diags))
  return { lines: parsed.lines, diags: [...diags, ...parsed.diags] }
}

/** JSON on one line, spaced like the formatter spaces it. */
function inline(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(inline).join(', ')}]`
  if (typeof v === 'object' && v !== null) {
    const fields = Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`)
    return fields.length === 0 ? '{}' : `{ ${fields.join(', ')} }`
  }
  return JSON.stringify(v)
}

/** JSON with each object or array on one line when it fits in 100 columns. */
function pretty(v: unknown, indent = '', used = 0): string {
  const flat = inline(v)
  if (typeof v !== 'object' || v === null || indent.length + used + flat.length <= 100) return flat
  const inner = `${indent}  `
  const items = Array.isArray(v)
    ? v.map((x) => inner + pretty(x, inner))
    : Object.entries(v).map(([k, x]) => {
        const key = `${JSON.stringify(k)}: `
        return inner + key + pretty(x, inner, key.length)
      })
  const [open, close] = Array.isArray(v) ? ['[', ']'] : ['{', '}']
  return `${open}\n${items.join(',\n')}\n${indent}${close}`
}

/** Compares `actual` with the JSON file, or writes the file when updating. */
function expectFixture(file: string, actual: unknown) {
  if (UPDATE) writeFileSync(file, `${pretty(actual)}\n`)
  expect(actual).toEqual(JSON.parse(readFileSync(file, 'utf8')))
}

const asmFiles = (dir: string) =>
  readdirSync(dir)
    .filter((f) => f.endsWith('.asm'))
    .sort()

const sourceLines = (source: string) => source.split(/\r\n|\r|\n/).length

describe('parse: fixtures', () => {
  for (const name of asmFiles(FIXTURES)) {
    it(`${name} parses to ${name.replace('.asm', '.json')}, without diagnostics`, () => {
      const source = readFileSync(join(FIXTURES, name), 'utf8')
      const actual = run(source)
      expect(actual.diags).toEqual([])
      expect(actual.lines.map((l) => l.line)).toEqual(
        Array.from({ length: sourceLines(source) }, (_, i) => i + 1),
      )
      expectFixture(join(FIXTURES, name.replace('.asm', '.json')), actual)
    })
  }
})

describe('parse: error fixtures', () => {
  for (const name of asmFiles(ERRORS)) {
    it(`${name} gives the diagnostics in ${name.replace('.asm', '.json')}, one per line`, () => {
      const source = readFileSync(join(ERRORS, name), 'utf8')
      const { lines, diags } = run(source)
      expect(lines).toHaveLength(sourceLines(source))
      const perLine = diags.map((d) => d.line)
      expect(perLine).toEqual([...new Set(perLine)])
      expectFixture(join(ERRORS, name.replace('.asm', '.json')), diags)
    })
  }
})

describe('parse: lines', () => {
  it('gives one line per source line, whatever the line breaks', () => {
    const count = (source: string) => parse(tokenize(source)).lines.length
    expect(count('')).toBe(1)
    expect(count('nop')).toBe(1)
    expect(count('nop\n')).toBe(2)
    expect(count('nop\r\n\rnop\n\n')).toBe(5)
  })

  it('reads tokens that do not end in eof as if they did', () => {
    const tokens = tokenize('mov ax, 1').slice(0, -1)
    expect(parse(tokens).lines).toEqual(parse(tokenize('mov ax, 1')).lines)
    expect(parse([]).lines).toEqual([{ line: 1, kind: 'empty', operands: [], col: 1, len: 0 }])
  })

  it('keeps the label of a line with an error, and its scope for the next lines', () => {
    const { lines, diags } = run('start: mov ax, [bx+bp]\n.x: jmp .x\nsize equ\n.y: nop')
    expect(diags.map((d) => [d.line, d.code])).toEqual([
      [1, 'invalid-address'],
      [3, 'syntax'],
    ])
    expect(lines.map((l) => [l.kind, l.label?.name])).toEqual([
      ['empty', 'start'],
      ['instr', 'start.x'],
      ['empty', 'size'],
      ['instr', 'start.y'],
    ])
  })

  it('drops a label that is itself the error', () => {
    const { lines, diags } = run('ax: nop\n.x: nop')
    expect(diags.map((d) => d.code)).toEqual(['bad-label'])
    expect(lines.map((l) => [l.kind, l.label?.name])).toEqual([
      ['empty', undefined],
      ['instr', '.x'],
    ])
  })

  it('takes a bad number from the lexer as 0, without a second diagnostic', () => {
    const { lines, diags } = run('mov ax, 0x')
    expect(diags.map((d) => d.code)).toEqual(['bad-number'])
    expect(lines[0]).toMatchObject({ kind: 'instr', operands: [{}, { kind: 'imm' }] })
  })

  it('counts columns in UTF-16 code units, a tab as one', () => {
    const { diags } = run('\tmov\tax,\t[bx+bp]')
    expect(diags).toEqual([
      {
        severity: 'error',
        line: 1,
        col: 14,
        len: 2,
        message: 'invalid effective address (8086 allows bx/bp + si/di + disp)',
        code: 'invalid-address',
      },
    ])
  })
})

describe('parse: %define', () => {
  it('points a diagnostic in an expansion at the macro name', () => {
    const { diags } = run('%define PTR  [bx+bp]\n\tmov ax, PTR')
    expect(diags).toEqual([expect.objectContaining({ line: 2, col: 10, len: 3 })])
  })

  it('stops an expansion that grows too long, however it grows', () => {
    const doubling = Array.from({ length: 40 }, (_, i) => `%define Z${i + 1} Z${i} Z${i}`)
    const { diags } = run(['%define Z0', ...doubling, 'nop Z40'].join('\n'))
    expect(diags).toEqual([
      {
        severity: 'error',
        line: 42,
        col: 5,
        len: 3,
        message: 'macro expansion is too long',
        code: 'bad-directive',
      },
    ])
  })

  it('leaves a line without macros as it is, however long', () => {
    const values = Array.from({ length: 20_000 }, (_, i) => i & 0xff).join(', ')
    const { lines, diags } = run(`%define X 1\ndb ${values}`)
    expect(diags).toEqual([])
    expect(lines[1]?.operands).toHaveLength(20_000)
  })
})
