import { describe, expect, it } from 'bun:test'
import { TABBABLE, tabbables } from '../src/focus'
import { graphicRole } from '../src/graphic'
import { BOT_HUES, HUE_COUNT, hueColor, wrapsHue } from '../src/index'
import { useDom } from './dom'

useDom()

describe('hueColor', () => {
  it('turns a bot index into its hue variable, wrapping at 12', () => {
    expect(HUE_COUNT).toBe(12)
    expect(HUE_COUNT).toBe(BOT_HUES.sentinel.length)
    expect([0, 3, 11, 12, 14, 25].map(hueColor)).toEqual([
      'var(--bot-0)',
      'var(--bot-3)',
      'var(--bot-11)',
      'var(--bot-0)',
      'var(--bot-2)',
      'var(--bot-1)',
    ])
  })

  it('keeps a string as it is, and holds odd indexes to a hue', () => {
    expect(hueColor('#FF5C5C')).toBe('#FF5C5C')
    expect(hueColor('var(--accent)')).toBe('var(--accent)')
    expect(hueColor(-1)).toBe('var(--bot-11)')
    expect(hueColor(3.7)).toBe('var(--bot-3)')
  })
})

describe('wrapsHue', () => {
  it('is true from bot 12 up, which shares a hue with a lower bot', () => {
    expect([0, 11, 12, 13, 15, 24].map(wrapsHue)).toEqual([false, false, true, true, true, true])
    expect(wrapsHue('var(--bot-0)')).toBe(false)
  })
})

describe('graphicRole', () => {
  it('names an SVG an image when it has a label, and hides it when not', () => {
    expect(graphicRole({})).toEqual({ 'aria-hidden': true })
    expect(graphicRole({ 'aria-label': 'dwarf' })).toEqual({ role: 'img' })
    expect(graphicRole({ 'aria-labelledby': 'bot-name' })).toEqual({ role: 'img' })
    expect(graphicRole({ 'aria-label': '' })).toEqual({ role: 'img' })
  })
})

describe('tabbables', () => {
  it('lists the Tab stops in document order, and skips what Tab skips', () => {
    // Detached: a failure here leaves nothing in the document the next test file renders into.
    const root = document.createElement('div')
    root.innerHTML = `
      <a href="/arena">arena</a>
      <a>no href</a>
      <button>run</button>
      <button disabled>off</button>
      <input aria-label="search">
      <input type="hidden" name="token">
      <input disabled aria-label="off">
      <select aria-label="hill"></select>
      <textarea aria-label="source"></textarea>
      <div tabindex="0">splitter</div>
      <div tabindex="-1">pill</div>
      <span>text</span>`
    const stops = tabbables(root).map((e) => e.textContent || e.getAttribute('aria-label'))
    expect(stops).toEqual(['arena', 'run', 'search', 'hill', 'source', 'splitter'])
    expect(root.querySelector('div[tabindex="-1"]')?.matches(TABBABLE)).toBe(false)
  })
})
