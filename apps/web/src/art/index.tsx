/**
 * The site's art (DESIGN_SYSTEM §10), one chunk that loads after the page paints: `./lazy`
 * holds the stand-ins a page renders.
 */
import { DitherPlate } from './DitherPlate'
import { chip, climbRange, footerRange, trophy } from './scenes'

export { HexBand } from './HexBand'
export { Schematic } from './Schematic'
export { ScopeTrace } from './ScopeTrace'

/** The dither plates, by name, so a page names one without loading its scene. */
const SCENES = { chip, climb: climbRange, footer: footerRange, trophy } as const

export type PlateName = keyof typeof SCENES

export function NamedPlate({
  name,
  cell,
  className,
}: {
  name: PlateName
  cell?: number | undefined
  className?: string | undefined
}) {
  return <DitherPlate scene={SCENES[name]} cell={cell} className={className} />
}
