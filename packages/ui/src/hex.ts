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
