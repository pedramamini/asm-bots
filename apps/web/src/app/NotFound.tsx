import { useLocation } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'
import { PageHeading } from './PageHeading'
import { Placeholder } from './Placeholder'

/**
 * The imp that lives at 0x0404: the arena's own renderer and Worker, so its own chunk, which the
 * shell every page loads never waits for.
 */
const LiveImp = lazy(() =>
  import('../features/arena/demo/LiveImp').then((m) => ({ default: m.LiveImp })),
)

/** Any path the router does not know, or a page a route could not find. */
export function NotFound() {
  return <NotFoundPanel />
}

/**
 * The 0x404 panel, which names the address, and the live imp that moved in there. Unpadded inside
 * a page that pads its content.
 */
export function NotFoundPanel({ padded = true }: { padded?: boolean | undefined }) {
  const pathname = useLocation({ select: (location) => location.pathname })
  return (
    <>
      <PageHeading>0x404</PageHeading>
      <Placeholder
        title="0x404 · nothing at this address"
        status={pathname}
        padded={padded}
        figure={
          // The arena is always black; the box keeps its size while the imp loads.
          <div className="relative h-40 overflow-hidden rounded-sm bg-arena-bg">
            <Suspense fallback={null}>
              <LiveImp />
            </Suspense>
          </div>
        }
      >
        no route lives here. an imp moved in at 0x0404.
      </Placeholder>
    </>
  )
}
