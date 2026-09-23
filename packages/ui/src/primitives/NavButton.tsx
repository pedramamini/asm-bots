import type { LucideIcon } from 'lucide-react'
import type { ComponentProps } from 'react'
import { CONTROL_BOX, CONTROL_SIZE, drawIcon, FOCUS_RING, IDLE, ON } from '../control'
import { cx } from '../style'

export interface NavButtonProps extends ComponentProps<'a'> {
  href: string
  /** The route's 12 px lucide icon (DESIGN_SYSTEM §6: arena `Grid2x2`, editor `CodeXml`, …). */
  icon?: LucideIcon | undefined
  /** The current route: accent, and `aria-current="page"`. */
  active?: boolean | undefined
}

/**
 * A route link in the header's nav (DESIGN_SYSTEM §4): 1 px `--border`, radius 3, padding 4 10, a
 * 12 px icon and an UPPER label. The icon is accent, as in the reference; the label is muted.
 * Active: accent border and text over the 10% accent fill. Hover: `--border-strong`. It is a link,
 * so a router takes it over with `onClick`.
 */
export function NavButton({ icon, active = false, className, children, ...rest }: NavButtonProps) {
  return (
    <a
      aria-current={active ? 'page' : undefined}
      {...rest}
      className={cx(
        CONTROL_BOX,
        CONTROL_SIZE.md,
        'text-nav',
        FOCUS_RING,
        active ? ON : IDLE,
        className,
      )}
    >
      {drawIcon(icon, 12, active ? undefined : 'text-accent')}
      {children}
    </a>
  )
}
