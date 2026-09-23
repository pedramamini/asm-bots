import type { LucideIcon } from 'lucide-react'
import type { ComponentProps } from 'react'
import { drawIcon } from '../control'
import { cx } from '../style'

/** A chip's meaning. Only the text takes the color. */
export type ChipVariant = 'neutral' | 'accent' | 'warn' | 'danger' | 'info'

const TEXT: Readonly<Record<ChipVariant, string>> = {
  neutral: 'text-muted',
  accent: 'text-accent',
  warn: 'text-warn',
  danger: 'text-danger',
  info: 'text-info',
}

export interface ChipProps extends ComponentProps<'span'> {
  /** The chip's meaning, as the color of its text; the fill and the hairline stay. */
  variant?: ChipVariant | undefined
  /** A 12 px lucide icon before the text. */
  icon?: LucideIcon | undefined
}

/**
 * A small status label: `3 ACTIVE · 2 MAJOR`, `VERIFIED`, `60 FPS` (DESIGN_SYSTEM §4). 10 px UPPER
 * type on `--panel`, a hairline, radius 3, padding 2 8. A semantic variant tints the text only.
 */
export function Chip({ variant = 'neutral', icon, className, children, ...rest }: ChipProps) {
  return (
    <span
      {...rest}
      className={cx(
        'inline-flex shrink-0 items-center gap-1 rounded-sm border border-border bg-panel px-2 py-0.5 whitespace-nowrap text-panel-status',
        TEXT[variant],
        className,
      )}
    >
      {drawIcon(icon, 12)}
      {children}
    </span>
  )
}
