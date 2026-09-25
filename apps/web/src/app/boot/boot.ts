/**
 * The boot screen and the welcome tour (PRODUCT_SPEC §9). Opening the site at `/` boots the core
 * first: the logo over a core dump that zeroes, loads bots, and runs. `take tour` opens the welcome
 * tour, which ends on the arena's guided first battle; `enter site` goes straight in. The boot shows
 * on every load of `/`, and never on a deep link: a shared replay or bot opens at once.
 */
import { create } from 'zustand'
import { useSettings } from '../../store/settings'

/** The welcome tour's id in the settings' `coachMarksSeen`. */
export const WELCOME_TOUR = 'welcome'

/** `?boot=1` boots whatever else holds: the e2e specs' way in, and a way to see it again. */
export const BOOT_PARAM = 'boot'

/** What the layer over the frame shows: the boot screen, the welcome tour, or nothing. */
export type BootPhase = 'boot' | 'tour' | 'off'

interface BootState {
  phase: BootPhase
  /** `enter site` on the boot screen: the page, and the tour is marked seen. */
  skip: () => void
  /** Opens the tour: the boot screen's `take tour`, and the home page's `take the tour`. */
  openTour: () => void
  /** The tour is over, done or skipped: it never shows by itself again. */
  closeTour: () => void
}

function tourSeen(): void {
  useSettings.getState().markCoachSeen(WELCOME_TOUR)
}

export const useBoot = create<BootState>()((set) => ({
  phase: 'off',
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
}

/**
 * Whether a page that loads in `context` boots: at `/` only, on every load, and not for a browser
 * a script drives, unless `?boot=1` asks.
 */
export function shouldBoot({ path, search, automated }: BootContext): boolean {
  if (path !== '/') return false
  if (new URLSearchParams(search).get(BOOT_PARAM) === '1') return true
  return !automated
}

/**
 * Called once, as the app starts (`main.tsx`): boots when `shouldBoot` says so, and takes
 * `?boot=1` off the URL. Tests that render a page never call it, so nothing boots there.
 */
export function armBoot(): void {
  const { pathname, search, hash } = window.location
  if (!shouldBoot({ path: pathname, search, automated: navigator.webdriver === true })) return
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
