import type { HTMLAttributes, Ref, RefCallback } from 'react'

/** What an element must take for a Tooltip or a Menu to wire it up: a ref and the DOM handlers. */
export type TriggerProps = HTMLAttributes<HTMLElement> & { ref?: Ref<HTMLElement> | undefined }

/**
 * One ref callback that sets each of `refs`, for a component that needs a ref to an element the
 * caller also holds a ref to. Memoize the result: a new callback on each render detaches and
 * re-attaches the element each render.
 */
export function mergeRefs<T>(...refs: readonly (Ref<T> | undefined)[]): RefCallback<T> {
  return (node) => {
    const cleanups = refs.map((ref) => {
      if (typeof ref === 'function') return ref(node)
      if (ref != null) ref.current = node
      return undefined
    })
    return () => {
      refs.forEach((ref, index) => {
        const cleanup = cleanups[index]
        if (typeof cleanup === 'function') cleanup()
        else if (typeof ref === 'function') ref(null)
        else if (ref != null) ref.current = null
      })
    }
  }
}
