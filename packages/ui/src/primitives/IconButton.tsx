import type { Placement } from '@floating-ui/react-dom'
import type { LucideIcon } from 'lucide-react'
import type { ComponentProps } from 'react'
import { CONTROL_BOX, DISABLED, drawIcon, FOCUS_RING, ON } from '../control'
import { cx } from '../style'
import { Kbd } from './Kbd'
import { Tooltip } from './Tooltip'

export interface IconButtonProps extends Omit<ComponentProps<'button'>, 'children'> {
  /** The lucide icon: 16 px at md (a toolbar's), 12 px at sm. */
  icon: LucideIcon
  /** The button's name, lowercase, and its tooltip: "step back". */
  label: string
  /** The key that does the same, shown in the tooltip: `,`. */
  shortcut?: string | undefined
  /** `md` is 24 px square, `sm` 20 px. */
  size?: 'sm' | 'md' | undefined
  /** A button that toggles (sound, minimap): on is accent, and `aria-pressed`. */
  pressed?: boolean | undefined
  /** The tooltip's side. */
  tooltip?: Placement | undefined
}

/**
 * A square button that shows only an icon: the transport's play, step, and step back, the header's
 * theme and sound. Its label is its accessible name and its tooltip, with the shortcut beside it.
 * Idle: a hairline, the icon in `--text`; the pointer brightens both.
 */
export function IconButton({
  icon,
  label,
  shortcut,
  size = 'md',
  pressed,
  tooltip = 'bottom',
  className,
  ...rest
}: IconButtonProps) {
  return (
    <Tooltip
      content={
        <>
          {label}
          {shortcut !== undefined && <Kbd>{shortcut}</Kbd>}
        </>
      }
      placement={tooltip}
      describe={false}
    >
      <button
        type="button"
        aria-label={label}
        aria-pressed={pressed}
        {...rest}
        className={cx(
          CONTROL_BOX,
          size === 'sm' ? 'size-5' : 'size-6',
          FOCUS_RING,
          DISABLED,
          pressed
            ? ON
            : 'border-border text-text not-disabled:hover:border-border-strong not-disabled:hover:text-bright',
          className,
        )}
      >
        {drawIcon(icon, size === 'sm' ? 12 : 16)}
      </button>
    </Tooltip>
  )
}
