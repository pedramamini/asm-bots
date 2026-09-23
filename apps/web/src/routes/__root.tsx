import { ToastProvider } from '@asmbots/ui'
import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Outlet, useRouterState } from '@tanstack/react-router'
import { useEffect } from 'react'
import { ErrorPage } from '../app/ErrorPage'
import { NotFound } from '../app/NotFound'
import { BRAND, routeTitle } from '../app/title'

export interface RouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({ meta: [{ title: BRAND }] }),
  component: Root,
  errorComponent: ({ error }) => <ErrorPage error={error} />,
  notFoundComponent: NotFound,
})

function Root() {
  return (
    <ToastProvider>
      <DocumentTitle />
      <Outlet />
    </ToastProvider>
  )
}

/** Keeps the tab's title on the deepest route's `head` title, or 0x404 for a path nobody owns. */
function DocumentTitle() {
  const title = useRouterState({
    select: ({ matches }) => {
      if (matches.some((match) => match.status === 'notFound' || match._notFound === true)) {
        return routeTitle('0x404')
      }
      for (const match of [...matches].reverse()) {
        const found = match.meta?.find((meta) => meta?.title !== undefined)?.title
        if (found !== undefined) return found
      }
      return BRAND
    },
  })
  useEffect(() => {
    document.title = title
  }, [title])
  return null
}
