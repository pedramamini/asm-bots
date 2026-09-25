import { BRAND, routeTitle } from '@asmbots/protocol'
import { useRouterState } from '@tanstack/react-router'

export { BRAND, routeTitle }

/** The label of a path no route owns. */
export const NOT_FOUND_LABEL = '0x404'

/** The `head` meta entry that carries a route's label to the header's brand. */
const LABEL_META = 'asmbots:route'

/** A route's `head`: the title, and the label the header's brand shows. */
export function titleHead(label: string, detail?: string) {
  return { meta: [{ title: routeTitle(label, detail) }, { name: LABEL_META, content: label }] }
}

export interface RouteHead {
  /** The tab title. */
  title: string
  /** The route label, lowercase (`arena`), or null on a route without a head. */
  label: string | null
}

/** The deepest route's title and label, or 0x404's for a path nobody owns. */
export function useRouteHead(): RouteHead {
  const title = useRouterState({ select: ({ matches }) => headOf(matches).title })
  const label = useRouterState({ select: ({ matches }) => headOf(matches).label })
  return { title, label }
}

type Meta =
  | { title?: string | undefined; name?: string | undefined; content?: string | undefined }
  | undefined
interface MatchHead {
  status: string
  _notFound?: boolean | undefined
  meta?: readonly Meta[] | undefined
}

function headOf(matches: readonly MatchHead[]): RouteHead {
  if (matches.some((match) => match.status === 'notFound' || match._notFound === true)) {
    return { title: routeTitle(NOT_FOUND_LABEL), label: NOT_FOUND_LABEL }
  }
  for (const match of [...matches].reverse()) {
    const title = match.meta?.find((meta) => meta?.title !== undefined)?.title
    if (title === undefined) continue
    const label = match.meta?.find((meta) => meta?.name === LABEL_META)?.content ?? null
    return { title, label }
  }
  return { title: BRAND, label: null }
}
