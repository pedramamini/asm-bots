import { ToastProvider } from '@asmbots/ui'
import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Outlet, useRouterState } from '@tanstack/react-router'
import { useEffect } from 'react'
import { ErrorPage } from '../app/ErrorPage'
import { Frame } from '../app/Frame'
import { NotFound } from '../app/NotFound'
import { BRAND, useRouteHead } from '../app/title'

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
  // A route that draws its own chrome (the gallery) opts out of the frame.
  const framed = useRouterState({
    select: ({ matches }) => !matches.some((match) => match.staticData.frame === false),
  })
  return (
    <ToastProvider>
      <DocumentTitle />
      {framed ? (
        <Frame>
          <Outlet />
        </Frame>
      ) : (
        <Outlet />
      )}
    </ToastProvider>
  )
}

/** Keeps the tab's title on the deepest route's `head` title, or 0x404 for a path nobody owns. */
function DocumentTitle() {
  const { title } = useRouteHead()
  useEffect(() => {
    document.title = title
  }, [title])
  return null
}
