import type { EmptyStateAction } from '@asmbots/ui'
import { useRouter } from '@tanstack/react-router'
import { type MouseEvent, useCallback } from 'react'

/** A click the browser should keep: a new tab or window, a download, a middle click. */
function opensElsewhere(event: MouseEvent<HTMLElement>): boolean {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0
}

/**
 * Makes an EmptyState's action that goes to an app path: a real link, which the router takes over
 * on a plain click (a modified click opens it elsewhere, as any link would).
 */
export function useLinkAction(): (label: string, to: string) => EmptyStateAction {
  const router = useRouter()
  return useCallback(
    (label: string, to: string): EmptyStateAction => ({
      label,
      href: to,
      onClick: (event) => {
        if (opensElsewhere(event)) return
        event.preventDefault()
        void router.navigate({ to })
      },
    }),
    [router],
  )
}
