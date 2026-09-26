/**
 * The welcome tour's steps (PRODUCT_SPEC §9), in the order it walks the site: home, the arena's
 * setup and a battle, the editor, tournaments, hills, and the docs. Each step names the page it
 * stands on and the part of that page it lights (`WelcomeTour.tsx` dims the rest).
 */
import { Kbd } from '@asmbots/ui'
import type { ReactNode } from 'react'
import { NAV } from '../Frame'
import type { ArenaSearch } from '../../features/arena/setup/search'

export interface TourStep {
  /** Its name in the tests and the DOM (`data-tour-step`). */
  readonly id: string
  /** The page it stands on. */
  readonly path: string
  /** The page's query, when the tour goes there (the arena's bots). */
  readonly search?: ArenaSearch
  /**
   * A selector for the part of the page it lights; null for a card in the middle, over the whole
   * page dimmed. A target that never shows (hidden at this width) gets the middle too.
   */
  readonly target: string | null
  /**
   * A selector for a button that brings the target on this page: the arena's `fight` for the
   * battle's steps, its `setup` for the setup's. The tour clicks it while the target is missing.
   */
  readonly open?: string
  readonly title: string
  readonly body: ReactNode
}

/**
 * The arena, with the intro's bots picked at its seed, so `fight` is ready: `introSpec()` as the
 * URL writes it (the tests hold the two the same). Written out, so the tour's chunk carries none
 * of the arena's code, and the arena none of the tour's.
 */
export const TOUR_ARENA_SEARCH: ArenaSearch = {
  b: 'roster:dwarf,roster:imp',
  seed: 263,
  rounds: 1,
  cycles: 100_000,
  procs: 64,
  spacing: 1024,
}

const ARENA = { path: '/arena', search: TOUR_ARENA_SEARCH } as const

/** The battle's steps: the tour starts the fight when the page shows the setup. */
const BATTLE = { ...ARENA, open: '[data-tour="arena-fight"] button[name="fight"]' } as const

/** The setup's steps: the tour leaves the battle when the page shows one. */
const SETUP = { ...ARENA, open: '[data-tour="arena-exit"]' } as const

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: 'welcome',
    path: '/',
    target: null,
    title: 'welcome',
    body: (
      <>
        <p>
          ASM BOTS is Core War in 8086 assembly: you write a bot, load it into 64 KB of memory with
          other bots, and the last one running wins.
        </p>
        <p className="text-muted">
          This tour stops on every page and lights what matters there. <Kbd>enter</Kbd> goes on,{' '}
          <Kbd>←</Kbd> goes back, <Kbd>esc</Kbd> leaves.
        </p>
      </>
    ),
  },
  {
    id: 'nav',
    path: '/',
    target: 'header nav[aria-label="primary"]',
    title: 'the pages',
    body: (
      <p>
        Every page is up here. <Kbd>g</Kbd> then a letter goes to one: <Kbd>g</Kbd> <Kbd>a</Kbd>{' '}
        the arena, <Kbd>g</Kbd> <Kbd>e</Kbd> the editor.
      </p>
    ),
  },
  {
    id: 'header-tools',
    path: '/',
    target: 'header > div:last-child',
    title: 'theme, keys, account',
    body: (
      <p>
        Change the theme, list every key (<Kbd>?</Kbd>), and sign in with GitHub. Signed in, your
        bots follow you, and you can submit them to the hills.
      </p>
    ),
  },
  {
    id: 'site',
    path: '/',
    target: 'ul[aria-label="the site"]',
    title: 'the site',
    body: <p>Each part of the site: what it is, and the way in.</p>,
  },
  {
    id: 'how-it-works',
    path: '/',
    target: '[data-tour="how-it-works"]',
    title: 'how it works',
    body: (
      <p>
        The game in four pictures: the core, write, fight, climb. Read it once; it takes a minute.
      </p>
    ),
  },
  {
    id: 'home-hill',
    path: '/',
    target: '[data-tour="home-hill"]',
    title: 'the main hill',
    body: (
      <p>
        The main hill&rsquo;s top 10, live. Beside it: its latest matches, and the next weekly
        championship.
      </p>
    ),
  },
  {
    ...SETUP,
    id: 'arena-roster',
    target: '[data-tour="arena-roster"]',
    title: 'the arena: pick bots',
    body: (
      <>
        <p>
          The roster holds the classic bots. A card&rsquo;s <Kbd>+</Kbd> adds it to the fight.
        </p>
        <p className="text-muted">
          <b className="text-bright">my bots</b> are the ones you write in the editor;{' '}
          <b className="text-bright">paste</b> takes any source. Drop .asm files anywhere here.
        </p>
      </>
    ),
  },
  {
    ...SETUP,
    id: 'arena-config',
    target: '[data-tour="arena-config"]',
    title: 'the fight',
    body: (
      <p>
        Up to 16 bots in one core. The config sets the rounds, the cycle cap, and the seed; a
        preset fills them in for a duel or a melee.
      </p>
    ),
  },
  {
    ...SETUP,
    id: 'arena-fight',
    target: '[data-tour="arena-fight"]',
    title: 'fight',
    body: (
      <p>
        Fight loads each bot at a random address in one 64 KB core, and plays the battle. Next, the
        tour presses it: Dwarf vs Imp.
      </p>
    ),
  },
  {
    ...BATTLE,
    id: 'arena-core',
    target: '[data-tour="arena-core"]',
    title: 'the core',
    body: (
      <>
        <p>
          65,536 bytes that all bots share, one cell a byte. A cell&rsquo;s hue is the bot that
          wrote it last.
        </p>
        <p className="text-muted">
          A white outline is where a process runs next. Scroll to zoom, drag to pan.
        </p>
      </>
    ),
  },
  {
    ...BATTLE,
    id: 'arena-transport',
    target: '[data-tour="arena-transport"]',
    title: 'time',
    body: (
      <p>
        Each cycle, every live bot runs one instruction. <Kbd>space</Kbd> pauses, <Kbd>[</Kbd>{' '}
        <Kbd>]</Kbd> set the speed, and the slider goes to any cycle, back too.
      </p>
    ),
  },
  {
    ...BATTLE,
    id: 'arena-bots',
    target: '[data-tour="arena-bots"]',
    title: 'the bots',
    body: (
      <p>
        Each bot&rsquo;s processes, bytes, and writes. A process that runs a bad instruction (most
        often a zero byte) dies; a bot with none left is dead. Click a row to light only its bytes.
      </p>
    ),
  },
  {
    ...BATTLE,
    id: 'arena-events',
    target: '[data-tour="arena-events"]',
    title: 'how you win',
    body: (
      <p>
        Every death lands in this log; click a line to go back to it. The last bot alive wins the
        round. In a duel a win scores 3, a tie at the cycle cap 1.
      </p>
    ),
  },
  {
    id: 'editor-source',
    path: '/editor',
    target: 'section[aria-label="source"]',
    title: 'the editor: write a bot',
    body: (
      <p>
        A bot is 8086 machine code, 512 bytes at most, written in assembly. It assembles as you
        type. Start from a template, or from nothing.
      </p>
    ),
  },
  {
    id: 'editor-tools',
    path: '/editor',
    target: 'section[aria-label="editor tools"]',
    title: 'the toolbar and the debugger',
    body: (
      <p>
        Save, test against a roster bot, share a link, and pick a layout. <Kbd>F5</Kbd> debugs:
        one instruction at a time, with the registers and the core. A saved bot is in the
        arena&rsquo;s <b className="text-bright">my bots</b>.
      </p>
    ),
  },
  {
    id: 'tournaments',
    path: '/tournaments',
    target: '[data-tour="tournaments-list"]',
    title: 'tournaments',
    body: (
      <p>
        Round robins, brackets, and melees. Run one in your browser with any bots, or enter the
        weekly championship.
      </p>
    ),
  },
  {
    id: 'hills',
    path: '/hills',
    target: '[data-tour="hills-list"]',
    title: 'hills',
    body: (
      <p>
        Ladders that never close. Submit a bot: the server fights it against every entry, and the
        best stay on the hill.
      </p>
    ),
  },
  {
    id: 'docs',
    path: '/docs',
    target: '[data-tour="docs-nav"]',
    title: 'docs',
    body: (
      <p>
        The machine, every instruction, and how to write a bot that wins. <Kbd>/</Kbd> searches
        them.
      </p>
    ),
  },
  {
    id: 'done',
    path: '/',
    target: null,
    title: 'where everything is',
    body: (
      <>
        <p>
          That is the whole site. Watch a first battle with a guide, or look around. <Kbd>?</Kbd>{' '}
          lists every key.
        </p>
        <ul aria-label="the pages" className="flex flex-col gap-1">
          {NAV.map(({ to, label, icon: Icon, key }) => (
            <li key={to} className="flex items-center gap-2 text-data">
              <Icon aria-hidden="true" size={12} strokeWidth={1.75} className="text-accent" />
              <span className="flex-1 text-bright">{label}</span>
              <span className="flex gap-0.5">
                <Kbd>g</Kbd>
                <Kbd>{key}</Kbd>
              </span>
            </li>
          ))}
        </ul>
      </>
    ),
  },
]
