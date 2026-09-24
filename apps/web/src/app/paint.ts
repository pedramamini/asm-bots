/**
 * Waiting for the page's first paint: what loads after it takes nothing from it.
 */
import { useEffect, useState } from 'react'

/** The longest a deferred load waits for the browser to be idle once the page has painted, ms. */
const IDLE_TIMEOUT = 2000

/** The paint timing entry of the page's first text or image. */
const FIRST_CONTENTFUL_PAINT = 'first-contentful-paint'

/**
 * Calls `then` once the page has painted content: at its first contentful paint, or where the
 * browser does not report paints, two display frames on. The load event comes too early to tell:
 * before the app's first render. Returns what cancels the call.
 */
function afterFirstPaint(then: () => void): () => void {
  const reports =
    typeof PerformanceObserver === 'function' &&
    PerformanceObserver.supportedEntryTypes?.includes('paint') === true
  if (!reports) {
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(then)
    })
    return () => cancelAnimationFrame(id)
  }
  const observer = new PerformanceObserver((entries) => {
    if (entries.getEntriesByName(FIRST_CONTENTFUL_PAINT).length === 0) return
    observer.disconnect()
    then()
  })
  // Buffered: a paint before this call, as on a return to `/`, reports at once.
  observer.observe({ type: 'paint', buffered: true })
  return () => observer.disconnect()
}

/**
 * Whether the page has painted and the browser has since been idle. The home demo and the docs'
 * code blocks wait for it, so their chunks (the arena, CodeMirror) take no bandwidth or
 * main-thread time from the page's first paint. Lighthouse's simulation bills any script that
 * starts before the first contentful paint to FCP and LCP, the load event included: it comes
 * before this app's first render.
 */
export function usePaintedAndIdle(): boolean {
  const [idle, setIdle] = useState(false)
  useEffect(() => {
    let cancel = () => {}
    const whenIdle = () => {
      if (typeof requestIdleCallback === 'function') {
        const id = requestIdleCallback(() => setIdle(true), { timeout: IDLE_TIMEOUT })
        cancel = () => cancelIdleCallback(id)
      } else {
        // Safari has no idle callback: the next task.
        const id = setTimeout(() => setIdle(true), 0)
        cancel = () => clearTimeout(id)
      }
    }
    cancel = afterFirstPaint(whenIdle)
    return () => cancel()
  }, [])
  return idle
}
