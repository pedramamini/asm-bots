/**
 * The tiny LCS diff (src/features/editor/diff.ts): the steps it gives, the formatter's edit that
 * keeps the cursor in its token (`format`), and the versions view's rows with their folds.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { formatSource } from '@asmbots/asm'
import { EditorSelection, EditorState } from '@codemirror/state'
import { asmFiles } from '../../../packages/asm/test/fixture'
import { diffSequences, MAX_DIFF_CELLS, textChanges } from '../src/features/editor/diff'
import { diffRows } from '../src/features/editor/VersionsModal'

const REPO = join(import.meta.dir, '..', '..', '..')

/** Every source the formatter has a fixture or a roster bot for. */
function sources(): [string, string][] {
  const read = (dir: string, recursive = false) =>
    asmFiles(dir, recursive)
      .filter((file) => !file.endsWith('.fmt.asm'))
      .map((file): [string, string] => [file, readFileSync(join(dir, file), 'utf8')])
  return [
    ...read(join(REPO, 'packages/asm/test/fixtures/format')),
    ...read(join(REPO, 'packages/bots/roster'), true),
  ]
}

const ops = (a: string, b: string) =>
  diffSequences(a.split(''), b.split(''))
    .map(({ op, text }) => `${op}${text}`)
    .join(' ')

describe('diffSequences', () => {
  it('keeps what both sides have, and lists removals before additions', () => {
    expect(ops('abc', 'abc')).toBe('=a =b =c')
    expect(ops('abc', 'axc')).toBe('=a -b +x =c')
    expect(ops('abc', 'ac')).toBe('=a -b =c')
    expect(ops('', 'ab')).toBe('+a +b')
    expect(ops('ab', '')).toBe('-a -b')
    expect(ops('xaby', 'aqb')).toBe('-x =a +q =b -y')
  })

  it('finds a longest common subsequence', () => {
    const a = 'ACCGGTCGAGTGCGCGGAAGCCGGCCGAA'.split('')
    const b = 'GTCGTTCGGAATGCCGTTGCTCTGTAAA'.split('')
    const kept = diffSequences(a, b).filter((op) => op.op === '=').length
    expect(kept).toBe(20)
  })

  it('gives up on a table past MAX_DIFF_CELLS: the old side out, the new in', () => {
    const n = Math.ceil(Math.sqrt(MAX_DIFF_CELLS))
    const a = Array.from({ length: n }, (_, i) => `a${i}`)
    const b = Array.from({ length: n }, (_, i) => `b${i}`)
    const diff = diffSequences(['same', ...a], ['same', ...b])
    expect(diff[0]).toEqual({ op: '=', text: 'same' })
    expect(diff.slice(1, n + 1).every((op) => op.op === '-')).toBe(true)
    expect(diff.slice(n + 1).every((op) => op.op === '+')).toBe(true)
  })
})

describe('textChanges', () => {
  it('turns each source into its formatted text', () => {
    for (const [name, source] of sources()) {
      const formatted = formatSource(source)
      const state = EditorState.create({ doc: source })
      const next = state.update({ changes: textChanges(state.doc, formatted) }).state
      expect([name, next.doc.toString()]).toEqual([name, formatted])
    }
  })

  it('changes nothing when the text is the same', () => {
    const doc = EditorState.create({ doc: 'nop\n' }).doc
    expect(textChanges(doc, 'nop\n')).toEqual([])
  })

  it('keeps the cursor in the token the formatter recased and respaced', () => {
    const source = '%name "t"\nSTART:MOV AX,0X1f\n  jmp   START\n'
    const formatted = formatSource(source)
    expect(formatted).toBe('%name     "t"\n\nSTART:  mov     ax, 0x1F\n        jmp     START\n')
    const at = source.indexOf('AX') + 1
    const state = EditorState.create({ doc: source, selection: EditorSelection.cursor(at) })
    const next = state.update({ changes: textChanges(state.doc, formatted) }).state
    const head = next.selection.main.head
    expect(next.doc.sliceString(head - 1, head + 1)).toBe('ax')
    // And one in the number: between its 1 and its f.
    const inNumber = EditorState.create({
      doc: source,
      selection: EditorSelection.cursor(source.indexOf('0X1f') + 3),
    })
    const moved = inNumber.update({ changes: textChanges(inNumber.doc, formatted) }).state
    const pos = moved.selection.main.head
    expect(moved.doc.sliceString(pos - 3, pos + 1)).toBe('0x1F')
  })

  it('replaces a run of lines that grows or shrinks whole', () => {
    const state = EditorState.create({ doc: 'a\n\n\n\nb\n' })
    const changes = textChanges(state.doc, 'a\n\nb\n')
    expect(state.update({ changes }).state.doc.toString()).toBe('a\n\nb\n')
  })
})

describe('the versions view', () => {
  const lines = (n: number, prefix = 'line') =>
    Array.from({ length: n }, (_, i) => `${prefix} ${i}`)

  it('folds a long run of unchanged lines past 3 lines of context', () => {
    const before = [...lines(20), 'old', ...lines(20, 'tail')].join('\n')
    const after = [...lines(20), 'new', ...lines(20, 'tail')].join('\n')
    const rows = diffRows(before, after)
    expect(rows.map((row) => (row.op === 'fold' ? `fold ${row.lines}` : row.op))).toEqual([
      'fold 17',
      '=',
      '=',
      '=',
      '-',
      '+',
      '=',
      '=',
      '=',
      'fold 17',
    ])
    expect(rows[4]).toEqual({ op: '-', text: 'old' })
    expect(rows[5]).toEqual({ op: '+', text: 'new' })
  })

  it('keeps a short run between two changes whole', () => {
    const before = ['a', 'x', 'b', 'c', 'd', 'e', 'f', 'g', 'y'].join('\n')
    const after = ['a', 'X', 'b', 'c', 'd', 'e', 'f', 'g', 'Y'].join('\n')
    expect(diffRows(before, after).some((row) => row.op === 'fold')).toBe(false)
  })

  it('lists nothing to change for the same text', () => {
    expect(diffRows('a\nb', 'a\nb')).toEqual([
      { op: '=', text: 'a' },
      { op: '=', text: 'b' },
    ])
  })
})
