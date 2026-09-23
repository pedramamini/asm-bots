import { beforeAll, describe, expect, it, jest } from 'bun:test'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { Copy, Grid2x2, Play, ShieldCheck, StepBack, Trash2 } from 'lucide-react'
import {
  Button,
  Chip,
  Header,
  IconButton,
  Input,
  Kbd,
  Menu,
  NavButton,
  Panel,
  PanelGrid,
  Segmented,
  Select,
  Slider,
  SplitPane,
  StatusBar,
  Ticker,
  Toggle,
  Toolbar,
} from '../../src/index'
import { stubLayout, useDom } from '../dom'
import { compileKit } from '../tailwind'

useDom()

let build: (candidates: string[]) => string = () => ''
beforeAll(async () => {
  const kit = await compileKit()
  build = (candidates) => kit.build(candidates)
})

/**
 * Classes with no rule of their own: a group marker names a parent for `group-*` variants, and
 * lucide names its icons (`lucide lucide-play`).
 */
const MARKER = /^(group(\/[\w-]+)?|lucide(-[\w-]+)?)$/

/** True when `css` has a rule for the class `name`: its escaped selector, and no more name after. */
function hasRule(css: string, name: string): boolean {
  const selector = `.${name.replace(/[^\w-]/g, (ch) => `\\${ch}`)}`
  return new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(?![\\w\\\\-])`).test(css)
}

/** Every control in every state that changes its classes, the tooltip and the menu open. */
function Controls() {
  return (
    <>
      <NavButton href="/arena" icon={Grid2x2} active>
        arena
      </NavButton>
      <NavButton href="/editor" icon={Grid2x2}>
        editor
      </NavButton>
      <Button>refresh</Button>
      <Button variant="primary" icon={Play}>
        fight
      </Button>
      <Button variant="ghost" size="sm">
        clear
      </Button>
      <Button variant="danger" disabled>
        delete
      </Button>
      <Button loading>submit</Button>
      <IconButton icon={StepBack} label="step back" shortcut="," />
      <IconButton icon={StepBack} label="minimap" size="sm" pressed />
      <Segmented
        label="range"
        options={['week', 'month', { value: 'year', disabled: true }]}
        defaultValue="week"
      />
      <Input aria-label="search" />
      <Input aria-label="goto" mono prompt={null} />
      <Select aria-label="hill">
        <option>all hills</option>
      </Select>
      <Slider aria-label="volume" min={0} max={100} />
      <Slider aria-label="speed" min={1} max={10_000} scale="log" showValue />
      <Toggle>alpr</Toggle>
      <Toggle defaultPressed>bloom</Toggle>
      <Chip>3 active</Chip>
      <Chip variant="accent" icon={ShieldCheck}>
        verified
      </Chip>
      <Chip variant="warn">warn</Chip>
      <Chip variant="danger">dead</Chip>
      <Chip variant="info">info</Chip>
      <Kbd>space</Kbd>
      <Menu
        trigger={<Button>templates</Button>}
        items={[
          { label: 'blank', onSelect() {} },
          { label: 'dwarf', icon: Copy, shortcut: 'd', onSelect() {} },
          { label: 'scanner', disabled: true, onSelect() {} },
          'separator',
          { label: 'delete', icon: Trash2, danger: true, onSelect() {} },
        ]}
      />
    </>
  )
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
          <Controls />
        </>,
      )
    } finally {
      for (const restore of undo) restore()
    }
    // Open the tooltip and the menu.
    jest.useFakeTimers()
    try {
      fireEvent.pointerEnter(screen.getByRole('button', { name: 'step back' }), {
        pointerType: 'mouse',
      })
      act(() => {
        jest.advanceTimersByTime(400)
      })
    } finally {
      jest.useRealTimers()
    }
    fireEvent.click(screen.getByRole('button', { name: 'templates' }))
    expect(document.querySelector('[role=tooltip]')).not.toBeNull()
    expect(document.querySelector('[role=menu]')).not.toBeNull()
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
    expect(names.size).toBeGreaterThan(180)
  })

  it('catches a mistyped class', async () => {
    // A compiler of its own: a compiler's output holds every class it has built so far.
    const css = (await compileKit()).build(['bg-panel', 'text-mutd', 'p-2.5'])
    expect(hasRule(css, 'bg-panel')).toBe(true)
    expect(hasRule(css, 'text-mutd')).toBe(false)
    expect(hasRule(css, 'p-2')).toBe(false)
  })
})
