import {
  Chip,
  cx,
  Header,
  IconButton,
  IconLink,
  Kbd,
  KeyHelp,
  Modal,
  NavButton,
  StatusBar,
  Ticker,
  Toolbar,
  type ToolbarProps,
  Tooltip,
} from '@asmbots/ui'
import { useQueryClient } from '@tanstack/react-query'
import { createLink, Link, useLocation, useRouter } from '@tanstack/react-router'
import {
  BookOpen,
  CodeXml,
  Grid2x2,
  House,
  Keyboard,
  Mountain,
  Palette,
  Trophy,
} from 'lucide-react'
import {
  createContext,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { useMe } from '../api/queries'
import { AccountSlot } from '../features/account/AccountSlot'
import { useSettings } from '../store/settings'
import { BootLayer } from './boot/BootLayer'
import { GitHubIcon } from './github-icon'
import { GLOBAL_KEYS, goKey } from './keymaps'
import {
  focusRouteSearch,
  type KeyCommand,
  useKeyBindings,
  useKeymapListener,
  useKeys,
} from './keys'
import { useOnline } from './online'
import { AboutButton } from './PageIntro'
import { usePaintedAndIdle } from './paint'
import { SOURCE_URL } from './site'
import { useFps, useHeaderAbout, useHeaderStat } from './slots'
import { useTicker } from './ticker'
import { BRAND, useRouteHead } from './title'
import { RELEASE, VERSION, versionTitle } from './version'

/**
 * The header's routes (DESIGN_SYSTEM §6 icons), and the second key of each `g` chord. Home is
 * first, and current only on `/` itself: every other route starts with `/` too.
 */
export const NAV = [
  { to: '/', label: 'home', icon: House, key: 'o' },
  { to: '/arena', label: 'arena', icon: Grid2x2, key: 'a' },
  { to: '/editor', label: 'editor', icon: CodeXml, key: 'e' },
  { to: '/tournaments', label: 'tournaments', icon: Trophy, key: 't' },
  { to: '/hills', label: 'hills', icon: Mountain, key: 'h' },
  { to: '/docs', label: 'docs', icon: BookOpen, key: 'd' },
] as const

/** The instruction set the engine runs, as the status bar names it. */
export const ISA = 'x16c v1'

/** Under this frame rate the status bar's fps chip warns, and its tooltip names the fix. */
export const FPS_WARN = 50

/** A nav button the router drives: it preloads on intent and navigates without a reload. */
export const NavLink = createLink(NavButton)

/** The first-sign-in dialog: its own chunk, since only a new user ever sees it. */
const FirstSignIn = lazy(() =>
  import('../features/account/FirstSignIn').then((m) => ({ default: m.FirstSignIn })),
)

/** The `mod+k` menu: its own chunk, loaded on the first press. */
const CommandMenu = lazy(() => import('./CommandMenu').then((m) => ({ default: m.CommandMenu })))

/** The site's footer, the hills' dither range and the links: after the page paints, in a chunk of its own. */
const SiteFooter = lazy(() => import('./SiteFooter').then((m) => ({ default: m.SiteFooter })))

/** The routes that fill the screen, and so have no footer: an app, not a page. */
const FULL_SCREEN = ['/arena', '/editor', '/embed'] as const

/** Whether a page at `pathname` ends in the footer. */
export function hasFooter(pathname: string): boolean {
  return !FULL_SCREEN.some((path) => pathname === path || pathname.startsWith(`${path}/`))
}

/** Where a route's `FrameToolbar` renders: the row between the header and the content. */
const ToolbarSlot = createContext<HTMLElement | null>(null)

/**
 * The page chrome of DESIGN_SYSTEM §4 around a route: the ticker, the header (brand, the route's
 * stat, the nav, theme and keys), the route's optional toolbar, the content, and the status row.
 * It also owns the global keys and the key help.
 */
export function Frame({ children }: { children: ReactNode }) {
  const [toolbar, setToolbar] = useState<HTMLElement | null>(null)
  const [keysOpen, setKeysOpen] = useState(false)
  /** The command menu's first search while it is open; null while it is closed. */
  const [menu, setMenu] = useState<string | null>(null)
  const bindings = useKeyBindings()
  useGlobalKeys(
    useCallback(() => setKeysOpen((open) => !open), []),
    useCallback(() => setMenu((query) => (query === null ? '' : null)), []),
  )
  const openKeys = useCallback(() => setKeysOpen(true), [])
  useKeymapListener()
  const footer = hasFooter(useLocation({ select: (location) => location.pathname }))
  const idle = usePaintedAndIdle()

  return (
    <div className="flex h-dvh flex-col bg-bg text-text">
      <SkipLink />
      {/* A landmark, so the ticker is not content outside every region. */}
      <aside aria-label="ticker">
        <FrameTicker />
      </aside>
      <Header
        brand={<Brand />}
        stat={<HeaderStat />}
        nav={<Nav />}
        right={<HeaderActions onKeys={openKeys} onThemes={() => setMenu('theme')} />}
      />
      <div ref={setToolbar} className="contents" />
      <ToolbarSlot value={toolbar}>
        {/* The scroll padding: a Tab stop scrolled into view keeps its focus ring clear of the edge. */}
        <main
          id={CONTENT_ID}
          tabIndex={-1}
          className="relative min-h-0 flex-1 scroll-py-2 overflow-auto outline-none"
        >
          {footer ? (
            // The page fills the height at least, so a short page's footer stands at the bottom.
            <div className="flex min-h-full flex-col">
              <div className="flex-1">{children}</div>
              {idle && (
                <Suspense fallback={null}>
                  <SiteFooter />
                </Suspense>
              )}
            </div>
          ) : (
            children
          )}
        </main>
      </ToolbarSlot>
      <FrameStatus />
      <Modal open={keysOpen} onClose={() => setKeysOpen(false)} title="keys" size="lg">
        <KeyHelp bindings={bindings} />
      </Modal>
      {menu !== null && (
        <Suspense fallback={null}>
          <CommandMenu query={menu} onClose={() => setMenu(null)} />
        </Suspense>
      )}
      <Onboarding />
      <BootLayer />
    </div>
  )
}

/** The first-sign-in dialog, while the signed-in user has not picked a handle (PRODUCT_SPEC §9). */
function Onboarding() {
  const { data: me } = useMe()
  const client = useQueryClient()
  const [dismissed, setDismissed] = useState(false)
  if (!me || me.onboarded || dismissed) return null
  return (
    <Suspense fallback={null}>
      <FirstSignIn
        me={me}
        onDone={(next) => {
          setDismissed(true)
          client.setQueryData(['me'], next)
        }}
      />
    </Suspense>
  )
}

/**
 * A route's filter row, drawn by the frame under the header while the route is mounted. It sits
 * between the banner and the main content, so it is a landmark of its own: `editor tools`.
 */
export function FrameToolbar(props: ToolbarProps) {
  const slot = useContext(ToolbarSlot)
  const label = props['aria-label']
  return slot === null
    ? null
    : createPortal(
        <section aria-label={label === undefined ? 'page tools' : `${label} tools`}>
          <Toolbar {...props} />
        </section>,
        slot,
      )
}

/** The main content's id: the skip link's target. */
export const CONTENT_ID = 'content'

/**
 * The first Tab stop of every page (DESIGN_SYSTEM §8): above the window until focused, it moves
 * focus past the ticker, the header, and the nav to the main content. It focuses the content
 * itself and leaves the URL alone: a page's fragment can carry a shared bot or a replay.
 */
function SkipLink() {
  return (
    <a
      href={`#${CONTENT_ID}`}
      onClick={(event) => {
        event.preventDefault()
        document.getElementById(CONTENT_ID)?.focus()
      }}
      className="fixed top-1 left-1 z-modal -translate-y-12 rounded-sm border border-accent bg-panel px-2.5 py-1 text-nav text-accent-fg focus-visible:translate-y-0 focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-accent"
    >
      skip to content
    </a>
  )
}

/** `?`, `mod+k`, `/`, and the `g` chords. */
function useGlobalKeys(toggleKeys: () => void, toggleMenu: () => void): void {
  const router = useRouter()
  const commands = useMemo<KeyCommand[]>(
    () => [
      { ...GLOBAL_KEYS.help, run: toggleKeys },
      { ...GLOBAL_KEYS.commands, run: toggleMenu },
      { ...GLOBAL_KEYS.search, run: focusRouteSearch },
      ...NAV.map(({ to, label, key }) => ({
        ...goKey(key, label),
        run: () => void router.navigate({ to }),
      })),
    ],
    [router, toggleKeys, toggleMenu],
  )
  useKeys(commands)
}

/**
 * `ASM BOTS // ARENA`, a link home, and the page's `ⓘ` when it has one (`useRouteAbout`). Under
 * `md` the page's name goes, since the nav's active button says it; the `ⓘ` stays.
 */
function Brand() {
  const { label } = useRouteHead()
  const about = useHeaderAbout((state) => state.about)
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Link
        to="/"
        className="min-w-0 truncate-ring rounded-sm focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-accent"
      >
        {BRAND}
        {label !== null && (
          <span className="text-muted max-md:hidden">{` // ${label.toUpperCase()}`}</span>
        )}
      </Link>
      {about !== null && <AboutButton about={about} />}
    </span>
  )
}

/** Its own component: the stat may change every frame, and only this line need redraw. */
function HeaderStat() {
  return useHeaderStat((state) => state.stat)
}

/** Whether the nav's `to` is the page at `pathname`, or holds it. Home holds nothing. */
export function navActive(to: string, pathname: string): boolean {
  return pathname === to || (to !== '/' && pathname.startsWith(`${to}/`))
}

/** The six routes; under `md` each is its icon alone, its label left to screen readers. */
function Nav() {
  const pathname = useLocation({ select: (location) => location.pathname })
  return NAV.map(({ to, label, icon }) => (
    <NavLink key={to} to={to} icon={icon} active={navActive(to, pathname)}>
      <span className="max-md:sr-only">{label}</span>
    </NavLink>
  ))
}

function HeaderActions({ onKeys, onThemes }: { onKeys: () => void; onThemes: () => void }) {
  const theme = useSettings((state) => state.theme)
  return (
    <>
      {/* The command menu, on its themes. Under `md` the keys (a keyboard's help) go, so the row
          fits a phone. */}
      <IconButton icon={Palette} label={`theme: ${theme}`} shortcut="mod+k" onClick={onThemes} />
      <IconButton
        icon={Keyboard}
        label="keys"
        shortcut="?"
        onClick={onKeys}
        className="max-md:hidden"
      />
      {/* Under `md` the footer's source link stands in: the row fits a phone. */}
      <IconLink
        icon={GitHubIcon}
        label="source on github"
        href={SOURCE_URL}
        className="max-md:hidden"
      />
      <AccountSlot />
    </>
  )
}

function FrameTicker() {
  const router = useRouter()
  const { items, link } = useTicker()
  return (
    <Ticker
      items={items}
      link={{
        href: link.to,
        label: link.label,
        onClick: (event) => {
          event.preventDefault()
          void router.navigate({ to: link.to })
        },
      }}
    />
  )
}

/**
 * The status bar's left end: `● local`, or offline, the banner that says what still works there.
 * A live region, so a screen reader hears the network come and go.
 */
function NetworkStatus() {
  const online = useOnline()
  return (
    <span role="status" className="flex min-w-0 items-center gap-2">
      {online ? (
        <Chip variant="accent">● local</Chip>
      ) : (
        <>
          <Chip variant="warn">○ offline</Chip>
          <span className="truncate">arena, editor, and local tournaments still work</span>
        </>
      )}
    </span>
  )
}

/** A status chip's keyboard focus: the kit's 1 px accent outline, 2 px out. */
const CHIP_FOCUS =
  'rounded-sm focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent'

/** A chip that is a link: the accent under the pointer. */
const CHIP_LINK = 'transition-colors duration-120 ease-out hover:text-accent-fg'

function FrameStatus() {
  const fps = useFps((state) => state.fps)
  return (
    <StatusBar
      className="mb-2"
      left={<NetworkStatus />}
      center={
        <a
          href="https://runmaestro.ai"
          target="_blank"
          rel="noreferrer"
          className={cx(CHIP_FOCUS, 'max-md:hidden')}
        >
          <Chip className={CHIP_LINK}>made with maestro</Chip>
        </a>
      }
      right={
        <>
          <VersionChip />
          <Chip>{ISA}</Chip>
          {fps !== null && <FpsChip fps={fps} />}
        </>
      }
    />
  )
}

/** The version stamp: its release's name in the tooltip, and a link to the changelog. */
function VersionChip() {
  return (
    <Tooltip content={versionTitle(VERSION, RELEASE)} placement="top-end">
      <Link
        to="/docs/$"
        params={{ _splat: 'changelog' }}
        aria-label={`${VERSION}: the changelog`}
        className={CHIP_FOCUS}
      >
        <Chip className={CHIP_LINK}>{VERSION}</Chip>
      </Link>
    </Tooltip>
  )
}

/**
 * The arena's frame rate: `--warn` under `FPS_WARN`, where its tooltip says the speed slider is the
 * fix. A Tab stop while it shows, so the keyboard reads the tooltip too.
 */
function FpsChip({ fps }: { fps: number }) {
  const slow = fps < FPS_WARN
  return (
    <Tooltip
      placement="top-end"
      content={
        slow ? (
          <span>
            under {FPS_WARN} fps: each frame runs more cycles than this machine can draw. slow the
            speed slider under the arena, or{' '}
            <span className="whitespace-nowrap">
              press <Kbd>[</Kbd>.
            </span>
          </span>
        ) : (
          'frames a second the arena draws.'
        )
      }
    >
      <Chip tabIndex={0} variant={slow ? 'warn' : 'accent'} className={CHIP_FOCUS}>
        {Math.round(fps)} fps
      </Chip>
    </Tooltip>
  )
}
