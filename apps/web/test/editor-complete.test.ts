/**
 * x16c completion (src/features/editor/cm/complete.ts): what the source offers where, the labels
 * of the last good assemble and their scopes, and, in a real EditorView (jsdom), the popup after
 * typing and the snippets as they land in the document.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assemble, WORDS } from '@asmbots/asm'
import { ALIASES, MNEMONICS } from '@asmbots/codec'
import {
  acceptCompletion,
  type Completion,
  CompletionContext,
  currentCompletions,
  moveCompletionSelection,
  startCompletion,
} from '@codemirror/autocomplete'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { useDom } from '../../../packages/ui/test/dom'
import { assembledField, setAssembled, x16c } from '../src/features/editor/cm'
import { DIRECTIVE_DETAILS, scopeAt, x16cCompletions } from '../src/features/editor/cm/complete'
import { opcodeEntry } from '../src/features/editor/cm/opcodes'

const DWARF = readFileSync(join(import.meta.dir, '../../../packages/bots/roster/dwarf.asm'), 'utf8')

/** `doc` with `|` at the cursor, in a state with x16c and, when given, an assemble of `bot`. */
function stateAt(doc: string, bot?: string): EditorState {
  const pos = doc.indexOf('|')
  const state = EditorState.create({
    doc: doc.replace('|', ''),
    selection: { anchor: pos },
    extensions: [x16c()],
  })
  return bot === undefined ? state : state.update({ effects: setAssembled.of(assemble(bot)) }).state
}

interface Ask {
  explicit?: boolean
  bot?: string
}

/** What the source gives at the cursor. */
function complete(doc: string, { explicit = false, bot }: Ask = {}) {
  const state = stateAt(doc, bot)
  const result = x16cCompletions(new CompletionContext(state, state.selection.main.head, explicit))
  return { state, result }
}

/** The labels shown for what is typed: those that start with it, as CodeMirror filters. */
function offered(doc: string, ask: Ask = {}): string[] {
  const { state, result } = complete(doc, ask)
  if (result === null) return []
  const typed = state.sliceDoc(result.from, state.selection.main.head)
  return result.options.filter((o) => o.label.startsWith(typed)).map((o) => o.label)
}

const option = (doc: string, label: string, ask: Ask = {}): Completion | undefined =>
  complete(doc, ask).result?.options.find((o) => o.label === label)

describe('x16c completion: statements', () => {
  it('offers movsw after mov, from the start of the word', () => {
    expect(offered('mov|')).toEqual(['mov', 'movsb', 'movsw'])
    expect(offered('        mov|')).toEqual(['mov', 'movsb', 'movsw'])
    expect(complete('        mov|').result?.from).toBe(8)
    expect(offered('start:  mo|')).toEqual(['mov', 'movsb', 'movsw'])
  })

  it('offers every mnemonic with its summary, and each alias with the name it stands for', () => {
    const labels = offered('|', { explicit: true })
    for (const m of [...MNEMONICS, ...ALIASES.keys()]) expect(labels).toContain(m)
    expect(option('mo|', 'mov')?.detail).toBe(opcodeEntry('mov')?.doc.summary)
    expect(option('j|', 'je')?.detail).toBe(`jz: ${opcodeEntry('jz')?.doc.summary}`)
    expect(option('j|', 'je')?.boost).toBe(-1)
    expect(typeof option('mo|', 'mov')?.info).toBe('function')
  })

  it('offers the prefixes and the directives, each with what it does', () => {
    expect(offered('re|').sort()).toEqual([
      'rep',
      'repe',
      'repne',
      'repnz',
      'repz',
      'resb',
      'resw',
      'ret',
    ])
    for (const d of WORDS.directives) {
      expect([d, DIRECTIVE_DETAILS[d]?.length ?? 0]).not.toEqual([d, 0])
      expect(offered(`${d}|`)).toContain(d)
    }
  })

  it('offers only the string instructions a prefix takes after it', () => {
    expect(offered('        rep |', { explicit: true }).sort()).toEqual([
      'lodsb',
      'lodsw',
      'movsb',
      'movsw',
      'stosb',
      'stosw',
    ])
    expect(offered('        repne sc|')).toEqual(['scasb', 'scasw'])
    expect(offered('        REPZ cm|')).toEqual(['cmpsb', 'cmpsw'])
  })

  it('offers statements and labels in a times count', () => {
    expect(offered('        times   4 no|')).toEqual(['nop', 'not'])
    expect(offered(`${DWARF}\n        times   ST|`, { bot: DWARF })).toEqual(['STRIDE'])
  })

  it('offers the snippets on a line of their own only', () => {
    expect(offered('ba|')).toEqual(['base idiom'])
    expect(offered('        spl|')).toEqual(['spl', 'spl fork'])
    expect(offered('start:  spl|')).toEqual(['spl'])
  })
})

describe('x16c completion: % directives', () => {
  it('offers the % directives at the start of a line', () => {
    expect(offered('%|')).toEqual(['%name', '%author', '%strategy', '%version', '%define'])
    expect(offered('  %st|')).toEqual(['%strategy'])
    expect(complete('  %st|').result?.from).toBe(2)
    expect(offered('mov ax, 5 %|')).toEqual([])
  })
})

describe('x16c completion: operands', () => {
  it('offers the registers and the size words', () => {
    expect(offered('        mov     ax, b|')).toEqual(['bx', 'bp', 'bl', 'bh', 'byte'])
    expect(offered('        jmp     sh|')).toEqual(['short'])
    // No size inside brackets.
    expect(offered('        mov     word [b|')).toEqual(['bx', 'bp', 'bl', 'bh'])
  })

  it('offers the labels and constants of the last good assemble, with their values', () => {
    expect(offered('        jmp     |', { explicit: true })).not.toContain('lap')
    const labels = offered(`${DWARF}\n        jmp     |`, { explicit: true, bot: DWARF })
    for (const name of ['start', 'lap', 'end', 'STRIDE', 'SIZE', 'LAP'])
      expect(labels).toContain(name)
    const lap = option(`${DWARF}\n        jmp     |`, 'lap', { explicit: true, bot: DWARF })
    expect(lap).toMatchObject({ detail: '0x0007', boost: 2 })
    // Not a jump: the registers come first.
    const boost = (label: string) =>
      option(`${DWARF}\n        mov     ax, |`, label, { explicit: true, bot: DWARF })?.boost ?? 0
    expect([boost('bx'), boost('lap'), boost('bl')]).toEqual([1, 0, 0])
  })

  it('names the locals of the scope the cursor is in as .name, and others in full', () => {
    const inLap = DWARF.replace('        loop    .bomb', '        loop    .b|')
    expect(offered(inLap, { bot: DWARF })).toEqual(['.bomb'])
    const inStart = DWARF.replace('        sub     bx, .here', '        sub     bx, .h|')
    expect(offered(inStart, { bot: DWARF })).toEqual(['.here'])
    expect(offered(inLap.replace('.b|', 'star|'), { bot: DWARF })).toEqual(['start', 'start.here'])
  })

  it('keeps the last good assemble while the source has errors', () => {
    let state = stateAt('|', DWARF)
    state = state.update({ effects: setAssembled.of(assemble('mov [bx], 0')) }).state
    expect(state.field(assembledField)?.symbols.get('lap')).toBe(7)
  })
})

describe('x16c completion: nothing to offer', () => {
  it('stays out of comments, strings, numbers, and new names', () => {
    expect(complete('        nop     ; mo|').result).toBeNull()
    expect(complete('        db      "mo|').result).toBeNull()
    expect(complete('        mov     ax, 0x1F|').result).toBeNull()
    expect(complete('        mov     ax, 0x1F|', { explicit: true }).result).toBeNull()
    expect(complete('%define |', { explicit: true }).result).toBeNull()
    expect(complete('        mov     ax, |').result).toBeNull()
  })
})

describe('x16c completion: scopes', () => {
  it('finds the global label a line is under', () => {
    const doc = EditorState.create({
      doc: 'SIZE equ 4\nstart: nop\n.loop: nop\n..@x: nop\n$ax: nop\n  nop\nK equ 1\n  nop',
    }).doc
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((n) => scopeAt(doc, n))).toEqual([
      '',
      'start',
      'start',
      'start',
      'ax',
      'ax',
      'ax',
      'ax',
    ])
  })
})

describe('x16c completion: in an editor', () => {
  useDom()
  let view: EditorView | undefined

  afterEach(() => {
    view?.destroy()
    view = undefined
  })

  /** An editor on `doc`, cursor at `|`, focused as a user's is. */
  function editor(doc: string): EditorView {
    const pos = doc.indexOf('|')
    view = new EditorView({
      state: EditorState.create({
        doc: doc.replace('|', ''),
        selection: { anchor: pos },
        extensions: [x16c()],
      }),
      parent: document.body,
    })
    return view
  }

  /** Types `text` at the cursor as a keystroke would. */
  function type(v: EditorView, text: string) {
    v.dispatch(v.state.replaceSelection(text), { userEvent: 'input.type' })
  }

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  /**
   * The popup's options, once the completion has run and the popup takes keys: CodeMirror ignores
   * them for its `interactionDelay` (75 ms) after the popup opens.
   */
  async function popup(v: EditorView): Promise<string[]> {
    startCompletion(v)
    for (let wait = 0; wait < 100 && currentCompletions(v.state).length === 0; wait++) {
      await sleep(10)
    }
    await sleep(100)
    return currentCompletions(v.state).map((o) => o.label)
  }

  it('shows mov first and movsw with it after typing mov', async () => {
    const v = editor('        |')
    type(v, 'mov')
    const labels = await popup(v)
    expect(labels[0]).toBe('mov')
    expect(labels).toContain('movsw')
    const info = currentCompletions(v.state).find((o) => o.label === 'movsw')?.info
    const card =
      typeof info === 'function' ? info(currentCompletions(v.state)[0] as Completion) : null
    expect((card as HTMLElement).querySelector('.cm-x16c-card-name')?.textContent).toBe('movsw')
  })

  it('lays the base idiom out from column 0, the label selected', async () => {
    const v = editor('        |')
    type(v, 'base')
    expect(await popup(v)).toEqual(['base idiom'])
    acceptCompletion(v)
    expect(v.state.doc.toString()).toBe(
      [
        'start:  call    .here',
        '.here:  pop     bx',
        '        sub     bx, .here               ; bx = our base address',
        '        ',
      ].join('\n'),
    )
    expect(v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to)).toBe('start')
    type(v, 'boot')
    expect(v.state.doc.line(1).text).toBe('boot:  call    .here')
  })

  it('links the child label of an spl fork', async () => {
    const v = editor('|')
    type(v, 'spl')
    expect(await popup(v)).toEqual(['spl', 'spl fork'])
    moveCompletionSelection(true)(v)
    acceptCompletion(v)
    expect(v.state.selection.ranges.map((r) => v.state.sliceDoc(r.from, r.to))).toEqual([
      'child',
      'child',
    ])
    type(v, 'bomber')
    expect(v.state.doc.toString()).toBe(
      [
        '        spl     bomber                ; a new process starts there',
        'parent:                              ; this one goes on here',
        '        ',
        'bomber:',
      ].join('\n'),
    )
  })

  it('puts %name text in quotes at column 10', async () => {
    const v = editor('|')
    type(v, '%na')
    expect(await popup(v)).toEqual(['%name'])
    acceptCompletion(v)
    expect(v.state.doc.toString()).toBe('%name     "name"')
    expect(v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to)).toBe('name')
  })
})
