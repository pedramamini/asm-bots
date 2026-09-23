/** The brand, as the header and the tab show it. */
export const BRAND = 'ASM BOTS'

/** The tab title of a route: `ASM BOTS // ARENA`, and any detail after it: `… · replay 1a2b`. */
export function routeTitle(label: string, detail?: string): string {
  const title = `${BRAND} // ${label.toUpperCase()}`
  return detail === undefined ? title : `${title} · ${detail}`
}

/** A route's `head`, for the title alone. */
export function titleHead(label: string, detail?: string) {
  return { meta: [{ title: routeTitle(label, detail) }] }
}
