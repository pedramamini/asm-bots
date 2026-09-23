import type { ComponentProps } from 'react'
import { cx } from '../style'

export type PanelGridProps = ComponentProps<'div'>

/**
 * The grid panels sit on (DESIGN_SYSTEM §4): 12 columns, 12 px gutters. A child spans columns with
 * `col-span-*`: `<Panel className="col-span-8">` beside `<Panel className="col-span-4">`.
 */
export function PanelGrid({ className, ...rest }: PanelGridProps) {
  return <div {...rest} className={cx('grid grid-cols-12 gap-3', className)} />
}
