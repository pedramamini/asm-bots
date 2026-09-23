import { ChevronDown } from 'lucide-react'
import type { ComponentProps } from 'react'
import { drawIcon } from '../control'
import { cx } from '../style'

export type SelectProps = ComponentProps<'select'>

/**
 * A native `<select>`, styled as the filter row's (DESIGN_SYSTEM §4): `--panel-2` fill, a hairline,
 * lowercase 12 px data type, a 12 px chevron. Focus turns the border accent. The browser draws the
 * option list (in the theme's color scheme). `className` sizes it; every other prop, the ref and
 * the `<option>` children included, goes to the `<select>`.
 */
export function Select({ className, ...rest }: SelectProps) {
  return (
    <span
      className={cx(
        'relative inline-flex h-6 min-w-0 text-text has-disabled:opacity-40',
        className,
      )}
    >
      <select
        {...rest}
        className="h-full w-full min-w-0 cursor-pointer appearance-none truncate rounded-sm border border-border bg-panel-2 pr-6 pl-2 text-data lowercase outline-hidden transition-colors duration-120 ease-out not-disabled:hover:border-border-strong focus:border-accent disabled:cursor-not-allowed"
      />
      {drawIcon(ChevronDown, 12, 'pointer-events-none absolute top-1/2 right-2 -translate-y-1/2')}
    </span>
  )
}
