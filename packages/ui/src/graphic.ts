import type { AriaAttributes } from 'react'

/**
 * The role of a small SVG (a swatch, an identicon, a sparkline): an image when `aria-label` or
 * `aria-labelledby` names it, else hidden from assistive tech, as the text beside it says the same.
 */
export function graphicRole(
  props: Pick<AriaAttributes, 'aria-label' | 'aria-labelledby'>,
): { role: 'img' } | { 'aria-hidden': true } {
  const named = props['aria-label'] !== undefined || props['aria-labelledby'] !== undefined
  return named ? { role: 'img' } : { 'aria-hidden': true }
}
