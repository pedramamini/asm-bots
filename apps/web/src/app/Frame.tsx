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
import { createLink, useLocation, useRouter } from '@tanstack/react-router'
import {
  BookOpen,
  Check,
  ChevronDown,
  CodeXml,
  Grid2x2,
  Keyboard,
  Mountain,
  Palette,
  Trophy,
  UserRound,
} from 'lucide-react'
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSettings } from '../store/settings'
import {
  focusRouteSearch,
  type KeyCommand,
  useKeyBindings,
  useKeymapListener,
  useKeys,
} from './keys'
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
const ISA = 'x16c v1'

/** The build's version stamp; `dev` where Vite did not define it (the unit tests). */
const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'

/** A nav button the router drives: it preloads on intent and navigates without a reload. */
export const NavLink = createLink(NavButton)

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
    </div>
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
      { keys: ['?'], description: 'show the keys', group: 'global', run: toggleKeys },
      { keys: ['t'], description: 'next theme', group: 'global', run: cycleTheme },
      { keys: ['/'], description: 'search this page', group: 'global', run: focusRouteSearch },
      ...NAV.map(({ to, label, key }) => ({
        keys: ['g', key],
        description: `go to ${label}`,
        group: 'go',
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
  const router = useRouter()
  const theme = useSettings((state) => state.theme)
  const cycleTheme = useSettings((state) => state.cycleTheme)
  const setTheme = useSettings((state) => state.setTheme)
  return (
    <>
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
      {/* The account slot: signed out until accounts land; settings holds the account section. */}
      <IconButton
        icon={UserRound}
        label="account"
        onClick={() => void router.navigate({ to: '/settings' })}
      />
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

function FrameStatus() {
  const fps = useFps((state) => state.fps)
  return (
    <StatusBar
      className="mb-2"
      left={<Chip variant="accent">● local</Chip>}
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
