/**
 * The hill route's query, as the router reads and writes it. This module imports nothing: the
 * route's `validateSearch` lives in the app's entry chunk.
 */

/** `/hills/$slug?submission=<id>`: the submission whose progress and result the page shows. */
export interface HillSearch {
  readonly submission?: string | undefined
}

/** A submission id as the URL may carry it. */
const ID = /^[A-Za-z0-9_-]{1,64}$/

/** The route's `validateSearch`: a well-formed `submission`, else nothing. */
export function validateHillSearch(raw: Record<string, unknown>): HillSearch {
  return typeof raw.submission === 'string' && ID.test(raw.submission)
    ? { submission: raw.submission }
    : {}
}
