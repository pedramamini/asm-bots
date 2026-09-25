import { useSyncExternalStore } from 'react'
import { reducedMotion, subscribeMotion } from '../motion'

/**
 * True while motion should be reduced (DESIGN_SYSTEM §8): the app's override on
 * `<html data-motion>` (`applyMotion`), else the system's `prefers-reduced-motion`. It follows a
 * change of either without a reload. False where there is no DOM and no `matchMedia`.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeMotion, reducedMotion, () => false)
}
