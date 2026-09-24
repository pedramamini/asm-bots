/**
 * An open server tournament's entry window, as the pages say it. Import-free past the protocol's
 * types: the home page's `enter` loads it, and must not load the tournaments' runner with it.
 */
import type { Tournament } from '@asmbots/protocol'

/** Whether an open tournament takes entries at `now`: scheduled, and its deadline ahead. */
export function takesEntries(t: Tournament, now = Date.now()): boolean {
  return (
    t.entry === 'open' &&
    t.status === 'scheduled' &&
    t.entryClosesAt !== null &&
    now < Date.parse(t.entryClosesAt)
  )
}

/** The time of an ISO timestamp as the page says it: `2026-10-02 18:00 UTC`. */
export function utcTime(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`
}
