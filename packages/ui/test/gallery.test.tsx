import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { readdirSync } from 'node:fs'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ArenaMock } from '../src/gallery/ArenaMock'
import { battle, footprints, HOTSPOT } from '../src/gallery/battle'
import { BATTLE_BOTS, random } from '../src/gallery/data'
import { GALLERY_THEME_PARAM, Gallery } from '../src/gallery/Gallery'
import { THEME_STORAGE_KEY, THEMES } from '../src/index'
import { stubLayout, useDom, window } from './dom'
import { compileKit, hasRule, MARKER, SRC } from './tailwind'

useDom()

/** The kit's primitives: a file each in src/primitives. */
const PRIMITIVES = readdirSync(`${SRC}primitives`)
  .filter((file) => file.endsWith('.tsx'))
  .map((file) => file.slice(0, -'.tsx'.length))
  .sort()

// jsdom has no canvas: its getContext reports "not implemented" on the console. The arena draws
// nothing here, and says so quietly.
const canvas = window.HTMLCanvasElement.prototype
const getContext = Object.getOwnPropertyDescriptor(canvas, 'getContext')
beforeAll(() => {
  Object.defineProperty(canvas, 'getContext', { configurable: true, value: () => null })
})
afterAll(() => {
  if (getContext) Object.defineProperty(canvas, 'getContext', getContext)
})

afterEach(() => {
  // The gallery borrows the page's theme and query; each test starts on a bare page.
  cleanup()
  delete document.documentElement.dataset.theme
  window.history.replaceState(null, '', '/')
})

/** Opens the gallery at `query`, as `/_gallery?…` would. */
function openGallery(query = '') {
  window.history.replaceState(null, '', `/_gallery${query}`)
  return render(<Gallery />)
}

const theme = () => document.documentElement.dataset.theme
const sheets = (root: ParentNode = document) =>
  [...root.querySelectorAll<HTMLElement>('[data-specimen]')].map((el) => el.dataset.specimen)
const figure = (route: string) =>
  screen
    .getAllByRole('figure')
    .find((el) => el.querySelector('figcaption')?.textContent?.startsWith(route))

describe('Gallery', () => {
  it('shows every primitive of the kit on a sheet of its own, a region named after it', () => {
    openGallery()
    expect(PRIMITIVES).toHaveLength(33)
    expect(sheets().sort()).toEqual(PRIMITIVES)
    for (const name of PRIMITIVES) expect(screen.getByRole('region', { name })).toBeTruthy()
  })

  it('counts its sheets right: the header and each section note', () => {
    openGallery()
    expect(screen.getByText(/primitives · 3 layouts/).textContent).toContain(
      `${PRIMITIVES.length} primitives`,
    )
    for (const [id, count] of [
      ['layout', 7],
      ['controls', 12],
      ['data', 14],
    ] as const) {
      const section = document.getElementById(id) as HTMLElement
      expect(sheets(section)).toHaveLength(count)
      expect(section.textContent).toContain(`${count} primitives`)
    }
  })

  it('assembles the three reference layouts of §4 from the frame grammar', () => {
    openGallery()
    expect(screen.getAllByRole('figure')).toHaveLength(3)
    for (const [route, toolbar] of [
      ['arena', false],
      ['hills', true],
      ['tournaments', false],
    ] as const) {
      const frame = within(figure(route) as HTMLElement)
      expect(frame.getByRole('marquee')).toBeTruthy()
      expect(frame.getByRole('link', { current: 'page' }).textContent).toBe(route)
      expect(frame.queryAllByRole('toolbar')).toHaveLength(toolbar ? 1 : 0)
      expect(frame.getByText('made with maestro')).toBeTruthy()
    }
    // The tournament page is loading: the radar over it, a status region.
    expect(within(figure('tournaments') as HTMLElement).getByRole('status').textContent).toContain(
      'loading tournament',
    )
  })

  it('opens in the theme ?theme= names, and does not store it', () => {
    openGallery(`?${GALLERY_THEME_PARAM}=paper`)
    expect(theme()).toBe('paper')
    expect(screen.getByRole('radio', { name: 'paper' }).getAttribute('aria-checked')).toBe('true')
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()
  })

  it('without a theme in the query, keeps the page’s, else takes the stored one', () => {
    document.documentElement.dataset.theme = 'amber'
    openGallery('?theme=neon')
    expect(theme()).toBe('amber')
    cleanup()
    delete document.documentElement.dataset.theme
    window.localStorage.setItem(THEME_STORAGE_KEY, 'ice')
    openGallery()
    expect(theme()).toBe('ice')
  })

  it('switches the theme from the switcher, keeps ?theme= in step, and stores nothing', () => {
    openGallery('?theme=sentinel&keep=1')
    const switcher = screen.getByRole('radiogroup', { name: 'theme' })
    expect(
      within(switcher)
        .getAllByRole('radio')
        .map((pill) => pill.textContent),
    ).toEqual([...THEMES])
    fireEvent.click(within(switcher).getByRole('radio', { name: 'pedurple' }))
    expect(theme()).toBe('pedurple')
    const query = new URLSearchParams(window.location.search)
    expect([query.get(GALLERY_THEME_PARAM), query.get('keep')]).toEqual(['pedurple', '1'])
    expect(screen.getByText('?theme=pedurple')).toBeTruthy()
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()
  })

  it('gives the stored theme back when it unmounts', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'amber')
    const { unmount } = openGallery('?theme=paper')
    expect(theme()).toBe('paper')
    unmount()
    expect(theme()).toBe('amber')
  })

  it('is ready for a screenshot at once where there is no font API to wait for', () => {
    openGallery()
    expect(document.querySelector('[data-gallery-ready]')).not.toBeNull()
  })

  it('marks each state to force with pseudo-classes and a target that exist', () => {
    openGallery()
    const marked = [...document.querySelectorAll<HTMLElement>('[data-force]')]
    expect(marked.length).toBeGreaterThan(20)
    for (const element of marked) {
      const states = (element.dataset.force ?? '').split(' ')
      expect(states.every((state) => ['hover', 'focus', 'focus-visible'].includes(state))).toBe(
        true,
      )
      const target = element.dataset.forceTarget
      if (target !== undefined) expect(element.querySelector(target)).not.toBeNull()
    }
  })

  it('holds what the Playwright spec opens: the menu, the tooltip, the toasts, the modal', () => {
    openGallery()
    const menu = within(screen.getByRole('region', { name: 'Menu' }))
    fireEvent.click(menu.getByRole('button', { name: /templates/ }))
    expect(screen.getByRole('menu')).toBeTruthy()
    const tooltip = within(screen.getByRole('region', { name: 'Tooltip' }))
    expect(tooltip.getByRole('button', { name: 'step back' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'send 3 toasts' }))
    const stack = screen.getByRole('region', { name: 'notifications' })
    expect(within(stack).getAllByRole('listitem')).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: 'open md' }))
    expect(screen.getByRole('dialog', { name: 'submit to hill' })).toBeTruthy()
  })

  it('uses only classes that compile (a mistyped class is otherwise silent)', async () => {
    openGallery()
    const names = new Set(
      [...document.body.querySelectorAll('[class]')].flatMap((element) => [...element.classList]),
    )
    const css = (await compileKit()).build([...names])
    expect([...names].filter((name) => !MARKER.test(name) && !hasRule(css, name))).toEqual([])
  })
})

describe('the gallery’s battle', () => {
  it('agrees with the placeholder data: 8 bots, 41 processes, 2 dead', () => {
    const state = battle()
    expect(state.processes).toHaveLength(41)
    expect(BATTLE_BOTS.reduce((sum, bot) => sum + bot.procs, 0)).toBe(41)
    expect([...state.dead].sort()).toEqual(
      BATTLE_BOTS.filter((bot) => bot.died !== null).map((bot) => bot.index),
    )
    // Only the live bots run, and every bot holds ground.
    expect(state.processes.every((process) => !state.dead.has(process.bot))).toBe(true)
    expect(footprints(state, BATTLE_BOTS.length).every((bytes) => bytes > 0)).toBe(true)
  })

  it('comes from a seeded generator, so every screenshot draws the same battle', () => {
    const draw = (seed: number) => Array.from({ length: 8 }, random(seed))
    expect(draw(0x1a2f)).toEqual(draw(0x1a2f))
    expect(draw(0x1a2f)).not.toEqual(draw(0x1a30))
    // The zoomed sheet's hot spot holds the copy of paper-v2 (bot 3, owner 4) that runs there.
    expect(battle().owner[HOTSPOT + 0x604]).toBe(4)
  })
})

describe('ArenaMock', () => {
  it('rules the whole core every 0x800 bytes, bold every 0x1000, with no column ruler', () => {
    const { container } = render(<ArenaMock theme="sentinel" label="core" />)
    const labels = [...container.querySelectorAll('[aria-hidden] span')]
    expect(labels.map((label) => label.textContent)).toEqual(
      Array.from(
        { length: 32 },
        (_, n) => `0x${(n * 0x800).toString(16).toUpperCase().padStart(4, '0')}`,
      ),
    )
    expect(labels.filter((label) => label.classList.contains('font-bold'))).toHaveLength(16)
  })

  it('from 4x, rules the columns every 0x10, counted from the origin’s column', () => {
    // 40 columns and 16 rows of 8 px, beside the 44 px ruler and under the 14 px column ruler.
    const undo = [
      stubLayout('clientWidth', () => 44 + 8 * 40),
      stubLayout('clientHeight', () => 14 + 8 * 16),
    ]
    try {
      const { container } = render(
        <ArenaMock theme="sentinel" label="zoom" cell={8} origin={HOTSPOT} />,
      )
      const texts = [...container.querySelectorAll('[aria-hidden] span')].map((s) => s.textContent)
      // Rows 0x58 … 0x67 and columns 0x10 … 0x37 are in view.
      expect(texts).toEqual(['0x5800', '0x6000', '10', '20', '30'])
    } finally {
      for (const restore of undo) restore()
    }
  })
})
