import type { ComponentProps, ReactNode } from 'react'
import { hasContent } from '../node'
import { cx } from '../style'

export interface HeaderProps extends ComponentProps<'header'> {
  /** Left: the mark in brand type and accent, `ASM BOTS` with a muted `// ARENA`. */
  brand?: ReactNode
  /** Centered between the brand and the nav, muted data type: `8 bots · 41 procs · cycle 12,480`. */
  stat?: ReactNode
  /** The nav buttons, in a `<nav>` named by `navLabel`. */
  nav?: ReactNode
  /** The nav's accessible name. */
  navLabel?: string | undefined
  /** Far right: the theme and sound toggles. */
  right?: ReactNode
}

/**
 * The top bar under the ticker (DESIGN_SYSTEM §4): 40 px, hairline bottom. Brand left, the live
 * stat centered in the space between the brand and the nav, then the nav and the right slot.
 */
export function Header({
  brand,
  stat,
  nav,
  navLabel = 'primary',
  right,
  className,
  ...rest
}: HeaderProps) {
  return (
    <header
      {...rest}
      className={cx(
        'relative z-header flex h-10 items-center gap-3 border-b border-border bg-bg px-3',
        className,
      )}
    >
      {hasContent(brand) && <div className="shrink-0 text-brand text-accent">{brand}</div>}
      <div className="flex min-w-0 flex-1 justify-center">
        {hasContent(stat) && <div className="min-w-0 truncate text-data text-muted">{stat}</div>}
      </div>
      {hasContent(nav) && (
        <nav aria-label={navLabel} className="flex shrink-0 items-center gap-1">
          {nav}
        </nav>
      )}
      {hasContent(right) && <div className="flex shrink-0 items-center gap-1">{right}</div>}
    </header>
  )
}
