/**
 * An address, or a word, as the kit shows it (DESIGN_SYSTEM §1.2): `0x` and 4 uppercase digits,
 * `0x1A2F`. Held to 16 bits, as the core wraps.
 */
export function hexAddress(value: number): string {
  return `0x${digitsOf(value & 0xffff, 4)}`
}

/** A byte as 2 uppercase digits and no prefix: `FF`. Held to 8 bits. */
export function hexByte(value: number): string {
  return digitsOf(value & 0xff, 2)
}

function digitsOf(value: number, digits: number): string {
  return value.toString(16).toUpperCase().padStart(digits, '0')
}

/** Hex as typed: an optional `0x`, then hex digits in either case. */
const HEX = /^(0[xX])?([0-9A-Fa-f]*)$/

/**
 * The hex field's mask (DESIGN_SYSTEM §1.2: hex is the native unit). Returns `raw` with a lowercase
 * `0x` and uppercase digits, or null when `raw` cannot be the start of a hex number of at most
 * `digits` digits. Partial entries pass: '', '0', and '0x'.
 *
 *     maskHex('0x1a2f') // '0x1A2F'
 *     maskHex('xyz')    // null
 */
export function maskHex(raw: string, digits: number): string | null {
  const match = HEX.exec(raw)
  if (match === null) return null
  const [, prefix, body = ''] = match
  if (body.length > digits) return null
  return (prefix === undefined ? '' : '0x') + body.toUpperCase()
}
