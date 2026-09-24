/**
 * The debugger in CodeMirror (`src/features/editor/cm/debug.ts`): each line's address from the
 * loaded listing, mapped through edits; the IP line; the breakpoint gutter and its presses. A real
 * `EditorView` in jsdom.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { assembleOrThrow } from '@asmbots/asm'
import { loadRoster } from '@asmbots/bots'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { fireEvent } from '@testing-library/react'
import { useDom } from '../../../packages/ui/test/dom'
import {
  debugLines,
  ipLine,
  lineBytes,
  lineOfAddress,
  setDebugLines,
  setDebugMarks,
} from '../src/features/editor/cm/debug'
import { botImage } from '../src/features/editor/debug/image'

useDom()

const DWARF = loadRoster().get('dwarf')?.source ?? ''
const BASE = 0x3051
const IMAGE = botImage(DWARF, assembleOrThrow(DWARF), BASE)

/** A line's number in `source`, by a piece of its text. */
function lineNoOf(text: string, source = DWARF): number {
  return source.split('\n').findIndex((line) => line.includes(text)) + 1
}

const BOMB = lineNoOf('mov     word [di], 0')
const START = lineNoOf('start:  call    .here')
const BOMB_ADDR = BASE + 0x0f

const views: EditorView[] = []
afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
})

function viewOf(onToggle: (lineNo: number) => void = () => {}): EditorView {
  const view = new EditorView({
    state: EditorState.create({ doc: DWARF, extensions: [debugLines(onToggle)] }),
    parent: document.body,
  })
  view.dispatch({ effects: setDebugLines.of(IMAGE.lines) })
  views.push(view)
  return view
}

const marks = (ip: number | null, breakpoints: [number, boolean][] = []) =>
  setDebugMarks.of({ ip, breakpoints: new Map(breakpoints) })

describe('debug lines', () => {
  it("know each line's bytes in the core, and each address's line", () => {
    const view = viewOf()
    expect(lineBytes(view.state, BOMB)).toEqual({ addr: BOMB_ADDR, length: 4 })
    expect(lineBytes(view.state, START)).toEqual({ addr: BASE, length: 3 })
    expect(lineBytes(view.state, 1)).toBeNull()
    expect(lineBytes(view.state, 0)).toBeNull()
    expect(lineOfAddress(view.state, BOMB_ADDR + 2)).toEqual({ lineNo: BOMB, offset: 2 })
    expect(lineOfAddress(view.state, BASE - 1)).toBeNull()
    view.dispatch({ effects: setDebugLines.of(null) })
    expect(lineBytes(view.state, BOMB)).toBeNull()
  })

  it('follow their lines through edits, and a line typed since has none', () => {
    const view = viewOf()
    // A new line above the bomb line: the bomb line moves down, and the new one has no bytes.
    const at = view.state.doc.line(BOMB).from
    view.dispatch({ changes: { from: at, insert: '        nop\n' } })
    expect(lineBytes(view.state, BOMB)).toBeNull()
    expect(lineBytes(view.state, BOMB + 1)).toEqual({ addr: BOMB_ADDR, length: 4 })
    expect(lineOfAddress(view.state, BOMB_ADDR)?.lineNo).toBe(BOMB + 1)
    // Editing inside the line keeps its address; deleting the line takes it along.
    const line = view.state.doc.line(BOMB + 1)
    view.dispatch({ changes: { from: line.to, insert: ' ; bomb' } })
    expect(lineBytes(view.state, BOMB + 1)?.addr).toBe(BOMB_ADDR)
    const whole = view.state.doc.line(BOMB + 1)
    view.dispatch({ changes: { from: whole.from, to: whole.to + 1 } })
    expect(lineOfAddress(view.state, BOMB_ADDR)).toBeNull()
  })
})

describe('the IP line and the breakpoint gutter', () => {
  it('marks the line the process stands on', () => {
    const view = viewOf()
    expect(ipLine(view.state)).toBeNull()
    expect(view.dom.querySelector('.cm-debug-ip')).toBeNull()
    view.dispatch({ effects: marks(BOMB_ADDR) })
    expect(ipLine(view.state)).toBe(BOMB)
    expect(view.dom.querySelector('.cm-debug-ip')?.textContent).toContain('mov     word [di], 0')
    // An IP inside a line's bytes is that line's; outside the bot, no line.
    view.dispatch({ effects: marks(BOMB_ADDR + 3) })
    expect(ipLine(view.state)).toBe(BOMB)
    view.dispatch({ effects: marks(0x9000) })
    expect(ipLine(view.state)).toBeNull()
    expect(view.dom.querySelector('.cm-debug-ip')).toBeNull()
  })

  it('draws a dot on each line with a breakpoint, hollow when off, and the IP arrow', () => {
    const view = viewOf()
    view.dispatch({
      effects: marks(BOMB_ADDR, [
        [BOMB_ADDR, true],
        [BASE, false],
      ]),
    })
    const dots = [...view.dom.querySelectorAll<HTMLElement>('.cm-debug-mark[data-breakpoint]')]
    expect(dots.map((d) => d.dataset.breakpoint)).toEqual(['off', 'on'])
    const arrows = [...view.dom.querySelectorAll<HTMLElement>('.cm-debug-mark[data-ip]')]
    expect(arrows).toHaveLength(1)
    expect(arrows[0]?.dataset.breakpoint).toBe('on')
    // A line with bytes and nothing on it has a blank mark (the pointer's hint); others have none.
    // The gutter's hidden spacer, which sets its width, has one too.
    const shown = [...view.dom.querySelectorAll<HTMLElement>('.cm-debug-mark')].filter(
      (mark) => mark.parentElement?.style.visibility !== 'hidden',
    )
    expect(shown.length).toBe(IMAGE.lines.length)
  })

  it("hands a press on the gutter to the page, with the line's number", () => {
    const pressed: number[] = []
    const view = viewOf((lineNo) => pressed.push(lineNo))
    const gutter = view.dom.querySelector('.cm-debug-gutter') as HTMLElement
    const block = view.lineBlockAt(view.state.doc.line(BOMB).from)
    // jsdom lays nothing out: CodeMirror finds the line under the pointer from its heights.
    const rect = gutter.getBoundingClientRect()
    const at = { clientX: rect.left + 2, clientY: rect.top + block.top + 1 }
    fireEvent.mouseDown(gutter, { button: 0, ...at })
    // Only the main button.
    fireEvent.mouseDown(gutter, { button: 2, ...at })
    expect(pressed).toEqual([BOMB])
  })
})
