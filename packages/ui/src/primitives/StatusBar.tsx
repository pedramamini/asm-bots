import type { ComponentProps, ReactNode } from 'react'
import { cx } from '../style'

export interface StatusBarProps extends ComponentProps<'footer'> {
  /** Bottom left: the status chips, `3 ACTIVE · 2 MAJOR`. */
  left?: ReactNode
  /** Bottom center: the attribution chip. */
  center?: ReactNode
  /** Bottom right: the version and fps chips. */
  right?: ReactNode
}

/**
 * The status row at the foot of the page (DESIGN_SYSTEM §4): 22 px of chips, the center chip on the
 * page's center line whatever the sides hold. The row takes no pointer events, only its chips do,
 * so laid over the arena it blocks nothing else.
 */
export function StatusBar({ left, center, right, className, ...rest }: StatusBarProps) {
  return (
    <footer
      {...rest}
      className={cx(
        'pointer-events-none grid h-5.5 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 px-3 text-panel-status text-muted',
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2 *:pointer-events-auto">{left}</div>
      <div className="flex items-center gap-2 *:pointer-events-auto">{center}</div>
      <div className="flex min-w-0 items-center justify-end gap-2 *:pointer-events-auto">
        {right}
      </div>
    </footer>
  )
}
