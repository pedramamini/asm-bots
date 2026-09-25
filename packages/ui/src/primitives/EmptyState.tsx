import type { ComponentProps, MouseEvent, ReactNode } from 'react'
import { FOCUS_RING } from '../control'
import { cx } from '../style'

export interface EmptyStateAction {
  /** Lowercase, what the user can do about it: `submit a bot`. */
  label: string
  /** A link when set; a button when not. */
  href?: string | undefined
  /** A router takes the link over here, or the button does its work. */
  onClick?: ((event: MouseEvent<HTMLElement>) => void) | undefined
  /** The button cannot act now (a retry already on its way): dim, and no click. Not a link's. */
  disabled?: boolean | undefined
}

export interface EmptyStateProps extends ComponentProps<'div'> {
  /** One sentence, lowercase, that says what is missing: `no entrants yet.` */
  children: ReactNode
  /**
   * The one way on, in accent and underlined (a link in a sentence needs more than its color),
   * after the sentence: `submit a bot →`.
   */
  action: EmptyStateAction
  /** 12 px data type and 8 px of room, for a dense panel's list (the debugger's watches). */
  dense?: boolean | undefined
}

const ACTION = cx(
  'inline cursor-pointer text-accent-fg underline decoration-accent-45 underline-offset-2 transition-colors duration-120 ease-out not-disabled:hover:decoration-current disabled:cursor-not-allowed disabled:text-dim disabled:no-underline',
  FOCUS_RING,
)

/**
 * What an empty list says (DESIGN_SYSTEM §4, §9): one muted sentence and one accent action,
 * centered in the space the list would fill. Never an illustration.
 */
export function EmptyState({
  action,
  dense = false,
  className,
  children,
  ...rest
}: EmptyStateProps) {
  const { label, href, onClick, disabled } = action
  const arrow = <span aria-hidden="true"> →</span>
  return (
    <div
      {...rest}
      className={cx(
        'flex items-center justify-center',
        dense ? 'px-1 py-2' : 'px-3 py-6',
        'text-center',
        dense ? 'text-data' : 'text-body',
        'text-muted',
        className,
      )}
    >
      <p>
        {children}{' '}
        {href === undefined ? (
          <button type="button" onClick={onClick} disabled={disabled} className={ACTION}>
            {label}
            {arrow}
          </button>
        ) : (
          <a href={href} onClick={onClick} className={ACTION}>
            {label}
            {arrow}
          </a>
        )}
      </p>
    </div>
  )
}
