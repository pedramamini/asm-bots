/**
 * TanStack Query options and hooks for each read route (`apps/api/src/routes`). The query keys
 * start with the route's first segment, so `invalidateQueries({ queryKey: ['hills'] })` refetches
 * every hill read.
 */
import {
  BotDetail,
  BotVersionDetail,
  HillDetail,
  HillList,
  MatchList,
  parse,
  parseReplay,
  TournamentDetail,
  TournamentList,
  UserDetail,
} from '@asmbots/protocol'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { apiGet } from './client'

const segment = encodeURIComponent

export const hillsQuery = () =>
  queryOptions({
    queryKey: ['hills'],
    queryFn: ({ signal }) => apiGet('/hills', (v) => parse(HillList, v, 'the hills'), signal),
  })

export const hillQuery = (slug: string) =>
  queryOptions({
    queryKey: ['hills', slug],
    queryFn: ({ signal }) =>
      apiGet(`/hills/${segment(slug)}`, (v) => parse(HillDetail, v, 'the hill'), signal),
  })

export interface HillMatchesFilter {
  /** A bot version id: only its matches. */
  readonly bot?: string | undefined
  /** 1..100; the API's default is 50. */
  readonly limit?: number | undefined
}

export const hillMatchesQuery = (slug: string, { bot, limit }: HillMatchesFilter = {}) => {
  const search = new URLSearchParams()
  if (bot !== undefined) search.set('bot', bot)
  if (limit !== undefined) search.set('limit', String(limit))
  const query = search.size > 0 ? `?${search}` : ''
  return queryOptions({
    queryKey: ['hills', slug, 'matches', { bot: bot ?? null, limit: limit ?? null }],
    queryFn: ({ signal }) =>
      apiGet(
        `/hills/${segment(slug)}/matches${query}`,
        (v) => parse(MatchList, v, 'the matches'),
        signal,
      ),
  })
}

export const botQuery = (id: string) =>
  queryOptions({
    queryKey: ['bots', id],
    queryFn: ({ signal }) =>
      apiGet(`/bots/${segment(id)}`, (v) => parse(BotDetail, v, 'the bot'), signal),
  })

export const botVersionQuery = (id: string, version: number) =>
  queryOptions({
    queryKey: ['bots', id, 'versions', version],
    queryFn: ({ signal }) =>
      apiGet(
        `/bots/${segment(id)}/versions/${version}`,
        (v) => parse(BotVersionDetail, v, 'the bot version'),
        signal,
      ),
    // A version never changes.
    staleTime: Number.POSITIVE_INFINITY,
  })

export const replayQuery = (key: string) =>
  queryOptions({
    queryKey: ['replays', key],
    queryFn: ({ signal }) => apiGet(`/replays/${segment(key)}`, parseReplay, signal),
    // A replay's key names its content: it never changes.
    staleTime: Number.POSITIVE_INFINITY,
  })

export const tournamentsQuery = () =>
  queryOptions({
    queryKey: ['tournaments'],
    queryFn: ({ signal }) =>
      apiGet('/tournaments', (v) => parse(TournamentList, v, 'the tournaments'), signal),
  })

export const tournamentQuery = (id: string) =>
  queryOptions({
    queryKey: ['tournaments', id],
    queryFn: ({ signal }) =>
      apiGet(
        `/tournaments/${segment(id)}`,
        (v) => parse(TournamentDetail, v, 'the tournament'),
        signal,
      ),
  })

export const userQuery = (handle: string) =>
  queryOptions({
    queryKey: ['users', handle.toLowerCase()],
    queryFn: ({ signal }) =>
      apiGet(`/users/${segment(handle)}`, (v) => parse(UserDetail, v, 'the user'), signal),
  })

export const useHills = () => useQuery(hillsQuery())
export const useHill = (slug: string) => useQuery(hillQuery(slug))
export const useHillMatches = (slug: string, filter?: HillMatchesFilter) =>
  useQuery(hillMatchesQuery(slug, filter))
export const useBot = (id: string) => useQuery(botQuery(id))
/** One version of a bot; waits while `version` is null. */
export const useBotVersion = (id: string, version: number | null) =>
  useQuery({ ...botVersionQuery(id, version ?? 0), enabled: version !== null })
/** The stored replay `key`; waits while `key` is null. */
export const useReplay = (key: string | null) =>
  useQuery({ ...replayQuery(key ?? ''), enabled: key !== null })
export const useTournaments = () => useQuery(tournamentsQuery())
/** One tournament; waits while `id` is null. */
export const useTournament = (id: string | null) =>
  useQuery({ ...tournamentQuery(id ?? ''), enabled: id !== null })
export const useUser = (handle: string) => useQuery(userQuery(handle))
