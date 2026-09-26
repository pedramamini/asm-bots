/**
 * The help panel's topics (`help/topics.ts`): the word under the cursor as an instruction, a
 * prefix, a directive, or a register; its docs link; and the search over them all.
 */
import { describe, expect, it } from 'bun:test'
import { createCursorTopic } from '../src/features/editor/help/cursor'
import {
  allTopics,
  docsHref,
  searchTopics,
  topicAtLine,
  topicOf,
} from '../src/features/editor/help/topics'

describe('help topics', () => {
  it('reads the word under the cursor, or the word it ends', () => {
    const line = 'start:  mov     word [di], 0'
    expect(topicAtLine(line, 9)?.name).toBe('mov')
    expect(topicAtLine(line, 11)?.name).toBe('mov')
    expect(topicAtLine(line, 22)?.name).toBe('di')
    // A label, a size word, a number: no topic.
    expect(topicAtLine(line, 2)).toBeNull()
    expect(topicAtLine(line, 18)).toBeNull()
    expect(topicAtLine('%name "Dwarf"', 3)?.name).toBe('%name')
    expect(topicAtLine('STRIDE  equ     4', 9)?.kind).toBe('directive')
  })

  it('reads a spelling as its instruction, and a half as its register', () => {
    expect(topicOf('JE')?.name).toBe('jz')
    expect(topicOf('rep')?.kind).toBe('opcode')
    expect(topicOf('cl')).toMatchObject({ kind: 'register', name: 'cx' })
    expect(topicOf('nope')).toBeNull()
  })

  it("links each topic to its place in the docs' reference", () => {
    const href = (word: string) => docsHref(topicOf(word) ?? (null as never))
    expect(href('mov')).toBe('/docs/reference/data#mov')
    expect(href('shl')).toBe('/docs/reference/shifts#shl')
    expect(href('cld')).toBe('/docs/reference/string#cld')
    expect(href('clc')).toBe('/docs/reference/flag-ops#clc')
    expect(href('repne')).toBe('/docs/reference/string#repne')
    expect(href('%strategy')).toBe('/docs/reference/directives#metadata')
    expect(href('db')).toBe('/docs/reference/directives#data-and-space')
    expect(href('sp')).toBe('/docs/reference/registers#the-registers')
  })

  it('finds a name first, then a name it starts, then words of what it does', () => {
    expect(searchTopics('')).toEqual([])
    const names = (q: string) => searchTopics(q).map((t) => t.name)
    expect(names('mov')[0]).toBe('mov')
    expect(names('mov').slice(1)).toContain('movsb')
    expect(names('subtract')).toContain('sub')
    expect(names('stack pointer')).toEqual(['sp'])
    expect(names('%na')).toEqual(['%name'])
    expect(names('zzzz')).toEqual([])
  })

  it('has a topic for every instruction and prefix, each once', () => {
    const topics = allTopics()
    const keys = topics.map((t) => `${t.kind}:${t.name}`)
    expect(new Set(keys).size).toBe(keys.length)
    expect(topics.filter((t) => t.kind === 'opcode').length).toBeGreaterThan(80)
  })
})

describe('the cursor topic', () => {
  it('tells its listeners only when the word changes', () => {
    const store = createCursorTopic()
    let calls = 0
    const off = store.subscribe(() => calls++)
    store.set('mov')
    store.set('mov')
    store.set(null)
    expect([store.get(), calls]).toEqual([null, 2])
    off()
    store.set('add')
    expect(calls).toBe(2)
  })
})
