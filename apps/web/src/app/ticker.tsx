import type { ReactNode } from 'react'

export interface TickerFeed {
  /** The line, item by item. */
  items: readonly ReactNode[]
  /** Where the `→` goes, and its accessible name. */
  link: { to: string; label: string }
}

/** Static until the live feed lands: the shape of a hill's news. */
const PLACEHOLDER: TickerFeed = {
  items: [<b key="lead">▍LIVE</b>, 'HILL "MAIN"', 'dwarf-v3 took #1', '12,480 cycles'],
  link: { to: '/hills/main', label: 'open the main hill' },
}

/** The ticker's line. */
export function useTicker(): TickerFeed {
  return PLACEHOLDER
}
