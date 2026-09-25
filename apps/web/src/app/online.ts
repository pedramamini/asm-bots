import { useSyncExternalStore } from 'react'

function subscribe(listener: () => void): () => void {
  window.addEventListener('online', listener)
  window.addEventListener('offline', listener)
  return () => {
    window.removeEventListener('online', listener)
    window.removeEventListener('offline', listener)
  }
}

/** `navigator.onLine`, where there is one: a runtime without the flag (Bun) reads as online. */
function online(): boolean {
  return globalThis.navigator?.onLine !== false
}

/**
 * Whether the browser has a network (`navigator.onLine`), live through its `online` and `offline`
 * events: the status bar's offline banner. Without a DOM it reads as online.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, online, () => true)
}
