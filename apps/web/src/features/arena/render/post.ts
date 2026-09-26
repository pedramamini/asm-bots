/**
 * The arena's post effects (DESIGN_SYSTEM §5): bloom, scanlines, and the vignette. The theme sets
 * how strong each is, and the user's switches (`ArenaEffects` in the settings) turn each off.
 */
import type { Theme } from '@asmbots/ui/themes'
import type { ArenaEffects } from '../../../store/settings'

/** What a theme does with the post effects. */
export interface ThemePost {
  /** How much of the blurred emissive light goes back on the arena: 1 adds it whole. */
  readonly bloom: number
  readonly scanlines: boolean
  readonly vignette: boolean
}

/**
 * Bloom's strength per theme; scanlines and the vignette on the dark themes, off on paper
 * (DESIGN_SYSTEM §5).
 */
export const THEME_POST: Readonly<Record<Theme, ThemePost>> = {
  sentinel: { bloom: 0.9, scanlines: true, vignette: true },
  amber: { bloom: 0.9, scanlines: true, vignette: true },
  pedurple: { bloom: 1, scanlines: true, vignette: true },
  ice: { bloom: 0.85, scanlines: true, vignette: true },
  'tokyo-night': { bloom: 0.85, scanlines: true, vignette: true },
  catppuccin: { bloom: 0.85, scanlines: true, vignette: true },
  paper: { bloom: 0.6, scanlines: false, vignette: false },
}

/** The share of light a scanline takes at its darkest. */
export const SCANLINES = 0.14
/** The share of light the vignette takes in the corners. */
export const VIGNETTE = 0.38

/** The post pass's strengths. 0 turns an effect off. */
export interface Post {
  readonly bloom: number
  readonly scanlines: number
  readonly vignette: number
}

/** No post effects: what the 2D renderer draws. */
export const NO_POST: Post = Object.freeze({ bloom: 0, scanlines: 0, vignette: 0 })

/** The post effects of `theme` with the user's `effects` switches. */
export function postOf(theme: Theme, effects: ArenaEffects): Post {
  const post = THEME_POST[theme]
  return {
    bloom: effects.bloom ? post.bloom : 0,
    scanlines: effects.scanlines && post.scanlines ? SCANLINES : 0,
    vignette: effects.vignette && post.vignette ? VIGNETTE : 0,
  }
}

/** Whether `post` draws anything: else the renderer draws straight onto the canvas. */
export function hasPost(post: Post): boolean {
  return post.bloom > 0 || post.scanlines > 0 || post.vignette > 0
}
