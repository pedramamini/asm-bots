/**
 * What an arena renderer does. `ArenaCanvas` makes the WebGL2 one (`gl.ts`), or the 2D fallback
 * (`canvas2d.ts`) where WebGL2 is missing. Both draw an `ArenaScene` through a `Camera`.
 */
import type { Theme } from '@asmbots/ui/themes'
import type { ArenaEffects } from '../../../store/settings'

/** WebGL2, or the 2D fallback: no bloom, scanlines, or vignette. */
export type RendererKind = 'webgl2' | '2d'

export interface ArenaRenderer {
  readonly kind: RendererKind
  /** The canvas's size, CSS px, and the device pixel ratio: its backing store is the product. */
  resize(width: number, height: number, ratio: number): void
  /** The theme's palette and post effects (DESIGN_SYSTEM §2, §5). */
  setTheme(theme: Theme): void
  /** The user's post effect switches. The 2D renderer has no post effects. */
  setEffects(effects: ArenaEffects): void
  /** Whether the minimap shows when the camera is zoomed in. */
  setMinimap(on: boolean): void
  /** Draws at the next `render`, whatever changed. */
  invalidate(): void
  /**
   * Advances the scene to `now` (ms, `performance.now()`'s clock) and draws it, unless nothing
   * changed since the last image: no frame, nothing fading, the same camera and settings. `force`
   * draws anyway. Returns whether it drew.
   */
  render(now: number, force?: boolean): boolean
  /** Lets the GPU resources go. The renderer draws nothing after this. */
  dispose(): void
}
