/**
 * The site's canonical origin: what page heads link to, and what a screenshot signs, whichever
 * host served the page. The Worker's `SITE_URL` (apps/api/wrangler.jsonc) agrees.
 */
export const SITE_URL = 'https://asmbots.io'

/** The repository: the header's and the footer's source link. */
export const SOURCE_URL = 'https://github.com/pedramamini/asmbots.io'

/** The origin as a person types it: `asmbots.io`. */
export const SITE_HOST = new URL(SITE_URL).host

/** The app path of a link to the canonical site, `https://asmbots.io/docs` → `/docs`; else null. */
export function sitePath(href: string): string | null {
  return href.startsWith(`${SITE_URL}/`) ? href.slice(SITE_URL.length) : null
}
