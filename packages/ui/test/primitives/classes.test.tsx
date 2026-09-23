import { beforeAll, describe, expect, it } from 'bun:test'
import { fireEvent, render } from '@testing-library/react'
import { Header, Panel, PanelGrid, SplitPane, StatusBar, Ticker, Toolbar } from '../../src/index'
import { stubLayout, useDom } from '../dom'
import { compileKit } from '../tailwind'

useDom()

let build: (candidates: string[]) => string = () => ''
beforeAll(async () => {
  const kit = await compileKit()
  build = (candidates) => kit.build(candidates)
})

/** A group marker names a parent for `group-*` variants and has no rule of its own. */
const MARKER = /^group(\/[\w-]+)?$/

/** True when `css` has a rule for the class `name`: its escaped selector, and no more name after. */
function hasRule(css: string, name: string): boolean {
  const selector = `.${name.replace(/[^\w-]/g, (ch) => `\\${ch}`)}`
  return new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(?![\\w\\\\-])`).test(css)
}

describe('the primitives’ classes', () => {
  it('each compile to a rule, in every state (a mistyped class is otherwise silent)', () => {
    // The states that add classes: a marquee, a drag in each direction, a dense panel.
    const undo = [stubLayout('scrollWidth', () => 900), stubLayout('clientWidth', () => 300)]
    try {
      render(
        <>
          <Ticker items={['live', 'cycle 12']} link={{ href: '/', label: 'home' }} />
          <Header
            brand="ASM BOTS"
            stat="8 bots"
            nav={<a href="/arena">arena</a>}
            right={<button type="button">theme</button>}
          />
          <Toolbar>
            <button type="button">run</button>
          </Toolbar>
          <PanelGrid>
            <Panel title="arena" status="live" actions={<button type="button">refresh</button>} />
            <Panel title="queue" dense />
          </PanelGrid>
          <SplitPane label="rows">
            <p>editor</p>
            <p>debugger</p>
          </SplitPane>
          <SplitPane label="columns" direction="column">
            <p>editor</p>
            <p>arena</p>
          </SplitPane>
          <StatusBar left="ok" center="made with maestro" right="60 fps" />
        </>,
      )
    } finally {
      for (const restore of undo) restore()
    }
    for (const divider of document.querySelectorAll('[role=separator]')) {
      fireEvent.pointerDown(divider, { pointerId: 1, button: 0 })
    }
    expect(document.querySelector('[inert]')).not.toBeNull()
    expect(document.querySelectorAll('[data-dragging]')).toHaveLength(2)

    const names = new Set(
      [...document.body.querySelectorAll('[class]')].flatMap((element) => [...element.classList]),
    )
    const css = build([...names])
    expect([...names].filter((name) => !MARKER.test(name) && !hasRule(css, name))).toEqual([])
    expect(names.size).toBeGreaterThan(80)
  })

  it('catches a mistyped class', async () => {
    // A compiler of its own: a compiler's output holds every class it has built so far.
    const css = (await compileKit()).build(['bg-panel', 'text-mutd', 'p-2.5'])
    expect(hasRule(css, 'bg-panel')).toBe(true)
    expect(hasRule(css, 'text-mutd')).toBe(false)
    expect(hasRule(css, 'p-2')).toBe(false)
  })
})
