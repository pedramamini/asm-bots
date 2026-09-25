import { useLocation } from '@tanstack/react-router'
import { PageHeading } from './PageHeading'
import { Placeholder } from './Placeholder'

/** Any path the router does not know, or a page a route could not find. */
export function NotFound() {
  return <NotFoundPanel />
}

/** The 0x404 panel, which names the address. Unpadded inside a page that pads its content. */
export function NotFoundPanel({ padded = true }: { padded?: boolean | undefined }) {
  const pathname = useLocation({ select: (location) => location.pathname })
  return (
    <>
      <PageHeading>0x404</PageHeading>
      <Placeholder title="0x404 · nothing at this address" status={pathname} padded={padded}>
        no route lives here.
      </Placeholder>
    </>
  )
}
