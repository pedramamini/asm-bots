import type { ComponentProps } from 'react'
import { graphicRole } from '../graphic'
import { type Hue, hueColor } from '../hue'
import {
  IDENTICON_CELLS as CELLS,
  identiconHue,
  identiconPath,
  identiconRows,
  IDENTICON_OFF_OPACITY as OFF_OPACITY,
} from '../identicon'
import { cx, vars } from '../style'

export interface IdenticonProps extends Omit<ComponentProps<'svg'>, 'width' | 'height'> {
  /** What the pattern comes from: a bot's bytes, or a string such as its hash. */
  value: Uint8Array | string
  /** The side, px. A multiple of 8 keeps each cell a whole number of pixels. */
  size?: number | undefined
  /** A bot index (the engine's owner - 1) or any CSS color; the hash picks a bot hue when absent. */
  hue?: Hue | undefined
}

/**
 * A bot's avatar (DESIGN_SYSTEM §6): 8 × 8 cells from a hash of its bytes, mirrored left to right,
 * drawn as a patch of the arena: black in every theme, on cells in the hue, off cells in the dim
 * wash of owned territory. Every bot hue shows on black, so a light hue holds up on paper. Equal
 * input always draws the same pattern in the same hue. Hidden from assistive tech unless
 * `aria-label` names it.
 */
export function Identicon({ value, size = 32, hue, className, style, ...rest }: IdenticonProps) {
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: graphicRole hides it, or names it by aria-label.
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${CELLS} ${CELLS}`}
      shapeRendering="crispEdges"
      {...graphicRole(rest)}
      {...rest}
      className={cx('shrink-0 text-(--hue)', className)}
      style={{ ...style, ...vars({ '--hue': hueColor(hue ?? identiconHue(value)) }) }}
    >
      <rect width={CELLS} height={CELLS} className="fill-arena-bg" />
      <rect width={CELLS} height={CELLS} fill="currentColor" fillOpacity={OFF_OPACITY} />
      <path d={identiconPath(identiconRows(value))} fill="currentColor" />
    </svg>
  )
}
