import type { ComponentProps } from 'react'
import { graphicRole } from '../graphic'
import { type Hue, hueColor } from '../hue'
import { cx, vars } from '../style'

/** Space kept above and below the line, px, so a 1 px stroke at the min or max is not cut. */
const INSET = 1

export interface SparklineProps
  extends Omit<ComponentProps<'svg'>, 'values' | 'min' | 'max' | 'width' | 'height'> {
  /** The series, oldest first. */
  values: readonly number[]
  /** The value at the bottom edge; the smallest value when absent. */
  min?: number | undefined
  /** The value at the top edge; the largest value when absent. */
  max?: number | undefined
  /** px. The line stays 1 px thick if a class stretches the SVG (`w-full`). */
  width?: number | undefined
  /** px. */
  height?: number | undefined
  /** A bot index (the engine's owner - 1) or any CSS color; the accent when absent. */
  hue?: Hue | undefined
  /** One bar per value, up from the bottom, in place of the line: a histogram. `min` is then 0. */
  bars?: boolean | undefined
}

/**
 * A series as a 1 px line (DESIGN_SYSTEM §4): a bot's process count over the last frames, a
 * rating over time. The values fill the height between `min` and `max`; a flat series is a line
 * through the middle. With `bars`, a histogram: a bar per value, 1 px apart, filled in the hue
 * (a melee's rounds by the cycles a bot lived). Hidden from assistive tech unless `aria-label`
 * says what it shows.
 */
export function Sparkline({
  values,
  min,
  max,
  width = 64,
  height = 16,
  hue = 'var(--accent)',
  bars = false,
  className,
  style,
  ...rest
}: SparklineProps) {
  const points = bars ? '' : sparkPoints(values, width, height, min, max)
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: graphicRole hides it, or names it by aria-label.
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      {...graphicRole(rest)}
      {...rest}
      className={cx('shrink-0 text-(--hue)', className)}
      style={{ ...style, ...vars({ '--hue': hueColor(hue) }) }}
    >
      {bars &&
        sparkBars(values, width, height, max).map((bar) => (
          <rect key={bar.x} {...bar} fill="currentColor" />
        ))}
      {points !== '' && (
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth={1}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  )
}

/**
 * The polyline of `values` in a `width` × `height` box: evenly spaced left to right, `min` at the
 * bottom and `max` at the top, a value outside them held to the edge, a value that is not a number
 * at the bottom. One value is a flat line across; none is ''.
 */
export function sparkPoints(
  values: readonly number[],
  width: number,
  height: number,
  min?: number,
  max?: number,
): string {
  let lo = min ?? Number.POSITIVE_INFINITY
  let hi = max ?? Number.NEGATIVE_INFINITY
  for (const v of values) {
    if (!Number.isFinite(v)) continue
    if (min === undefined) lo = Math.min(lo, v)
    if (max === undefined) hi = Math.max(hi, v)
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return ''
  const span = hi - lo
  const ys = values.map((v) => {
    if (span <= 0) return height / 2
    const held = Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo
    return round(height - INSET - ((held - lo) / span) * (height - 2 * INSET))
  })
  if (ys.length === 1) return `0,${ys[0]} ${width},${ys[0]}`
  const step = width / (ys.length - 1)
  return ys.map((y, i) => `${round(i * step)},${y}`).join(' ')
}

/** A bar of `sparkBars`: its box in the view box. */
export interface SparkBar {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * The bars of `values` in a `width` × `height` box: equal slots left to right, a 1 px gap between
 * them when each slot is wider than 2 px, each bar up from the bottom to its value over 0..`max`
 * (the largest value when absent). A value of 0, or one that is not a number, draws no bar; a
 * value above `max` stops at the top.
 */
export function sparkBars(
  values: readonly number[],
  width: number,
  height: number,
  max?: number,
): SparkBar[] {
  const top = max ?? Math.max(0, ...values.filter(Number.isFinite))
  if (values.length === 0 || top <= 0) return []
  const slot = width / values.length
  const gap = slot > 2 ? 1 : 0
  return values.flatMap((v, i) => {
    if (!Number.isFinite(v) || v <= 0) return []
    const h = round((Math.min(v, top) / top) * height)
    return [{ x: round(i * slot), y: round(height - h), width: round(slot - gap), height: h }]
  })
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}
