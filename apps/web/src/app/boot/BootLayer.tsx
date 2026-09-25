import { lazy, Suspense } from 'react'
import { useBoot } from './boot'

/**
 * The boot screen and the tour, each its own chunk: the shell of every page carries only this
 * layer and the store (`boot.ts`), and a page that does not boot loads neither.
 */
const BootScreen = lazy(() =>
  import('./BootScreen').then((module) => ({ default: module.BootScreen })),
)
const WelcomeTour = lazy(() =>
  import('./WelcomeTour').then((module) => ({ default: module.WelcomeTour })),
)

/**
 * The layer over the frame: the boot screen, then the welcome tour, as `useBoot` says. While the
 * boot screen's chunk loads, the screen is already the arena's black, so the page never shows
 * under it first.
 */
export function BootLayer() {
  const phase = useBoot((state) => state.phase)
  if (phase === 'boot') {
    return (
      <Suspense fallback={<div className="fixed inset-0 z-modal bg-arena-bg" />}>
        <BootScreen />
      </Suspense>
    )
  }
  if (phase === 'tour') {
    return (
      <Suspense fallback={null}>
        <WelcomeTour />
      </Suspense>
    )
  }
  return null
}
