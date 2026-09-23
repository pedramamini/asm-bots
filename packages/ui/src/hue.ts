import { BOT_HUES, DEFAULT_THEME } from './themes'

/** The number of bot hues (DESIGN_SYSTEM §2). Bot 12 and up wraps to the hue of its index % 12. */
export const HUE_COUNT = BOT_HUES[DEFAULT_THEME].length

/**
 * What a `hue` prop takes (HueSwatch, Identicon, Sparkline): a bot index, which is the engine's
 * owner - 1, or any CSS color.
 */
export type Hue = number | string

/**
 * The CSS color of `hue`: bot index 3 is `var(--bot-3)`, and bot 14 wraps to `var(--bot-2)`. A
 * string is already a color.
 */
export function hueColor(hue: Hue): string {
  if (typeof hue === 'string') return hue
  const index = Math.trunc(hue)
  return `var(--bot-${((index % HUE_COUNT) + HUE_COUNT) % HUE_COUNT})`
}

/**
 * True for a bot that shares its hue with a lower bot: 12 and up. The roster marks it with a
 * hatch, so no two bots share an unmarked hue (DESIGN_SYSTEM §2).
 */
export function wrapsHue(hue: Hue): boolean {
  return typeof hue === 'number' && Math.trunc(hue) >= HUE_COUNT
}
