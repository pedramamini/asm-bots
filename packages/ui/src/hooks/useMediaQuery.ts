import { useSyncExternalStore } from 'react'

/** Tailwind's `md`: from here up the header shows its labels and a table its every column. */
export const WIDE = '(min-width: 48rem)'

/**
 * Whether `query` matches, following the viewport without a reload. Where there is no
 * `matchMedia` (a server, a bare test DOM) it is `fallback`: true by default, the wide layout.
 */
export function useMediaQuery(query: string, fallback = true): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (typeof matchMedia !== 'function') return () => {}
      const list = matchMedia(query)
      list.addEventListener('change', notify)
      return () => list.removeEventListener('change', notify)
    },
    () => (typeof matchMedia === 'function' ? matchMedia(query).matches : fallback),
    () => fallback,
  )
}
