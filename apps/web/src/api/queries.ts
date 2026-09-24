/**
 * TanStack Query options and hooks for each read route (`apps/api/src/routes`). The query keys
 * start with the route's first segment, so `invalidateQueries({ queryKey: ['hills'] })` refetches
 * every hill read.
 */
import {
  BotDetail,
  BotVersionDetail,
  HillDetail,
  HillHistory,
  HillList,
  MatchList,
  Me,
  MyBotList,
  parse,
  parseReplay,
  SubmissionDetail,
  TournamentDetail,
  TournamentList,
  UserDetail,
} from '@asmbots/protocol'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { ApiRequestError, apiGet } from './client'

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

export const hillHistoryQuery = (slug: string, limit?: number) =>
  queryOptions({
    queryKey: ['hills', slug, 'history', { limit: limit ?? null }],
    queryFn: ({ signal }) =>
      apiGet(
        `/hills/${segment(slug)}/history${limit === undefined ? '' : `?limit=${limit}`}`,
        (v) => parse(HillHistory, v, 'the history'),
        signal,
      ),
  })

/** How often a submission's page asks how far its job is, while the job runs. */
export const SUBMISSION_POLL_MS = 1000

/** Whether a submission's job may still change it: queued or running. */
export function submissionActive(detail: SubmissionDetail | undefined): boolean {
  const status = detail?.submission.status
  return status === 'queued' || status === 'running'
}

/**
 * A hill submission, asked again every `SUBMISSION_POLL_MS` while its job runs (the hill's
 * `LiveRoom` socket, which says the same as it happens, comes with spectating).
 */
export const submissionQuery = (slug: string, id: string) =>
  queryOptions({
    queryKey: ['hills', slug, 'submissions', id],
    queryFn: ({ signal }) =>
      apiGet(
        `/hills/${segment(slug)}/submissions/${segment(id)}`,
        (v) => parse(SubmissionDetail, v, 'the submission'),
        signal,
      ),
    refetchInterval: (query) => (submissionActive(query.state.data) ? SUBMISSION_POLL_MS : false),
  })

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

/**
 * The cookie the API sets beside the session, which the page may read: someone may be signed in.
 * Without it `meQuery` asks nothing, so a signed-out visit makes no request and logs no 401.
 */
const SIGNED_IN = /(?:^|;\s*)signed_in=1(?:;|$)/

/** The signed-in user, or null when nobody is. */
export const meQuery = () =>
  queryOptions({
    queryKey: ['me'],
    queryFn: async ({ signal }): Promise<Me | null> => {
      if (!SIGNED_IN.test(globalThis.document?.cookie ?? '')) return null
      try {
        return await apiGet('/me', (v) => parse(Me, v, 'your account'), signal)
      } catch (error) {
        if (!(error instanceof ApiRequestError) || error.status !== 401) throw error
        // The session is gone (expired, or ended elsewhere): so is the hint.
        // biome-ignore lint/suspicious/noDocumentCookie: the one cookie the page owns
        document.cookie = 'signed_in=; Max-Age=0; Path=/'
        return null
      }
    },
  })

/** The signed-in user's cloud bots, under `me` so signing out drops them with the account. */
export const myBotsQuery = () =>
  queryOptions({
    queryKey: ['me', 'bots'],
    queryFn: ({ signal }) => apiGet('/me/bots', (v) => parse(MyBotList, v, 'your bots'), signal),
  })

export const useHills = () => useQuery(hillsQuery())
export const useHill = (slug: string) => useQuery(hillQuery(slug))
export const useHillMatches = (slug: string, filter?: HillMatchesFilter) =>
  useQuery(hillMatchesQuery(slug, filter))
export const useHillHistory = (slug: string, limit?: number) =>
  useQuery(hillHistoryQuery(slug, limit))
/** A hill submission, polled while its job runs; waits while `id` is null. */
export const useSubmission = (slug: string, id: string | null) =>
  useQuery({ ...submissionQuery(slug, id ?? ''), enabled: id !== null })
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
/** A profile; waits while `handle` is null. */
export const useMaybeUser = (handle: string | null) =>
  useQuery({ ...userQuery(handle ?? ''), enabled: handle !== null })
export const useMe = () => useQuery(meQuery())
/** The signed-in user's cloud bots; asks nothing while nobody is signed in. */
export function useMyBots() {
  const signedIn = Boolean(useMe().data)
  return useQuery({ ...myBotsQuery(), enabled: signedIn })
}
