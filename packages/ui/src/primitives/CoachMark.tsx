import type { ComponentProps, KeyboardEvent, ReactNode } from 'react'
import { cx } from '../style'
import { Button } from './Button'

/**
 * Where a coach mark sits against its control: under or over it, from its start or end edge; or
 * `inline`, in the flow under it (a panel's title), as wide as its box, so it covers nothing.
 */
export type CoachMarkPlacement = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end' | 'inline'

export interface CoachMarkProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** What it teaches, lowercase, a line or two: `press <Kbd>F5</Kbd> to debug.` */
  children: ReactNode
  /** `got it`, or Escape on a button. The page stores that, so the mark never shows again. */
  onDismiss: () => void
  /** The dismiss button's words: `got it` unless given (`skip the tour`, `done`). */
  dismissLabel?: string | undefined
  /** A step of a tour: `1/3`, muted, at the start of the button row. */
  step?: ReactNode
  /**
   * A way on besides dismissing (`next`, `play`): the accent button, at the end of the row. With
   * it, dismiss is the quiet button beside it.
   */
  action?: CoachMarkAction | undefined
  /**
   * Its place against the control, which is its positioned parent (a `relative` box around the
   * control): under it from its start edge by default. The caret points at the control's first or
   * last 24 px, an icon button's width. `inline` needs no such box: it takes its room in the flow.
   */
  placement?: CoachMarkPlacement | undefined
}

export interface CoachMarkAction {
  /** Lowercase: `next`. */
  label: string
  onClick: () => void
}

const PLACEMENTS: Readonly<Record<CoachMarkPlacement, { box: string; caret: string }>> = {
  'bottom-start': {
    box: 'top-full left-0 mt-2 starting:-translate-y-1',
    caret: '-top-1 left-2 border-t border-l',
  },
  'bottom-end': {
    box: 'top-full right-0 mt-2 starting:-translate-y-1',
    caret: '-top-1 right-2 border-t border-l',
  },
  'top-start': {
    box: 'bottom-full left-0 mb-2 starting:translate-y-1',
    caret: '-bottom-1 left-2 border-r border-b',
  },
  'top-end': {
    box: 'bottom-full right-0 mb-2 starting:translate-y-1',
    caret: '-bottom-1 right-2 border-r border-b',
  },
  inline: {
    box: 'mb-2 starting:-translate-y-1',
    caret: '-top-1 left-2 border-t border-l',
  },
}

/**
 * A first-visit hint pinned to one control (PRODUCT_SPEC §9): `--panel` fill, a 1 px accent border
 * with a caret toward the control, 12 px data type, and `got it`. It sits in the control's
 * `relative` box, over what follows, and slides in over 120 ms (not under reduced motion). The
 * page decides when it shows, and stores the dismissal. A tour's mark shows its `step` and may
 * offer an `action` beside the dismiss button.
 */
export function CoachMark({
  children,
  onDismiss,
  dismissLabel = 'got it',
  step,
  action,
  placement = 'bottom-start',
  className,
  ...rest
}: CoachMarkProps) {
  const place = PLACEMENTS[placement]
  const onEscape = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    onDismiss()
  }
  const dismiss = (
    <Button
      variant={action === undefined ? 'primary' : 'ghost'}
      size="sm"
      onClick={onDismiss}
      onKeyDown={onEscape}
    >
      {dismissLabel}
    </Button>
  )
  return (
    <div
      role="note"
      aria-label="tip"
      {...rest}
      className={cx(
        placement === 'inline' ? 'relative flex w-full' : 'absolute z-10 flex w-64',
        'flex-col items-end gap-2 rounded-md border border-accent bg-panel p-3 text-data text-text transition-[opacity,translate] duration-120 ease-out starting:opacity-0 motion-reduce:transition-none',
        place.box,
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cx('absolute size-2 rotate-45 border-accent bg-panel', place.caret)}
      />
      <p className="self-stretch">{children}</p>
      {step === undefined && action === undefined ? (
        dismiss
      ) : (
        <div className="flex items-center justify-end gap-2 self-stretch">
          {step !== undefined && <span className="mr-auto text-muted">{step}</span>}
          {dismiss}
          {action !== undefined && (
            <Button variant="primary" size="sm" onClick={action.onClick} onKeyDown={onEscape}>
              {action.label}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
