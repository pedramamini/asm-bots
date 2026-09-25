/**
 * The art's stand-ins: each renders nothing until the page has painted and gone idle, then loads
 * the art chunk (`./index`) and draws. The caller's box holds the space, so nothing shifts.
 */
import { lazy, type ReactNode, Suspense } from 'react'
import { usePaintedAndIdle } from '../app/paint'
import type { HexBandProps } from './HexBand'
import type { PlateName } from './index'

const art = () => import('./index')
const LazyPlate = lazy(() => art().then((m) => ({ default: m.NamedPlate })))
const LazySchematic = lazy(() => art().then((m) => ({ default: m.Schematic })))
const LazyScope = lazy(() => art().then((m) => ({ default: m.ScopeTrace })))
const LazyHexBand = lazy(() => art().then((m) => ({ default: m.HexBand })))

function AfterPaint({ children }: { children: ReactNode }) {
  const idle = usePaintedAndIdle()
  return idle ? <Suspense fallback={null}>{children}</Suspense> : null
}

/** A dither plate by name (`./index` lists them). It fills its box. */
export function Plate(props: { name: PlateName; cell?: number; className?: string }) {
  return (
    <AfterPaint>
      <LazyPlate {...props} />
    </AfterPaint>
  )
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
