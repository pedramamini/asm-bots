/**
 * The arena's screenshot (`s`, PRODUCT_SPEC §2): the image on screen, in its theme, with the HUD's
 * words in the band over the core, the bots' hues named in a band under it, and a footer stamp
 * that says what it shows and where it is from, so the PNG explains itself wherever it goes.
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
  /** The footer stamp, left: the bots, the seed, and the cycle (`footerStamp`). */
  readonly stamp: FooterStamp
  /** The footer stamp, right: the site, `asmbots.io`. */
  readonly site: string
}

/** The footer stamp's words: the bots by name, and by count for when the names do not fit. */
export interface FooterStamp {
  readonly full: string
  readonly short: string
}

const count = (n: number) => n.toLocaleString('en-US')

/** `dwarf vs imp · seed 1 · cycle 3,527`, and `2 bots · seed 1 · cycle 3,527`. */
export function footerStamp(bots: readonly string[], seed: number, cycle: number): FooterStamp {
  const rest = `seed ${seed} · cycle ${count(cycle)}`
  return {
    full: `${bots.join(' vs ')} · ${rest}`,
    short: `${bots.length} ${bots.length === 1 ? 'bot' : 'bots'} · ${rest}`,
  }
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
/** The footer stamp's band: the status bar's height, under the legend. */
export const FOOTER = 22
const FONT = '500 10px "JetBrains Mono", ui-monospace, monospace'

/** A theme token's value on the page: `--panel`. */
function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

/** The theme's colors a shot draws in: the tokens on the page, or sentinel's without them. */
export interface ShotPalette {
  readonly bg: string
  readonly panel: string
  readonly border: string
  readonly muted: string
  readonly accent: string
  /** The bots' hues, `--bot-0` to `--bot-11`. */
  readonly bots: readonly string[]
}

/** The theme's colors as the page has them now. */
export function readPalette(): ShotPalette {
  const muted = token('--text-muted') || '#7D9B7D'
  return {
    bg: token('--arena-bg') || '#000',
    panel: token('--panel') || '#111A11',
    border: token('--border') || '#1A2F1A',
    muted,
    accent: token('--accent-fg') || '#00FF88',
    bots: Array.from({ length: 12 }, (_, bot) => token(`--bot-${bot}`) || muted),
  }
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

/** The size of a canvas's backing store, and of its box, CSS px. */
type Sized = Pick<HTMLCanvasElement, 'width' | 'height' | 'clientWidth'>

/** Where a shot's parts go: the arena, the legend under it, and the footer under that. */
export interface ShotLayout {
  /** The arena in the shot, CSS px. */
  readonly width: number
  readonly height: number
  /** Shot px per CSS px. */
  readonly ratio: number
  readonly rows: readonly (readonly LegendChip[])[]
  /** The shot, px. */
  readonly pixelWidth: number
  readonly pixelHeight: number
}

export interface ShotLayoutOptions {
  /** The widest the shot may be, px: past it, the shot is scaled down. */
  readonly maxWidth?: number | undefined
  /** Whether the shot's sides are even px, as a video encoder wants them. */
  readonly even?: boolean | undefined
}

/**
 * The layout of a shot of `canvas` with the legend of `bots`, measured on `ctx` in the shot's
 * font: at the canvas's own resolution, or scaled down to `maxWidth`.
 */
export function shotLayout(
  ctx: CanvasRenderingContext2D,
  canvas: Sized,
  bots: readonly string[],
  { maxWidth = Number.POSITIVE_INFINITY, even = false }: ShotLayoutOptions = {},
): ShotLayout {
  const own = canvas.clientWidth > 0 ? canvas.width / canvas.clientWidth : 1
  const width = canvas.width / own
  const height = canvas.height / own
  const ratio = own * Math.min(1, maxWidth / Math.max(1, canvas.width))
  ctx.font = FONT
  const rows = legendRows(ctx, bots, width)
  const side = (css: number) => {
    const px = Math.round(css * ratio)
    return even ? px + (px % 2) : px
  }
  return {
    width,
    height,
    ratio,
    rows,
    pixelWidth: side(width),
    pixelHeight: side(height + rows.length * (CHIP_HEIGHT + GAP) + INSET + FOOTER),
  }
}

/**
 * Paints a shot on `ctx`, `layout`'s size: `canvas` and `overlay` as they are now, fitted to the
 * arena's box, then `text` on and under them. A WebGL canvas holds its image only in the task that
 * drew it: paint in that task.
 */
export function paintShot(
  ctx: CanvasRenderingContext2D,
  layout: ShotLayout,
  canvas: HTMLCanvasElement,
  overlay: HTMLCanvasElement | null,
  text: ScreenshotText,
  palette: ShotPalette,
): void {
  const { width, height, ratio } = layout
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = palette.bg
  ctx.fillRect(0, 0, layout.pixelWidth, layout.pixelHeight)
  drawFitted(ctx, canvas, width * ratio, height * ratio)
  if (overlay !== null) drawFitted(ctx, overlay, width * ratio, height * ratio)
  ctx.scale(ratio, ratio)
  drawText(ctx, text, layout.rows, width, height, palette)
  drawStamp(ctx, text, width, layout.pixelHeight / ratio - FOOTER, palette)
}

/** `image` in a box `width` x `height` px at the top left, whole and centered: a resize mid-video. */
function drawFitted(
  ctx: CanvasRenderingContext2D,
  image: HTMLCanvasElement,
  width: number,
  height: number,
): void {
  if (image.width === 0 || image.height === 0) return
  const scale = Math.min(width / image.width, height / image.height)
  const w = image.width * scale
  const h = image.height * scale
  ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h)
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
  const shot = document.createElement('canvas')
  const probe = shot.getContext('2d')
  if (probe === null) return Promise.resolve(null)
  const layout = shotLayout(probe, canvas, text.bots)
  shot.width = layout.pixelWidth
  shot.height = layout.pixelHeight
  // A new size resets the context: the transform, the font, all of it.
  const ctx = shot.getContext('2d') as CanvasRenderingContext2D
  renderer.render(performance.now(), true)
  paintShot(ctx, layout, canvas, overlay, text, readPalette())
  return new Promise((resolve) => shot.toBlob(resolve, 'image/png'))
}

/**
 * The footer stamp in a band at `top`, the width of the shot: what the shot shows (the bots, the
 * seed, the cycle) in muted UPPER on the left, the site in the accent on the right. The bots go by
 * count when their names would reach the site.
 */
function drawStamp(
  ctx: CanvasRenderingContext2D,
  text: ScreenshotText,
  width: number,
  top: number,
  palette: ShotPalette,
) {
  ctx.fillStyle = palette.panel
  ctx.fillRect(0, top, width, FOOTER)
  ctx.fillStyle = palette.border
  ctx.fillRect(0, top, width, 1)
  ctx.font = FONT
  ctx.textBaseline = 'middle'
  const y = top + FOOTER / 2 + 0.5
  const siteWidth = ctx.measureText(text.site).width
  ctx.fillStyle = palette.accent
  ctx.fillText(text.site, width - INSET - siteWidth, y)
  const room = width - INSET - siteWidth - 2 * PAD_X - LEFT
  const full = text.stamp.full.toUpperCase()
  const words = ctx.measureText(full).width <= room ? full : text.stamp.short.toUpperCase()
  ctx.fillStyle = palette.muted
  ctx.fillText(words, LEFT, y)
}

/** The HUD's words over an arena `width` x `height` CSS px, and the bots' legend under it. */
function drawText(
  ctx: CanvasRenderingContext2D,
  text: ScreenshotText,
  rows: readonly (readonly LegendChip[])[],
  width: number,
  height: number,
  { panel, border, muted, accent, bots }: ShotPalette,
): void {
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
      at += chip(at, y, name, muted, bots[bot % 12] ?? muted) + GAP
    }
  })
}
