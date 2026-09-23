import { useSyncExternalStore } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

/**
 * True while the system asks for reduced motion (DESIGN_SYSTEM §8), and it follows a change
 * without a reload. False where there is no `matchMedia`.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, reducedMotion, () => false)
}

function subscribe(onChange: () => void): () => void {
  if (typeof matchMedia !== 'function') return () => {}
  const query = matchMedia(QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia(QUERY).matches
}
