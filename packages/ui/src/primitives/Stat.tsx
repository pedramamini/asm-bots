import type { ComponentProps, ReactNode } from 'react'
import { hasContent } from '../node'
import { cx } from '../style'
import { Skeleton } from './Skeleton'

export interface StatProps extends ComponentProps<'div'> {
  /** What the number counts, muted UPPER: `cycles`. */
  label: ReactNode
  /** The number, formatted: `12,480`. */
  value?: ReactNode
  /** The change since the last reading. A rise is accent and a fall is danger, unless `invert`. */
  delta?: number | undefined
  /** The delta's size as text, en-US grouping by default: `1,204`. */
  formatDelta?: ((magnitude: number) => string) | undefined
  /** A fall is the good news: a rank, a size in bytes, a death count. */
  invert?: boolean | undefined
  /** Muted, after the delta: `vs last week`. */
  note?: ReactNode
  /** Skeleton blocks at the number's and the delta's size, so the tile keeps its height. */
  loading?: boolean | undefined
}

const grouped = (magnitude: number) => magnitude.toLocaleString('en-US')

/**
 * One number and its change (the reference's summary tiles): the label in muted UPPER, the number
 * in the stat type in `--text-bright`, the delta under it. A `--panel` tile with a hairline and a
 * 4 px stripe down the left. `children` sit at the right, level with the delta: a Sparkline.
 */
export function Stat({
  label,
  value,
  delta,
  formatDelta = grouped,
  invert = false,
  note,
  loading = false,
  className,
  children,
  ...rest
}: StatProps) {
  const changed = delta !== undefined && Number.isFinite(delta)
  return (
    <div
      aria-busy={loading || undefined}
      {...rest}
      className={cx(
        'flex min-w-0 items-end gap-3 rounded-md border border-l-4 border-border bg-panel p-3',
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="truncate text-panel-status text-muted">{label}</div>
        {loading ? (
          <>
            <div className="flex h-7 items-center">
              <Skeleton className="h-6 w-16" />
            </div>
            <div className="flex h-4.5 items-center">
              <Skeleton className="h-2.5 w-24" />
            </div>
          </>
        ) : (
          <>
            {/* A value can be a link: `truncate-ring` leaves room for its focus ring. */}
            <div className="truncate-ring text-stat text-bright">{value}</div>
            {(changed || hasContent(note)) && (
              <div className="flex min-w-0 items-center gap-2 text-data">
                {changed && <Delta delta={delta} invert={invert} format={formatDelta} />}
                {hasContent(note) && <span className="truncate text-muted">{note}</span>}
              </div>
            )}
          </>
        )}
      </div>
      {hasContent(children) && <div className="flex shrink-0 items-end">{children}</div>}
    </div>
  )
}

interface DeltaProps {
  delta: number
  invert: boolean
  format: (magnitude: number) => string
}

/** `▲ 24` or `▼ 3`, colored by whether the change is good; the word for the arrow is read out. */
function Delta({ delta, invert, format }: DeltaProps) {
  if (delta === 0) return <span className="shrink-0 text-muted">{format(0)}</span>
  const rise = delta > 0
  return (
    <span
      className={cx(
        'shrink-0 whitespace-nowrap',
        rise !== invert ? 'text-accent-fg' : 'text-danger',
      )}
    >
      <span aria-hidden="true">{rise ? '▲' : '▼'}</span>
      <span className="sr-only">{rise ? 'up' : 'down'}</span> {format(Math.abs(delta))}
    </span>
  )
}
