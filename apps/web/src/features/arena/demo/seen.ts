/** Whether anyone can see a battle that plays by itself: the 404 page's imp. */
import { type RefObject, useEffect, useState, useSyncExternalStore } from 'react'

function subscribeVisibility(changed: () => void): () => void {
  document.addEventListener('visibilitychange', changed)
  return () => document.removeEventListener('visibilitychange', changed)
}

/**
 * Whether anyone can see `ref`'s element: the tab is visible and the element is on screen.
 * Where there is no `IntersectionObserver`, it counts as on screen.
 */
export function useSeen(ref: RefObject<HTMLElement | null>): boolean {
  const visible = useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState !== 'hidden',
    () => true,
  )
  const [onScreen, setOnScreen] = useState(true)
  useEffect(() => {
    const node = ref.current
    if (node === null || typeof IntersectionObserver !== 'function') return
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1]
      if (entry !== undefined) setOnScreen(entry.isIntersecting)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [ref])
  return visible && onScreen
}
