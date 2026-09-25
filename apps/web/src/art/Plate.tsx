/**
 * A dither plate's stand-in, alone in its module so a page that shows only plates (the arena's
 * setup, 2 KB under its budget) loads none of `./lazy`'s other stand-ins. It renders nothing
 * until the page has painted and gone idle, then loads the art chunk (`./index`) and draws.
 */
import { lazy, Suspense } from 'react'
import { usePaintedAndIdle } from '../app/paint'
import type { PlateName } from './index'

const LazyPlate = lazy(() => import('./index').then((m) => ({ default: m.NamedPlate })))

/** A dither plate by name (`./index` lists them). It fills its box. */
export function Plate(props: { name: PlateName; cell?: number; className?: string }) {
  return usePaintedAndIdle() ? (
    <Suspense fallback={null}>
      <LazyPlate {...props} />
    </Suspense>
  ) : null
}
