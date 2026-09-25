/**
 * The boot screen and the welcome tour (PRODUCT_SPEC §9). Opening the site at `/` boots the core
 * first: the logo over a core dump that zeroes, loads bots, and runs. `enter` puts it away. On a
 * first visit `enter` opens the welcome tour, which ends on the arena's guided first battle; its
 * `skip` (and the boot screen's `skip the tour`) put the tour away for good. The boot shows once a
 * browser session, and never on a deep link: a shared replay or bot opens at once.
 */
import { create } from 'zustand'
import { useSettings } from '../../store/settings'

/** The welcome tour's id in the settings' `coachMarksSeen`. */
export const WELCOME_TOUR = 'welcome'

/** sessionStorage's mark that this tab has booted: a reload or a return to `/` does not again. */
export const BOOTED_KEY = 'asmbots:booted'

/** `?boot=1` boots whatever else holds: the e2e specs' way in, and a way to see it again. */
export const BOOT_PARAM = 'boot'

/** What the layer over the frame shows: the boot screen, the welcome tour, or nothing. */
export type BootPhase = 'boot' | 'tour' | 'off'

interface BootState {
  phase: BootPhase
  /** `enter` on the boot screen: the tour on a first visit, else the page. */
  enter: () => void
  /** `skip the tour`: the page, and the tour never shows by itself again. */
  skip: () => void
  /** Opens the tour again (the home page's `take the tour`). */
  openTour: () => void
  /** The tour is over, done or skipped: it never shows by itself again. */
  closeTour: () => void
}

/** Whether the welcome tour is still to come: the user has not finished or skipped it. */
export function firstVisit(): boolean {
  return !useSettings.getState().coachMarksSeen.includes(WELCOME_TOUR)
}

function tourSeen(): void {
  useSettings.getState().markCoachSeen(WELCOME_TOUR)
}

export const useBoot = create<BootState>()((set) => ({
  phase: 'off',
  enter: () => set({ phase: firstVisit() ? 'tour' : 'off' }),
  skip: () => {
    tourSeen()
    set({ phase: 'off' })
  },
  openTour: () => set({ phase: 'tour' }),
  closeTour: () => {
    tourSeen()
    set({ phase: 'off' })
  },
}))

/** What `shouldBoot` reads of the page it loads on. */
export interface BootContext {
  /** The path the page loaded at. */
  path: string
  /** Its query string, `?` included or empty. */
  search: string
  /** `navigator.webdriver`: a browser a script drives (Playwright, Lighthouse) skips the boot. */
  automated: boolean
  /** This tab has booted already (`BOOTED_KEY`). */
  booted: boolean
}

/**
 * Whether a page that loads in `context` boots: at `/` only, once a session, and not for a
 * browser a script drives, unless `?boot=1` asks.
 */
export function shouldBoot({ path, search, automated, booted }: BootContext): boolean {
  if (path !== '/') return false
  if (new URLSearchParams(search).get(BOOT_PARAM) === '1') return true
  return !automated && !booted
}

/**
 * Called once, as the app starts (`main.tsx`): boots when `shouldBoot` says so, marks the tab
 * booted, and takes `?boot=1` off the URL, so a reload does not ask again. Tests that render a
 * page never call it, so nothing boots there.
 */
export function armBoot(): void {
  const { pathname, search, hash } = window.location
  const booted = attempt(() => sessionStorage.getItem(BOOTED_KEY) !== null, false)
  const boot = shouldBoot({
    path: pathname,
    search,
    automated: navigator.webdriver === true,
    booted,
  })
  if (!boot) return
  attempt(() => sessionStorage.setItem(BOOTED_KEY, '1'), undefined)
  const params = new URLSearchParams(search)
  if (params.has(BOOT_PARAM)) {
    params.delete(BOOT_PARAM)
    const query = params.toString()
    window.history.replaceState(
      window.history.state,
      '',
      `${pathname}${query ? `?${query}` : ''}${hash}`,
    )
  }
  useBoot.setState({ phase: 'boot' })
}

function attempt<T>(run: () => T, fallback: T): T {
  try {
    return run()
  } catch {
    return fallback
  }
}
