import type { BotLabel, Ticker, TickerChampionship, TickerHillEvent } from '@asmbots/protocol'
import { useQuery } from '@tanstack/react-query'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { fetchTicker, tickerQuery } from '../api/queries'
import { paintedAndIdle } from './paint'

export interface TickerFeed {
  /** The line, item by item. */
  items: readonly ReactNode[]
  /** Where the `→` goes, and its accessible name. */
  link: { to: string; label: string }
}

const MAIN_HILL = { to: '/hills/main', label: 'open the main hill' }

/** Until the feed comes, and when it cannot: what is always so. */
export const QUIET_FEED: TickerFeed = {
  items: [
    <b key="lead">▍ASM BOTS</b>,
    'WRITE 8086 ASSEMBLY',
    'FIGHT FOR 64 KB',
    'A CHAMPIONSHIP EVERY SATURDAY 18:00 UTC',
  ],
  link: MAIN_HILL,
}

/** How often a countdown moves on, ms. */
const CLOCK_MS = 30_000

/** `Dwarf v3`, or `[deleted]`. */
function botName(bot: BotLabel | null): string {
  return bot === null ? '[deleted]' : `${bot.name} v${bot.version}`
}

/** `Dwarf v3 took #1 (+3)`, `Imp v1 missed the hill`. */
export function challengeText({ event, bot }: TickerHillEvent): string {
  const name = botName(bot)
  if (event.kind === 'rejected') return `${name} missed the hill`
  if (event.kind !== 'entered') return `${name} ${event.kind}`
  const delta =
    event.delta === null || event.delta === 0
      ? ''
      : ` (${event.delta > 0 ? '+' : ''}${event.delta})`
  return `${name} took #${event.rank ?? '?'}${delta}`
}

/** `2D 04H`, `4H 12M`, `12M`: the time left, rounded up to the minute. */
export function countdown(ms: number): string {
  const minutes = Math.max(0, Math.ceil(ms / 60_000))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const rest = minutes % 60
  if (days > 0) return `${days}D ${String(hours).padStart(2, '0')}H`
  if (hours > 0) return `${hours}H ${String(rest).padStart(2, '0')}M`
  return `${rest}M`
}

/** The next championship: live now, the time to its start, or starting (the cron is due). */
function nextText(next: TickerChampionship, now: number): string {
  if (next.status === 'running') return `CUP "${next.name.toUpperCase()}" LIVE NOW`
  const left = next.startsAt === null ? Number.NaN : Date.parse(next.startsAt) - now
  if (!(left > 0)) return 'NEXT CHAMPIONSHIP STARTING'
  return `NEXT CHAMPIONSHIP IN ${countdown(left)}`
}

/**
 * The line `ticker` makes at `now` (PRODUCT_SPEC §1): `▍LIVE`, the latest challenge on a hill, the
 * last championship's champion, the next championship (live, or the countdown to it, and its
 * entrants), and the spectators watching now. The `→` opens a championship that is live, else the
 * hill of the challenge. No feed yet: `QUIET_FEED`.
 */
export function tickerFeed(ticker: Ticker | undefined, now: number): TickerFeed {
  if (ticker === undefined) return QUIET_FEED
  const { hill, lastChampionship: last, nextChampionship: next, spectators } = ticker
  const items: ReactNode[] = [<b key="lead">▍LIVE</b>]
  if (hill !== null) items.push(`HILL "${hill.hill.name.toUpperCase()}"`, challengeText(hill))
  if (last?.champion) {
    items.push(`CUP "${last.name.toUpperCase()}" won by ${botName(last.champion)}`)
  }
  if (next !== null) {
    items.push(nextText(next, now))
    if (next.entrants > 0) items.push(`${next.entrants} ENTERED`)
  }
  if (spectators > 0) items.push(`${spectators} WATCHING`)
  if (items.length === 1) items.push('QUIET ON THE HILLS')
  const link =
    next?.status === 'running'
      ? { to: `/tournaments/${encodeURIComponent(next.id)}`, label: `watch ${next.name}` }
      : hill !== null
        ? { to: `/hills/${hill.hill.slug}`, label: `open the ${hill.hill.name} hill` }
        : MAIN_HILL
  return { items, link }
}

/** `Date.now()`, again every `every` ms while `every` is set. */
function useNow(every: number | null): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (every === null) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), every)
    return () => clearInterval(id)
  }, [every])
  return now
}

/**
 * The ticker's line: `GET /api/ticker`, asked once the page has painted (the ticker is the first
 * thing it paints; the feed takes nothing from that paint) and again every 30 s; `QUIET_FEED` until
 * it comes, or when it does not. The wait is in the read, not in state: the ticker draws again
 * only when the feed comes. A countdown moves on by itself.
 */
export function useTicker(): TickerFeed {
  const { data } = useQuery({
    ...tickerQuery(),
    queryFn: async ({ signal }) => {
      await paintedAndIdle(signal)
      return fetchTicker(signal)
    },
  })
  const counting = data?.nextChampionship?.status === 'scheduled'
  const now = useNow(counting ? CLOCK_MS : null)
  return useMemo(() => tickerFeed(data, now), [data, now])
}
