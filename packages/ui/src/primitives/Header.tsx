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
 * Under `md` the stat goes (a narrow screen has no room for it beside the nav), the gaps close
 * up, and the brand's letters too; the nav and the right slot decide for themselves what to shed
 * there.
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
        'relative z-header flex h-10 items-center gap-1.5 border-b border-border bg-bg px-2 md:gap-3 md:px-3',
        className,
      )}
    >
      {/* It clips 2 px out, so a brand that is a link keeps its focus ring. Under `md` its letters
          close up, so the name fits beside a full nav. */}
      {hasContent(brand) && (
        <div className="min-w-0 shrink truncate-ring text-brand text-accent-fg max-md:tracking-normal">
          {brand}
        </div>
      )}
      <div className="flex min-w-0 flex-1 justify-center">
        {hasContent(stat) && (
          <div className="min-w-0 truncate text-data text-muted max-md:hidden">{stat}</div>
        )}
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
