import { type ComponentProps, type ReactNode, useId } from 'react'
import { hasContent } from '../node'
import { cx, vars } from '../style'

/** The scope's radius in the 100-unit view box, centered at 50, 50. */
const R = 48
/** The afterglow behind the beam, degrees, and the stacked sectors that draw it. */
const TRAIL = 45
const SECTORS = 30
/** Each sector's opacity. Stacked, they reach about 0.71 at the beam: 1 - (1 - 0.04)^30. */
const SECTOR_OPACITY = 0.04
/** One turn of the beam, s (DESIGN_SYSTEM §4: a 2 s rotation). */
const TURN = 2

/** A point on a circle of radius `r`, `degrees` clockwise from 12 o'clock. */
function polar(degrees: number, r: number): readonly [x: number, y: number] {
  const a = (degrees * Math.PI) / 180
  return [round(50 + r * Math.sin(a)), round(50 - r * Math.cos(a))]
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * The afterglow: sectors that all end at the beam and start further and further behind it, so the
 * overlap is densest at the beam and fades to nothing, with no seam between two sectors.
 */
const GLOW = Array.from({ length: SECTORS }, (_, k) => {
  const [x0, y0] = polar(-TRAIL * ((k + 1) / SECTORS), R)
  const [x1, y1] = polar(0, R)
  return `M50 50L${x0} ${y0}A${R} ${R} 0 0 1 ${x1} ${y1}Z`
})

/**
 * Contacts on the scope: where they sit, and when the beam passes each (a negative delay into
 * the blip's own 2 s cycle), so a contact flares as the beam crosses it and fades after.
 */
const BLIPS = [
  { degrees: 36, r: 28.5 },
  { degrees: 133, r: 31 },
  { degrees: 247, r: 22 },
].map(({ degrees, r }) => {
  const [x, y] = polar(degrees, r)
  return { x, y, delay: `${round((degrees / 360) * TURN - TURN)}s` }
})

/** A contact's core: the accent run hot toward the theme's brightest text. */
const HOT = 'fill-[color-mix(in_srgb,var(--accent)_40%,var(--text-bright))]'

export interface RadarLoaderProps extends ComponentProps<'div'> {
  /** What is loading, UPPER accent under the scope: `loading dashboard`. */
  label?: ReactNode
  /** Muted, under the label: `6 sections remaining`. */
  detail?: ReactNode
  /** The scope's diameter, px. */
  size?: number | undefined
  /** Draws the reference's card around it: `--bg` fill, an accent hairline, radius 6. */
  framed?: boolean | undefined
}

/**
 * The long-load indicator (DESIGN_SYSTEM §4): a radar scope whose beam turns once every 2 s,
 * leaving an afterglow, with a few contacts that flare as it passes. With reduced motion the beam
 * stands still. A `status` region: assistive tech reads the label and the detail. `children` go
 * under the detail: a `cancel` button.
 */
export function RadarLoader({
  label,
  detail,
  size = 112,
  framed = false,
  className,
  children,
  ...rest
}: RadarLoaderProps) {
  const id = useId()
  const grid = `${id}grid`
  const core = `${id}core`
  return (
    <div
      role="status"
      {...rest}
      className={cx(
        'flex flex-col items-center text-center',
        framed && 'rounded-lg border border-accent-25 bg-bg px-4 pt-4 pb-3',
        className,
      )}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        aria-hidden="true"
        className="shrink-0 overflow-visible text-accent"
      >
        <defs>
          <pattern id={grid} width={4} height={4} patternUnits="userSpaceOnUse">
            <circle cx={2} cy={2} r={0.45} fill="currentColor" fillOpacity={0.3} />
          </pattern>
          <radialGradient id={core}>
            <stop offset={0} stopColor="currentColor" stopOpacity={0.45} />
            <stop offset={1} stopColor="currentColor" stopOpacity={0} />
          </radialGradient>
        </defs>
        <circle cx={50} cy={50} r={R} fill="currentColor" fillOpacity={0.05} />
        <circle cx={50} cy={50} r={R} fill={`url(#${grid})`} />
        <circle cx={50} cy={50} r={18} fill={`url(#${core})`} />
        <g fill="none" stroke="currentColor" strokeWidth={1}>
          <circle cx={50} cy={50} r={R} strokeOpacity={0.35} vectorEffect="non-scaling-stroke" />
          <circle cx={50} cy={50} r={32} strokeOpacity={0.22} vectorEffect="non-scaling-stroke" />
          <circle cx={50} cy={50} r={16} strokeOpacity={0.22} vectorEffect="non-scaling-stroke" />
          <path
            d={`M50 ${50 - R}V${50 + R}M${50 - R} 50H${50 + R}`}
            strokeOpacity={0.16}
            vectorEffect="non-scaling-stroke"
          />
        </g>
        <g className="animate-radar-sweep motion-reduce:animate-none">
          {GLOW.map((d) => (
            <path key={d} d={d} fill="currentColor" fillOpacity={SECTOR_OPACITY} />
          ))}
          <path
            d={`M50 50V${50 - R}`}
            stroke="currentColor"
            strokeWidth={1}
            strokeOpacity={0.9}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </g>
        {BLIPS.map(({ x, y, delay }) => (
          <g
            key={delay}
            className="animate-radar-blip opacity-60 motion-reduce:animate-none"
            style={vars({ '--blip-delay': delay })}
          >
            <circle cx={x} cy={y} r={4.8} fill="currentColor" fillOpacity={0.22} />
            <circle cx={x} cy={y} r={2.4} className={HOT} />
          </g>
        ))}
      </svg>
      {hasContent(label) ? (
        <div className="mt-3.5 text-panel-title text-accent-fg">{label}</div>
      ) : (
        <span className="sr-only">loading</span>
      )}
      {hasContent(detail) && (
        <div className="mt-1.5 text-panel-status text-muted normal-case">{detail}</div>
      )}
      {children}
    </div>
  )
}
