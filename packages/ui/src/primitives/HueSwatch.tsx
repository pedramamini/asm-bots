import type { ComponentProps } from 'react'
import { graphicRole } from '../graphic'
import { type Hue, hueColor, wrapsHue } from '../hue'
import { cx, vars } from '../style'

export interface HueSwatchProps extends Omit<ComponentProps<'svg'>, 'width' | 'height'> {
  /** A bot index (the engine's owner - 1) or any CSS color. */
  hue: Hue
  /** The side, px. */
  size?: number | undefined
}

/**
 * A bot's color, as a square cut from the arena: the hue inside a 1 px black bezel (the arena is
 * black in every theme, so a light hue still shows on paper). Bot 12 and up shares its hue with
 * the bot 12 below it, so its swatch is hatched (DESIGN_SYSTEM §2). Hidden from assistive tech
 * unless `aria-label` names it; the bot's name beside it usually does.
 */
export function HueSwatch({ hue, size = 10, className, style, ...rest }: HueSwatchProps) {
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: graphicRole hides it, or names it by aria-label.
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      {...graphicRole(rest)}
      data-hatched={wrapsHue(hue) || undefined}
      {...rest}
      className={cx('shrink-0 text-(--hue)', className)}
      style={{ ...style, ...vars({ '--hue': hueColor(hue) }) }}
    >
      <rect width={size} height={size} className="fill-arena-bg" />
      <rect x={1} y={1} width={size - 2} height={size - 2} fill="currentColor" />
      {wrapsHue(hue) && (
        <path
          d={hatch(size)}
          className="stroke-arena-bg"
          strokeWidth={1}
          strokeOpacity={0.7}
          fill="none"
        />
      )}
    </svg>
  )
}

/** Diagonal lines 3 px apart over a square of `size` px, rising to the right. */
function hatch(size: number): string {
  const lines: string[] = []
  for (let x = -size; x < size; x += 3) lines.push(`M${x} ${size}L${x + size} 0`)
  return lines.join('')
}
