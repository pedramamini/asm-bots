import {
  Chip,
  Header,
  IconButton,
  Kbd,
  KeyHelp,
  Menu,
  Modal,
  NavButton,
  StatusBar,
  Ticker,
  Toolbar,
  type ToolbarProps,
  Tooltip,
} from '@asmbots/ui'
import { THEMES } from '@asmbots/ui/themes'
import { useQueryClient } from '@tanstack/react-query'
import { createLink, Link, useLocation, useRouter } from '@tanstack/react-router'
import {
  BookOpen,
  Check,
  ChevronDown,
  CirclePlay,
  CodeXml,
  Grid2x2,
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
import { GLOBAL_KEYS, goKey } from './keymaps'
import {
  focusRouteSearch,
  type KeyCommand,
  useKeyBindings,
  useKeymapListener,
  useKeys,
} from './keys'
import { useOnline } from './online'
import { useFps, useHeaderStat } from './slots'
import { useTicker } from './ticker'
import { BRAND, useRouteHead } from './title'
import { RELEASE, VERSION, versionTitle } from './version'

/** The header's routes (DESIGN_SYSTEM §6 icons), and the second key of each `g` chord. */
export const NAV = [
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
  const bindings = useKeyBindings()
  useGlobalKeys(useCallback(() => setKeysOpen((open) => !open), []))
  useKeymapListener()

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
        right={<HeaderActions onKeys={() => setKeysOpen(true)} />}
      />
      <div ref={setToolbar} className="contents" />
      <ToolbarSlot value={toolbar}>
        {/* The scroll padding: a Tab stop scrolled into view keeps its focus ring clear of the edge. */}
        <main
          id={CONTENT_ID}
          tabIndex={-1}
          className="relative min-h-0 flex-1 scroll-py-2 overflow-auto outline-none"
        >
          {children}
        </main>
      </ToolbarSlot>
      <FrameStatus />
      <Modal open={keysOpen} onClose={() => setKeysOpen(false)} title="keys" size="lg">
        <KeyHelp bindings={bindings} />
      </Modal>
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

/** `?`, `t`, `/`, and the `g` chords. */
function useGlobalKeys(toggleKeys: () => void): void {
  const router = useRouter()
  const cycleTheme = useSettings((state) => state.cycleTheme)
  const commands = useMemo<KeyCommand[]>(
    () => [
      { ...GLOBAL_KEYS.help, run: toggleKeys },
      { ...GLOBAL_KEYS.theme, run: cycleTheme },
      { ...GLOBAL_KEYS.search, run: focusRouteSearch },
      ...NAV.map(({ to, label, key }) => ({
        ...goKey(key, label),
        run: () => void router.navigate({ to }),
      })),
    ],
    [router, cycleTheme, toggleKeys],
  )
  useKeys(commands)
}

function Brand() {
  const { label } = useRouteHead()
  return (
    <>
      {BRAND}
      {label !== null && <span className="text-muted">{` // ${label.toUpperCase()}`}</span>}
    </>
  )
}

/** Its own component: the stat may change every frame, and only this line need redraw. */
function HeaderStat() {
  return useHeaderStat((state) => state.stat)
}

function Nav() {
  const pathname = useLocation({ select: (location) => location.pathname })
  return NAV.map(({ to, label, icon }) => (
    <NavLink key={to} to={to} icon={icon} active={pathname === to || pathname.startsWith(`${to}/`)}>
      {label}
    </NavLink>
  ))
}

function HeaderActions({ onKeys }: { onKeys: () => void }) {
  const theme = useSettings((state) => state.theme)
  const cycleTheme = useSettings((state) => state.cycleTheme)
  const setTheme = useSettings((state) => state.setTheme)
  return (
    <>
      {/* The guided demo (PRODUCT_SPEC §9): the arena plays Dwarf vs Imp and says what happens. */}
      <NavLink to="/arena" search={{ intro: true }} icon={CirclePlay} className="mr-1">
        intro
      </NavLink>
      <IconButton icon={Palette} label={`theme: ${theme}`} shortcut="t" onClick={cycleTheme} />
      <Menu
        placement="bottom-end"
        trigger={<IconButton icon={ChevronDown} label="pick a theme" size="sm" />}
        items={THEMES.map((name) => ({
          label: name,
          icon: name === theme ? Check : undefined,
          onSelect: () => setTheme(name),
        }))}
      />
      <IconButton icon={Keyboard} label="keys" shortcut="?" onClick={onKeys} />
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
        <a href="https://runmaestro.ai" target="_blank" rel="noreferrer" className={CHIP_FOCUS}>
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
