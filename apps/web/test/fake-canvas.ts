/** Canvas contexts for the arena's jsdom tests, which have no canvas. */

/** A 2D context that draws nothing: the 2D renderer and the rulers run on it. */
export function fakeContext(): CanvasRenderingContext2D {
  const state: Record<string | symbol, unknown> = {}
  return new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key]
      if (key === 'createImageData') {
        return (w: number, h: number) => ({
          width: w,
          height: h,
          data: new Uint8ClampedArray(w * h * 4),
        })
      }
      if (key === 'measureText') return (text: string) => ({ width: text.length * 6 })
      return () => {}
    },
    set(target, key, value) {
      target[key] = value
      return true
    },
  }) as unknown as CanvasRenderingContext2D
}

/**
 * Gives `canvas` elements of `window` a fake 2D context and no WebGL2, so the arena draws in 2D.
 * Returns what puts `getContext` back.
 */
export function stubCanvas(window: { HTMLCanvasElement: typeof HTMLCanvasElement }): () => void {
  const proto = window.HTMLCanvasElement.prototype
  const getContext = proto.getContext
  proto.getContext = function (this: HTMLCanvasElement, type: string) {
    return type === '2d' ? fakeContext() : null
  } as typeof proto.getContext
  return () => {
    proto.getContext = getContext
  }
}
