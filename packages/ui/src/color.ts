/** An sRGB color, 0..255 per channel. */
export type Rgb = readonly [r: number, g: number, b: number]

/** Parses `#RRGGBB` or `#RGB`, either case. Throws on anything else. */
export function parseHex(hex: string): Rgb {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (m === null) throw new Error(`not a hex color: ${JSON.stringify(hex)}`)
  let digits = m[1] as string
  if (digits.length === 3) digits = [...digits].map((d) => d + d).join('')
  const n = Number.parseInt(digits, 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

/** WCAG 2 relative luminance: 0 for black, 1 for white. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex)
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

/** WCAG 2 contrast ratio of two colors, 1 to 21. The order of the two does not matter. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** An sRGB channel, 0..255, as linear light, 0..1. */
function linear(channel: number): number {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
