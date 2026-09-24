/**
 * The arena's screenshot (`s`, PRODUCT_SPEC §2): the image on screen, in its theme, with the HUD's
 * words in the band over the core and the bots' hues named in a band under it, as a PNG.
 */
import type { ArenaCanvasHandle } from '../ArenaCanvas'

/** What the screenshot writes on the arena. */
export interface ScreenshotText {
  /** Top left, one chip each: `cycle 3,527 / 100,000`, `100/f`. */
  readonly chips: readonly string[]
  /** Top right: `ASM BOTS · seed 1 · round 1/3`. */
  readonly title: string
  /** Under the arena: the bots' names, each beside its hue. */
  readonly bots: readonly string[]
}

/** CSS px, scaled by the device pixel ratio when drawn. */
const INSET = 8
const PAD_X = 8
const CHIP_HEIGHT = 18
const GAP = 4
/** Where the chips start: clear of the row ruler (44 px), as the HUD's do. */
const LEFT = 56
/** A legend chip's swatch and the space after it. */
const SWATCH = 12
const FONT = '500 10px "JetBrains Mono", ui-monospace, monospace'

/** A theme token's value on the page: `--panel`. */
function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

interface LegendChip {
  readonly name: string
  readonly bot: number
  readonly width: number
}

/** The bots' chips in rows that fit `width` CSS px from `LEFT` on. */
function legendRows(
  ctx: CanvasRenderingContext2D,
  names: readonly string[],
  width: number,
): LegendChip[][] {
  const rows: LegendChip[][] = [[]]
  let used = 0
  names.forEach((name, bot) => {
    const chip = ctx.measureText(name.toUpperCase()).width + 2 * PAD_X + SWATCH
    if (used + chip > width - LEFT - INSET && (rows.at(-1)?.length ?? 0) > 0) {
      rows.push([])
      used = 0
    }
    rows.at(-1)?.push({ name, bot, width: chip })
    used += chip + GAP
  })
  return rows
}

/**
 * The arena of `handle` drawn now, with `text` on it, as a PNG: null where the canvas cannot make
 * one. The renderer draws and the image is copied in the same task, since a WebGL canvas keeps no
 * drawing buffer past it.
 */
export function captureArena(
  handle: ArenaCanvasHandle,
  text: ScreenshotText,
): Promise<Blob | null> {
  const { canvas, overlay, renderer } = handle
  if (canvas === null || renderer === null) return Promise.resolve(null)
  const ratio = canvas.clientWidth > 0 ? canvas.width / canvas.clientWidth : 1
  const width = canvas.width / ratio
  const height = canvas.height / ratio
  const shot = document.createElement('canvas')
  const probe = shot.getContext('2d')
  if (probe === null) return Promise.resolve(null)
  probe.font = FONT
  const rows = legendRows(probe, text.bots, width)
  shot.width = canvas.width
  shot.height = canvas.height + Math.round((rows.length * (CHIP_HEIGHT + GAP) + INSET) * ratio)
  // A new size resets the context: the transform, the font, all of it.
  const ctx = shot.getContext('2d') as CanvasRenderingContext2D
  ctx.fillStyle = token('--arena-bg') || '#000'
  ctx.fillRect(0, 0, shot.width, shot.height)
  renderer.render(performance.now(), true)
  ctx.drawImage(canvas, 0, 0)
  if (overlay !== null) ctx.drawImage(overlay, 0, 0)
  ctx.scale(ratio, ratio)
  drawText(ctx, text, rows, width, height)
  return new Promise((resolve) => shot.toBlob(resolve, 'image/png'))
}

/** The HUD's words over an arena `width` x `height` CSS px, and the bots' legend under it. */
function drawText(
  ctx: CanvasRenderingContext2D,
  text: ScreenshotText,
  rows: readonly (readonly LegendChip[])[],
  width: number,
  height: number,
): void {
  const panel = token('--panel') || '#111A11'
  const border = token('--border') || '#1A2F1A'
  const muted = token('--text-muted') || '#6A8C6A'
  const accent = token('--accent') || '#00FF88'
  ctx.textBaseline = 'middle'
  ctx.font = FONT

  /** A chip at (`x`, `y`) with `label` in `color`, and a swatch first; returns its width. */
  const chip = (x: number, y: number, label: string, color: string, swatch?: string): number => {
    const words = label.toUpperCase()
    const w = ctx.measureText(words).width + 2 * PAD_X + (swatch === undefined ? 0 : SWATCH)
    ctx.fillStyle = panel
    ctx.fillRect(x, y, w, CHIP_HEIGHT)
    ctx.strokeStyle = border
    ctx.lineWidth = 1
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, CHIP_HEIGHT - 1)
    let at = x + PAD_X
    if (swatch !== undefined) {
      ctx.fillStyle = swatch
      ctx.fillRect(at, y + CHIP_HEIGHT / 2 - 4, 8, 8)
      at += SWATCH
    }
    ctx.fillStyle = color
    ctx.fillText(words, at, y + CHIP_HEIGHT / 2 + 0.5)
    return w
  }

  let x = LEFT
  for (const label of text.chips) x += chip(x, INSET, label, muted) + GAP
  const titleWidth = ctx.measureText(text.title.toUpperCase()).width + 2 * PAD_X
  chip(width - INSET - titleWidth, INSET, text.title, accent)

  // Bot 12 and on share the hues again (DESIGN_SYSTEM §2).
  rows.forEach((row, r) => {
    const y = height + r * (CHIP_HEIGHT + GAP)
    let at = LEFT
    for (const { name, bot } of row) {
      at += chip(at, y, name, muted, token(`--bot-${bot % 12}`) || muted) + GAP
    }
  })
}
