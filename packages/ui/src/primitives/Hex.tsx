import type { ComponentProps } from 'react'
import { hexAddress, hexByte } from '../hex'
import { cx } from '../style'

export interface HexProps extends Omit<ComponentProps<'data'>, 'value' | 'children'> {
  /** The number: an address or a word, or a byte with `byte`. */
  value: number
  /** Shows a byte, `FF`, in place of an address, `0x00FF`. */
  byte?: boolean | undefined
}

/**
 * A number in the native unit (DESIGN_SYSTEM §1.2): an address or a word as `0x1A2F`, a byte as
 * `FF`. Never decimal for an address. The `0x` is faint, so a column of addresses reads by its
 * digits. A `<data>` element, its `value` the number in decimal for code that reads the page.
 */
export function Hex({ value, byte = false, className, ...rest }: HexProps) {
  const text = byte ? hexByte(value) : hexAddress(value)
  return (
    <data
      value={String(value & (byte ? 0xff : 0xffff))}
      {...rest}
      className={cx('whitespace-nowrap tabular-nums', className)}
    >
      {byte ? (
        text
      ) : (
        <>
          <span className="opacity-60">0x</span>
          {text.slice(2)}
        </>
      )}
    </data>
  )
}
