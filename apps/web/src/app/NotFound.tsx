import { Placeholder } from './Placeholder'

/** Any path the router does not know. */
export function NotFound() {
  return <Placeholder title="0x404 · nothing at this address">no route lives here.</Placeholder>
}
