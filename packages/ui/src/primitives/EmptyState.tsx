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
}

export interface EmptyStateProps extends ComponentProps<'div'> {
  /** One sentence, lowercase, that says what is missing: `no entrants yet.` */
  children: ReactNode
  /** The one way on, in accent, after the sentence: `submit a bot →`. */
  action: EmptyStateAction
}

const ACTION = cx(
  'inline cursor-pointer text-accent underline-offset-2 transition-colors duration-120 ease-out hover:underline',
  FOCUS_RING,
)

/**
 * What an empty list says (DESIGN_SYSTEM §4, §9): one muted sentence and one accent action,
 * centered in the space the list would fill. Never an illustration.
 */
export function EmptyState({ action, className, children, ...rest }: EmptyStateProps) {
  const { label, href, onClick } = action
  const arrow = <span aria-hidden="true"> →</span>
  return (
    <div
      {...rest}
      className={cx(
        'flex items-center justify-center px-3 py-6 text-center text-body text-muted',
        className,
      )}
    >
      <p>
        {children}{' '}
        {href === undefined ? (
          <button type="button" onClick={onClick} className={ACTION}>
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
