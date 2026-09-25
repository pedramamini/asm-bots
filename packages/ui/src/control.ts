import type { LucideIcon } from 'lucide-react'
import { createElement, type ReactNode } from 'react'
import { cx } from './style'

/*
 * The classes the controls share (DESIGN_SYSTEM §4, §8): one box, one idle look, one "on" look,
 * one focus ring. A control is 24 px (md) or 20 px (sm) tall, so any two sit level in a row.
 */

/** A bordered control: radius 3, the 120 ms color change, a hand cursor, no text selection. */
export const CONTROL_BOX =
  'inline-flex shrink-0 cursor-pointer items-center justify-center rounded-sm border whitespace-nowrap transition-colors duration-120 ease-out select-none'

/** Height and padding by size: md is the nav button's 24 px (padding 4 10), sm is 20 px. */
export const CONTROL_SIZE = { sm: 'h-5 gap-1 px-2', md: 'h-6 gap-1.5 px-2.5' } as const

/** Off: a hairline and muted text; the pointer strengthens the border. */
export const IDLE = 'border-border text-muted not-disabled:hover:border-border-strong'

/** On: accent border and text over the 10% accent fill (the active nav button). */
export const ON = 'border-accent bg-accent-10 text-accent-fg'

/** Keyboard focus on a button-like control: a 1 px accent outline, 1 px out (DESIGN_SYSTEM §8). */
export const FOCUS_RING =
  'focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-accent'

/** A disabled control fades to 40% and takes no hover (see `not-disabled:` above). */
export const DISABLED = 'disabled:cursor-not-allowed disabled:opacity-40'

/**
 * A lucide icon at `size` px with the kit's 1.75 stroke (DESIGN_SYSTEM §6: 12 px in nav and chips,
 * 16 px in toolbars). Hidden from assistive tech: the control's label names it.
 */
export function drawIcon(
  icon: LucideIcon | undefined,
  size: 12 | 16,
  className?: string,
): ReactNode {
  if (icon === undefined) return null
  return createElement(icon, {
    size,
    strokeWidth: 1.75,
    'aria-hidden': true,
    className: cx('shrink-0', className),
  })
}
