/**
 * The welcome tour's geometry (`WelcomeTour.tsx`): the hole it cuts in the dim around a step's
 * target, and where its card goes beside that hole. Pure, so the tests can hold it.
 */

/** A box in viewport pixels. */
export interface Box {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** A width and a height. */
export interface Size {
  readonly width: number
  readonly height: number
}

/** Which side of the hole the card sits on; `center` with no hole, `inside` when no side fits. */
export type Side = 'bottom' | 'top' | 'right' | 'left' | 'center' | 'inside'

/** Room between the target and the hole's edge, px. */
export const HOLE_PAD = 6

/** Room between the hole and the card, px. */
export const CARD_GAP = 12

/** Room between the card or the hole and the viewport's edge, px. */
export const VIEW_MARGIN = 8

/** The sides a card tries, in order: under and over read best, then beside. */
const SIDES = ['bottom', 'top', 'right', 'left'] as const

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max))

/**
 * The hole for a target at `rect`: `HOLE_PAD` out on every side, cut to the viewport (a panel
 * taller than the window shows the part in view). Null when none of it is in view, or it has no
 * size (hidden under this width).
 */
export function holeFor(rect: Box, view: Size): Box | null {
  if (rect.width <= 0 || rect.height <= 0) return null
  const left = Math.max(rect.x - HOLE_PAD, VIEW_MARGIN)
  const top = Math.max(rect.y - HOLE_PAD, VIEW_MARGIN)
  const right = Math.min(rect.x + rect.width + HOLE_PAD, view.width - VIEW_MARGIN)
  const bottom = Math.min(rect.y + rect.height + HOLE_PAD, view.height - VIEW_MARGIN)
  if (right <= left || bottom <= top) return null
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/** Whether `rect` lies whole inside the viewport, less its margin. */
export function inView(rect: Box, view: Size): boolean {
  return (
    rect.x >= VIEW_MARGIN &&
    rect.y >= VIEW_MARGIN &&
    rect.x + rect.width <= view.width - VIEW_MARGIN &&
    rect.y + rect.height <= view.height - VIEW_MARGIN
  )
}

/** Whether two holes are the same to the pixel (none is the same as none). */
export function sameBox(a: Box | null, b: Box | null): boolean {
  if (a === null || b === null) return a === b
  return (
    Math.round(a.x) === Math.round(b.x) &&
    Math.round(a.y) === Math.round(b.y) &&
    Math.round(a.width) === Math.round(b.width) &&
    Math.round(a.height) === Math.round(b.height)
  )
}

/**
 * Where a card of `card` size goes for `hole`: centered with no hole; else on the first side of
 * `SIDES` with room for it, centered on the hole along that side and kept in the viewport; else
 * inside the hole, at the bottom of the view (a target as big as the window).
 */
export function placeCard(
  hole: Box | null,
  card: Size,
  view: Size,
): { x: number; y: number; side: Side } {
  const maxX = view.width - VIEW_MARGIN - card.width
  const maxY = view.height - VIEW_MARGIN - card.height
  if (hole === null) {
    return {
      x: clamp((view.width - card.width) / 2, VIEW_MARGIN, maxX),
      y: clamp((view.height - card.height) / 2, VIEW_MARGIN, maxY),
      side: 'center',
    }
  }
  const alongX = clamp(hole.x + hole.width / 2 - card.width / 2, VIEW_MARGIN, maxX)
  const alongY = clamp(hole.y + hole.height / 2 - card.height / 2, VIEW_MARGIN, maxY)
  for (const side of SIDES) {
    if (side === 'bottom') {
      const y = hole.y + hole.height + CARD_GAP
      if (y <= maxY) return { x: alongX, y, side }
    } else if (side === 'top') {
      const y = hole.y - CARD_GAP - card.height
      if (y >= VIEW_MARGIN) return { x: alongX, y, side }
    } else if (side === 'right') {
      const x = hole.x + hole.width + CARD_GAP
      if (x <= maxX) return { x, y: alongY, side }
    } else {
      const x = hole.x - CARD_GAP - card.width
      if (x >= VIEW_MARGIN) return { x, y: alongY, side }
    }
  }
  return { x: alongX, y: clamp(maxY, VIEW_MARGIN, maxY), side: 'inside' }
}

/** The point in the middle of the view: where the hole closes to on a step that lights nothing. */
export function middleOf(view: Size): Box {
  return { x: view.width / 2, y: view.height / 2, width: 0, height: 0 }
}

/** The box `t` of the way from `from` to `to` (0 is `from`, 1 is `to`). */
export function mixBox(from: Box, to: Box, t: number): Box {
  const mix = (a: number, b: number) => a + (b - a) * t
  return {
    x: mix(from.x, to.x),
    y: mix(from.y, to.y),
    width: mix(from.width, to.width),
    height: mix(from.height, to.height),
  }
}
