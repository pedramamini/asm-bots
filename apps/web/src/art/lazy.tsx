/**
 * The art's stand-ins: each renders nothing until the page has painted and gone idle, then loads
 * the art chunk (`./index`) and draws. The caller's box holds the space, so nothing shifts.
 */
import { lazy, type ReactNode, Suspense } from 'react'
import { usePaintedAndIdle } from '../app/paint'
import type { HexBandProps } from './HexBand'

export { Plate } from './Plate'

const art = () => import('./index')
const LazySchematic = lazy(() => art().then((m) => ({ default: m.Schematic })))
const LazyScope = lazy(() => art().then((m) => ({ default: m.ScopeTrace })))
const LazyHexBand = lazy(() => art().then((m) => ({ default: m.HexBand })))

function AfterPaint({ children }: { children: ReactNode }) {
  const idle = usePaintedAndIdle()
  return idle ? <Suspense fallback={null}>{children}</Suspense> : null
}

export function Schematic(props: { className?: string }) {
  return (
    <AfterPaint>
      <LazySchematic {...props} />
    </AfterPaint>
  )
}

export function ScopeTrace(props: { className?: string }) {
  return (
    <AfterPaint>
      <LazyScope {...props} />
    </AfterPaint>
  )
}

export function HexBand(props: HexBandProps) {
  return (
    <AfterPaint>
      <LazyHexBand {...props} />
    </AfterPaint>
  )
}
