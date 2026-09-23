import { createFileRoute, Outlet } from '@tanstack/react-router'
import { DocsFrame } from '../app/DocsFrame'
import { NotFoundPanel } from '../app/NotFound'
import { titleHead } from '../app/title'

export const Route = createFileRoute('/docs')({
  head: () => titleHead('docs'),
  component: DocsLayout,
  // An unknown page's 0x404 keeps the sidebar, so the search is one key away.
  notFoundComponent: () => (
    <DocsFrame>
      <NotFoundPanel padded={false} />
    </DocsFrame>
  ),
})

function DocsLayout() {
  return (
    <DocsFrame>
      <Outlet />
    </DocsFrame>
  )
}
