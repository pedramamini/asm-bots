import type { ComponentProps } from 'react'
import { cx } from '../style'

/** One placeholder block: `--panel-2`, radius 3, a slow pulse that stops for reduced motion. */
export const SKELETON_BLOCK = 'rounded-sm bg-panel-2 animate-skeleton motion-reduce:animate-none'

export interface SkeletonProps extends ComponentProps<'div'> {
  /**
   * Draws this many table rows in place of one block: a short cell and a long one, 24 px apart,
   * a table row's height, so the rows that replace them do not move the page.
   */
  rows?: number | undefined
}

/**
 * Where content will be (DESIGN_SYSTEM §4): `--panel-2` blocks. One block takes its size from
 * `className` (`h-2.5 w-24`); `rows` draws the rows of a table. A long load shows the RadarLoader
 * instead. Hidden from assistive tech: say "loading" beside it, as a panel's status does.
 */
export function Skeleton({ rows, className, ...rest }: SkeletonProps) {
  if (rows === undefined) {
    return <div aria-hidden="true" {...rest} className={cx(SKELETON_BLOCK, className)} />
  }
  return (
    <div aria-hidden="true" {...rest} className={cx('flex flex-col', className)}>
      {Array.from({ length: rows }, (_, row) => (
        // A placeholder row has no identity but its place.
        <div key={row} className="flex h-6 items-center gap-3">
          <div className={cx(SKELETON_BLOCK, 'h-2.5 w-16')} />
          <div className={cx(SKELETON_BLOCK, 'h-2.5 flex-1')} />
        </div>
      ))}
    </div>
  )
}
