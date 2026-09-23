import {
  autoUpdate,
  flip,
  offset,
  type Placement,
  shift,
  useFloating,
} from '@floating-ui/react-dom'
import { type CSSProperties, useCallback } from 'react'
import { vars } from '../style'

/** Space kept between a floating layer and the viewport's edge, px. */
const EDGE = 8

/**
 * A floating layer's classes: fixed at `--x`, `--y`, over the browser's popover defaults (inset 0,
 * margin auto, overflow auto).
 */
export const LAYER_CLASSES = 'fixed inset-auto top-(--y) left-(--x) m-0 overflow-visible'

export interface FloatingLayer {
  /** The ref for the element the layer hangs from. */
  reference: (node: HTMLElement | null) => void
  /** The ref for the layer: an element with `popover="manual"` and LAYER_CLASSES. */
  floating: (node: HTMLElement | null) => void
  /** The layer's position, as the variables LAYER_CLASSES read. */
  style: CSSProperties
  /**
   * False until the first position is known. Keep the layer transparent until then (`opacity-0`,
   * which the 120 ms opacity transition turns into its fade-in); `invisible` would also stop its
   * items taking the focus.
   */
  positioned: boolean
}

/**
 * Positions a tooltip or a menu next to the element it hangs from, `gap` px away, with floating-ui:
 * it flips to the other side and shifts along it to stay in the viewport, and follows scrolls and
 * resizes. The layer shows in the top layer (the Popover API), above every stacking context, a
 * transformed ancestor, and an open modal dialog; without the API it is a fixed element.
 */
export function useFloatingLayer(open: boolean, placement: Placement, gap: number): FloatingLayer {
  const { refs, x, y, isPositioned } = useFloating({
    open,
    placement,
    strategy: 'fixed',
    middleware: [offset(gap), flip({ padding: EDGE }), shift({ padding: EDGE })],
    whileElementsMounted: autoUpdate,
  })
  const floating = useCallback(
    (node: HTMLElement | null) => {
      // Into the top layer before floating-ui measures it: a popover measures nothing while hidden.
      if (node !== null && typeof node.showPopover === 'function') {
        try {
          node.showPopover()
        } catch {
          // Already showing: a ref attached twice (React's strict mode) shows it twice.
        }
      }
      refs.setFloating(node)
    },
    [refs],
  )
  return {
    reference: refs.setReference,
    floating,
    style: vars({ '--x': `${Math.round(x)}px`, '--y': `${Math.round(y)}px` }),
    positioned: isPositioned,
  }
}
