import type { ReactNode } from 'react'
import feed from './ticker.json'

export interface TickerFeed {
  /** The line, item by item. */
  items: readonly ReactNode[]
  /** Where the `→` goes, and its accessible name. */
  link: { to: string; label: string }
}

/**
 * Static until the live feed lands (ticker.json): the latest hill event, the latest tournament
 * result, and the countdown to the next championship (PRODUCT_SPEC §1).
 */
const STATIC: TickerFeed = {
  items: [<b key="lead">{feed.lead}</b>, ...feed.items],
  link: feed.link,
}

/** The ticker's line. */
export function useTicker(): TickerFeed {
  return STATIC
}
