import type { ComponentProps } from 'react'
import { cx } from '../style'

export type KbdProps = ComponentProps<'kbd'>

/**
 * A key, as the key help and the tooltips show it: `space`, `.`, `?`. A 16 px keycap: hairline in
 * the strong border, `--panel-2` fill, 10 px UPPER muted type.
 */
export function Kbd({ className, ...rest }: KbdProps) {
  return (
    <kbd
      {...rest}
      className={cx(
        'inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-sm border border-border-strong bg-panel-2 px-1 text-panel-status text-muted',
        className,
      )}
    />
  )
}
