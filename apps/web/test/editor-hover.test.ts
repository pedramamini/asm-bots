/**
 * The hover card (src/features/editor/cm/hover.ts, card.ts): which words get one, by any
 * spelling, and what the card says, from docs/opcodes.json.
 */
import { describe, expect, it } from 'bun:test'
import { Text } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { useDom } from '../../../packages/ui/test/dom'
import { opcodeCard } from '../src/features/editor/cm/card'
import { opcodeTooltipAt } from '../src/features/editor/cm/hover'
import { type OpcodeEntry, opcodeEntries, opcodeEntry } from '../src/features/editor/cm/opcodes'

const LINE = 'start:  REPNZ   scasb           ; je is jz'

/** The word a hover at `offset` in `text` shows a card for, or null. */
function hovered(text: string, offset: number, side: -1 | 1 = 1): string | null {
  const tooltip = opcodeTooltipAt(Text.of([text]), offset, side)
  return tooltip === null ? null : text.slice(tooltip.pos, tooltip.end)
}

describe('x16c hover: where', () => {
  it('gives a mnemonic or a prefix a card, in any case, and nothing else one', () => {
    expect(hovered(LINE, LINE.indexOf('REPNZ') + 2)).toBe('REPNZ')
    expect(hovered(LINE, LINE.indexOf('scasb') + 4)).toBe('scasb')
    for (const word of ['start', ':', ' je', 'jz']) {
      expect([word, hovered(LINE, LINE.indexOf(word) + 1)]).toEqual([word, null])
    }
    expect(hovered('        mov     ax, bx', 20)).toBeNull()
    expect(hovered('loop:   jmp     loop', 2)).toBeNull()
    expect(hovered('loop:   jmp     loop', 18)).toBeNull()
  })

  it('takes the word on the side of the pointer at a boundary', () => {
    const text = '        nop'
    expect(hovered(text, 8, 1)).toBe('nop')
    expect(hovered(text, 8, -1)).toBeNull()
    expect(hovered(text, 11, -1)).toBe('nop')
    expect(hovered(text, 11, 1)).toBeNull()
  })

  it('shows the card above the word, over the word', () => {
    const tooltip = opcodeTooltipAt(Text.of(['x', '        mov     ax, 1']), 12, 1)
    expect(tooltip).toMatchObject({ pos: 10, end: 13, above: true })
  })
})

describe('x16c hover: the card', () => {
  useDom()

  const card = (word: string) => {
    const entry = opcodeEntry(word) as OpcodeEntry
    return opcodeCard(entry)
  }
  const text = (root: HTMLElement, part: string) =>
    [...root.querySelectorAll(`.cm-x16c-card-${part}`)].map((n) => n.textContent)

  it('reads any spelling as the canonical entry', () => {
    expect(opcodeEntry('JE')?.name).toBe('jz')
    expect(opcodeEntry('sal')?.name).toBe('shl')
    expect(opcodeEntry('repz')).toMatchObject({ kind: 'prefix', name: 'repe' })
    expect(opcodeEntry('ax')).toBeUndefined()
    expect(opcodeEntries()).toHaveLength(81)
  })

  it('shows a mnemonic: name, spellings, family, summary, forms, flags, example', () => {
    const jz = card('je')
    expect(text(jz, 'name')).toEqual(['jz'])
    expect(text(jz, 'aliases')).toEqual(['je'])
    expect(text(jz, 'family')).toEqual(['control flow'])
    expect(text(jz, 'summary')).toEqual(['jump if zero, or equal: ZF=1'])
    expect(text(jz, 'label')).toEqual(['forms', 'flags', 'example'])
    const [forms, example] = [...jz.querySelectorAll('.cm-x16c-card-rows')]
    expect(forms?.textContent).toBe('jz rel874 cb')
    expect([...(example?.children ?? [])].map((n) => n.textContent)).toEqual([
      'scan:   add     si, 8',
      '83 C6 08',
      '        cmp     word [si], 0',
      '83 3C 00',
      '        jz      scan',
      '74 F8',
    ])
    expect(jz.querySelector('.cm-x16c-card-kills')).toBeNull()
  })

  it('lights the flags an instruction changes, and says them', () => {
    const flags = (word: string) => card(word).querySelector('.cm-x16c-card-flags') as HTMLElement
    const add = flags('add')
    expect([...add.children].map((n) => n.textContent).join('')).toBe('ODITSZAPC*---*****')
    expect([...add.querySelectorAll('[data-on]')].map((n) => n.textContent).join('')).toBe(
      'OSZAPC******',
    )
    expect(add.getAttribute('aria-label')).toBe(
      'O from the result, S from the result, Z from the result, A from the result, ' +
        'P from the result, C from the result',
    )
    expect(flags('clc').getAttribute('aria-label')).toBe('C cleared')
    expect(flags('std').getAttribute('aria-label')).toBe('D set')
    expect(flags('mov').getAttribute('aria-label')).toBe('no flag changes')
  })

  it('says when running the instruction kills', () => {
    expect(text(card('dat'), 'kills')).toEqual(['running it kills the process'])
    expect(text(card('int3'), 'family')).toEqual(['process control'])
  })

  it('shows a prefix with the instructions it takes and their bytes', () => {
    const rep = card('repnz')
    expect(text(rep, 'name')).toEqual(['repne'])
    expect(text(rep, 'aliases')).toEqual(['repnz'])
    expect(text(rep, 'family')).toEqual(['prefix'])
    expect(text(rep, 'code').slice(0, 4)).toEqual([
      'repne cmpsb',
      'repne cmpsw',
      'repne scasb',
      'repne scasw',
    ])
    expect(text(rep, 'bytes').slice(0, 4)).toEqual(['F2 A6', 'F2 A7', 'F2 AE', 'F2 AF'])
    expect(rep.querySelector('.cm-x16c-card-flags')).toBeNull()
  })

  it('builds a card for every entry', () => {
    for (const entry of opcodeEntries()) {
      const node = opcodeCard(entry)
      expect([entry.name, node.querySelectorAll('.cm-x16c-card-code').length > 1]).toEqual([
        entry.name,
        true,
      ])
    }
  })

  it('is a tooltip CodeMirror can mount', () => {
    const tooltip = opcodeTooltipAt(Text.of(['        movsw']), 9, 1)
    const view = null as unknown as EditorView
    const dom = tooltip?.create(view).dom
    expect(dom?.className).toBe('cm-x16c-card')
    expect(dom?.querySelector('.cm-x16c-card-name')?.textContent).toBe('movsw')
  })
})
