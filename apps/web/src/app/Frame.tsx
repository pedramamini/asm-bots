import {
  Chip,
  Header,
  IconButton,
  KeyHelp,
  Menu,
  Modal,
  NavButton,
  StatusBar,
  Ticker,
  Toolbar,
  type ToolbarProps,
} from '@asmbots/ui'
import { THEMES } from '@asmbots/ui/themes'
import { useQueryClient } from '@tanstack/react-query'
import { createLink, useLocation, useRouter } from '@tanstack/react-router'
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

/** The build's version stamp; `dev` where Vite did not define it (the unit tests). */
const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'

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
      <FrameTicker />
      <Header
        brand={<Brand />}
        stat={<HeaderStat />}
        nav={<Nav />}
        right={<HeaderActions onKeys={() => setKeysOpen(true)} />}
      />
      <div ref={setToolbar} className="contents" />
      <ToolbarSlot value={toolbar}>
        <main className="relative min-h-0 flex-1 overflow-auto">{children}</main>
      </ToolbarSlot>
      <FrameStatus />
      <Modal open={keysOpen} onClose={() => setKeysOpen(false)} title="keys" size="lg">
        <KeyHelp bindings={bindings} />
      </Modal>
      <Onboarding />
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

/** A route's filter row, drawn by the frame under the header while the route is mounted. */
export function FrameToolbar(props: ToolbarProps) {
  const slot = useContext(ToolbarSlot)
  return slot === null ? null : createPortal(<Toolbar {...props} />, slot)
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

function FrameStatus() {
  const fps = useFps((state) => state.fps)
  return (
    <StatusBar
      className="mb-2"
      left={<NetworkStatus />}
      center={
        <a
          href="https://maestro.sh"
          target="_blank"
          rel="noreferrer"
          className="rounded-sm focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <Chip className="transition-colors duration-120 ease-out hover:text-accent">
            made with maestro
          </Chip>
        </a>
      }
      right={
        <>
          <Chip>{VERSION}</Chip>
          <Chip>{ISA}</Chip>
          {fps !== null && (
            <Chip variant={fps < 50 ? 'warn' : 'accent'}>{Math.round(fps)} fps</Chip>
          )}
        </>
      }
    />
  )
}
