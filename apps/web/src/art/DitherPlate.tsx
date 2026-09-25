import { cx } from '@asmbots/ui'
import { useEffect, useRef } from 'react'
import { ditherCells, LIT, ON, type Scene } from './dither'

export interface DitherPlateProps {
  /** The picture. */
  scene: Scene
  /** A cell's side, px. Each cell's dot is a pixel smaller, so the grid shows. Default 3. */
  cell?: number | undefined
  className?: string | undefined
}

/**
 * A 1-bit scene in the theme's accent (DESIGN_SYSTEM §10), its brightest cells in
 * `--text-bright`, on a clear canvas over whatever surface holds it. It fills its box, draws again
 * when the box resizes or the theme changes, and draws nothing that moves. Art, so hidden from
 * assistive tech: the text beside it says what it shows.
 */
export function DitherPlate({ scene, cell = 3, className }: DitherPlateProps) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const node = canvas.current
    const context = node?.getContext?.('2d')
    if (node == null || context == null) return // No 2D canvas (a test's DOM): the box stays.
    let frame = 0
    const draw = () => {
      frame = 0
      const { width, height } = node.getBoundingClientRect()
      const cols = Math.floor(width / cell)
      const rows = Math.floor(height / cell)
      const ratio = window.devicePixelRatio || 1
      node.width = Math.round(width * ratio)
      node.height = Math.round(height * ratio)
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, width, height)
      if (cols < 1 || rows < 1) return
      const cells = ditherCells(scene, { cols, rows })
      const style = getComputedStyle(node)
      // Centered, so the part cell left over splits between the edges.
      const left = Math.floor((width - cols * cell) / 2)
      const top = Math.floor((height - rows * cell) / 2)
      for (const [kind, token] of [
        [ON, '--accent'],
        [LIT, '--text-bright'],
      ] as const) {
        context.fillStyle = style.getPropertyValue(token).trim() || '#00FF88'
        for (let i = 0; i < cells.length; i++) {
          if (cells[i] !== kind) continue
          context.fillRect(
            left + (i % cols) * cell,
            top + Math.floor(i / cols) * cell,
            cell - 1,
            cell - 1,
          )
        }
      }
    }
    const later = () => {
      if (frame === 0) frame = requestAnimationFrame(draw)
    }
    draw()
    // A DOM without the observers (a test's): the one drawing stays.
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(later) : null
    resize?.observe(node)
    const theme = new MutationObserver(later)
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => {
      cancelAnimationFrame(frame)
      resize?.disconnect()
      theme.disconnect()
    }
  }, [scene, cell])
  // Out of the flow: the box sets the size, and the canvas's own 150 px default never stretches it.
  return (
    <div className={cx('relative size-full', className)}>
      <canvas ref={canvas} aria-hidden className="absolute inset-0 size-full" />
    </div>
  )
}
