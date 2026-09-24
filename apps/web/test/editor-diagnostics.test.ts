/**
 * The assembler's results in CodeMirror (src/features/editor/cm/diagnostics.ts, listing.ts): where
 * each finding lands, how the problems follow edits, and the listing gutter's markers, which stay
 * on their lines while the source changes. A real `EditorView` in jsdom.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Diag } from '@asmbots/asm'
import { diagnosticCount, lintGutter } from '@codemirror/lint'
import { EditorState, Text } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { useDom } from '../../../packages/ui/test/dom'
import { assembleSource } from '../src/features/editor/asm/run'
import { x16c } from '../src/features/editor/cm'
import {
  diagRange,
  problemsOf,
  resultDiagnostics,
  showResult,
  toDiagnostic,
} from '../src/features/editor/cm/diagnostics'
import {
  LISTING_BYTES,
  listing,
  listingText,
  listingTexts,
  setListingVisible,
} from '../src/features/editor/cm/listing'

useDom()

const DWARF = readFileSync(join(import.meta.dir, '../../../packages/bots/roster/dwarf.asm'), 'utf8')

const diag = (line: number, col: number, len: number, extra: Partial<Diag> = {}): Diag => ({
  severity: 'error',
  line,
  col,
  len,
  message: 'm',
  code: 'syntax',
  ...extra,
})

const views: EditorView[] = []
afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
})

function viewOf(doc: string, listingOn = true): EditorView {
  const view = new EditorView({
    state: EditorState.create({ doc, extensions: [x16c(), lintGutter(), listing(listingOn)] }),
    parent: document.body,
  })
  views.push(view)
  return view
}

/** A line's number in `source`, by a piece of its text. */
function lineOf(source: string, text: string): number {
  const index = source.split('\n').findIndex((line) => line.includes(text))
  if (index < 0) throw new Error(`no line holds ${text}`)
  return index + 1
}

describe('where findings land', () => {
  const doc = Text.of(['mov ax, bx', '\tnop', ''])

  it('counts columns from 1 and covers len columns, a tab as one', () => {
    expect(diagRange(diag(1, 5, 2), doc)).toEqual({ from: 4, to: 6 })
    expect(diagRange(diag(2, 2, 3), doc)).toEqual({ from: 12, to: 15 })
  })

  it('makes a point of len 0, and holds a range to its line', () => {
    expect(diagRange(diag(1, 11, 0), doc)).toEqual({ from: 10, to: 10 })
    expect(diagRange(diag(1, 9, 50), doc)).toEqual({ from: 8, to: 10 })
    expect(diagRange(diag(1, 99, 1), doc)).toEqual({ from: 10, to: 10 })
    expect(diagRange(diag(3, 1, 0), doc)).toEqual({ from: 16, to: 16 })
    expect(diagRange(diag(9, 1, 1), doc)).toEqual({ from: 16, to: 16 })
  })

  it('carries the severity, the code as the source, and the fix under the message', () => {
    const d = toDiagnostic(diag(1, 1, 3, { severity: 'warning', fix: 'do this' }), doc)
    expect([d.severity, d.source, d.message]).toEqual(['warning', 'syntax', 'm'])
    const node = d.renderMessage?.({} as EditorView) as HTMLElement
    expect(node.textContent).toBe('mdo this')
    expect(node.querySelector('.cm-x16c-fix')?.textContent).toBe('do this')
  })

  it('gives the errors, and the warnings only with lint on', () => {
    const source = '%name "t"\nstart:  mov [bx], 0\n'
    const result = assembleSource(source)
    const text = Text.of(source.split('\n'))
    expect(resultDiagnostics(result, text, true).map((d) => d.source)).toEqual([
      'size-not-specified',
      'no-strategy',
    ])
    expect(resultDiagnostics(result, text, false).map((d) => d.source)).toEqual([
      'size-not-specified',
    ])
  })
})

describe('results in the editor', () => {
  const BROKEN = '%name "t"\n%strategy "s"\n\nstart:  mov     [bx], 0\n        jmp     start\n'

  it('shows a result for the text it holds, and not a stale one', () => {
    const view = viewOf(BROKEN)
    expect(showResult(view, assembleSource(`${BROKEN}nop\n`), true)).toBe(false)
    expect(diagnosticCount(view.state)).toBe(0)
    expect(showResult(view, assembleSource(BROKEN), true)).toBe(true)
    expect(diagnosticCount(view.state)).toBe(1)
    expect(view.dom.querySelector('.cm-lintRange-error')?.textContent).toBe('[bx]')
    expect(view.dom.querySelectorAll('.cm-gutter-lint .cm-lint-marker-error')).toHaveLength(1)
  })

  it('lists the problems where the editor has them, through edits', () => {
    const view = viewOf(BROKEN)
    showResult(view, assembleSource(BROKEN), true)
    expect(problemsOf(view.state).map((p) => [p.severity, p.line, p.col, p.code])).toEqual([
      ['error', 4, 17, 'size-not-specified'],
    ])
    view.dispatch({ changes: { from: 0, insert: '; a line above\n' } })
    const [problem] = problemsOf(view.state)
    expect([problem?.line, problem?.col]).toEqual([5, 17])
    expect(view.state.sliceDoc(problem?.from, (problem?.from ?? 0) + 4)).toBe('[bx]')
  })

  it('puts errors before warnings at one place, and gives each its fix', () => {
    const source = '%name "t"\nstart:  movsb\n        mov     ax, [0x0100]\n        jmp     start\n'
    const view = viewOf(source)
    showResult(view, assembleSource(source), true)
    const problems = problemsOf(view.state)
    expect(problems.map((p) => p.code)).toEqual([
      'no-strategy',
      'uninitialized-di',
      'absolute-address',
    ])
    expect(problems.every((p) => p.severity === 'warning' && (p.fix ?? '') !== '')).toBe(true)
  })
})

describe('the listing gutter', () => {
  it('writes the address and the first bytes of a line, and marks a longer one', () => {
    const bytes = new Uint8Array([0xc7, 0x05, 0x00, 0x00, 0x90, 0x90])
    const line = { lineNo: 1, address: 0x0d, source: '', bytes, bytesHex: 'C7 05 00 00 90 90' }
    expect(listingText({ ...line, bytes: bytes.subarray(0, 4), bytesHex: 'C7 05 00 00' })).toBe(
      '0x000D  C7 05 00 00',
    )
    expect(listingText(line)).toBe('0x000D  C7 05 00 00…')
    expect(LISTING_BYTES).toBe(4)
    expect(listingText({ ...line, bytes: new Uint8Array(0), bytesHex: '' })).toBeNull()
  })

  it('shows each line that has bytes, from the last assemble', () => {
    const view = viewOf(DWARF)
    showResult(view, assembleSource(DWARF), true)
    const texts = listingTexts(view.state)
    expect(texts.get(lineOf(DWARF, 'start:  call'))).toBe('0x0000  E8 00 00')
    expect(texts.get(lineOf(DWARF, '.here:  pop'))).toBe('0x0003  5B')
    expect(texts.get(lineOf(DWARF, 'mov     word [di], 0'))).toBe('0x000F  C7 05 00 00')
    expect(texts.get(lineOf(DWARF, '%name'))).toBeUndefined()
    expect(texts.size).toBe(9)
    const shown = [...view.dom.querySelectorAll('.cm-listing-gutter .cm-gutterElement')]
      .map((element) => element.textContent)
      .filter((text) => text?.startsWith('0x0003'))
    expect(shown).toEqual(['0x0003  5B'])
  })

  it('keeps each marker on its line through edits, until the next assemble', () => {
    const view = viewOf(DWARF)
    showResult(view, assembleSource(DWARF), true)
    const pop = lineOf(DWARF, '.here:  pop')
    view.dispatch({ changes: { from: 0, insert: '; one more line\n' } })
    expect(listingTexts(view.state).get(pop + 1)).toBe('0x0003  5B')
    // Delete the pop line whole: its marker goes, and the next line keeps its own.
    const line = view.state.doc.line(pop + 1)
    view.dispatch({ changes: { from: line.from, to: line.to + 1 } })
    const texts = listingTexts(view.state)
    expect(texts.get(pop + 1)).toBe('0x0004  83 EB 03')
    expect([...texts.values()].filter((t) => t.startsWith('0x0003'))).toEqual([])
    // Join that line onto the one above: the joined line shows the marker at its start only.
    const joined = view.state.doc.line(pop + 1)
    view.dispatch({ changes: { from: joined.from - 1, to: joined.from } })
    const after = listingTexts(view.state)
    expect(after.get(pop)).toBe('0x0000  E8 00 00')
    expect([...after.values()].filter((t) => t.startsWith('0x0004'))).toEqual([])
  })

  it('keeps the listing of the last good assemble through a result with errors', () => {
    const view = viewOf(DWARF)
    showResult(view, assembleSource(DWARF), true)
    const at = view.state.doc.length
    view.dispatch({ changes: { from: at, insert: '        jmp     nowhere\n' } })
    showResult(view, assembleSource(view.state.doc.toString()), true)
    expect(diagnosticCount(view.state)).toBe(1)
    expect(listingTexts(view.state).get(lineOf(DWARF, '.here:  pop'))).toBe('0x0003  5B')
  })

  it('shows and hides the gutter, and the markers stay current either way', () => {
    const view = viewOf(DWARF, false)
    expect(view.dom.querySelector('.cm-listing-gutter')).toBeNull()
    showResult(view, assembleSource(DWARF), true)
    expect(listingTexts(view.state).size).toBe(9)
    setListingVisible(view, true)
    expect(view.dom.querySelector('.cm-listing-gutter')).not.toBeNull()
    setListingVisible(view, false)
    expect(view.dom.querySelector('.cm-listing-gutter')).toBeNull()
  })
})
