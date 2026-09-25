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
  MatchVerification,
  Me,
  MyBotList,
  parse,
  parseReplay,
  SubmissionDetail,
  TICKER_TTL_MS,
  Ticker,
  TournamentDetail,
  TournamentList,
  UserDetail,
} from '@asmbots/protocol'
import { type QueryClient, type QueryKey, queryOptions, useQuery } from '@tanstack/react-query'
import { ApiRequestError, apiGet } from './client'

const segment = encodeURIComponent

/**
 * The hills and their standings: the API keeps them 30 s (`Cache-Control: public, max-age=30`). A
 * first read may come from that cache; a read again (a job ended, a submission finished, the tab
 * came back) asks past it, so a board the page knows has changed shows as it is.
 */
const refetching = ({ client, queryKey }: { client: QueryClient; queryKey: QueryKey }) =>
  client.getQueryData(queryKey) !== undefined

export const hillsQuery = () =>
  queryOptions({
    queryKey: ['hills'],
    queryFn: (context) =>
      apiGet('/hills', (v) => parse(HillList, v, 'the hills'), context.signal, refetching(context)),
  })

export const hillQuery = (slug: string) =>
  queryOptions({
    queryKey: ['hills', slug],
    queryFn: (context) =>
      apiGet(
        `/hills/${segment(slug)}`,
        (v) => parse(HillDetail, v, 'the hill'),
        context.signal,
        refetching(context),
      ),
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
 * A hill submission. With `poll`, asked again every `SUBMISSION_POLL_MS` while its job runs: the
 * page's way when the hill's live room is not open, since the room says when the job moves.
 */
export const submissionQuery = (slug: string, id: string, poll = true) =>
  queryOptions({
    queryKey: ['hills', slug, 'submissions', id],
    queryFn: ({ signal }) =>
      apiGet(
        `/hills/${segment(slug)}/submissions/${segment(id)}`,
        (v) => parse(SubmissionDetail, v, 'the submission'),
        signal,
      ),
    refetchInterval: (query) =>
      poll && submissionActive(query.state.data) ? SUBMISSION_POLL_MS : false,
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

/**
 * A published match's inputs and its row (`GET /api/matches/:id/verify`), to run it again here.
 * Neither ever changes.
 */
export const matchVerificationQuery = (id: string) =>
  queryOptions({
    queryKey: ['matches', id, 'verify'],
    queryFn: ({ signal }) =>
      apiGet(
        `/matches/${segment(id)}/verify`,
        (v) => parse(MatchVerification, v, 'the match'),
        signal,
      ),
    staleTime: Number.POSITIVE_INFINITY,
  })

/** `GET /api/ticker`: the ticker's feed. */
export const fetchTicker = (signal?: AbortSignal) =>
  apiGet('/ticker', (v) => parse(Ticker, v, 'the ticker'), signal)

/** The ticker's feed, read again as often as the server does (`TICKER_TTL_MS`). */
export const tickerQuery = () =>
  queryOptions({
    queryKey: ['ticker'],
    queryFn: ({ signal }) => fetchTicker(signal),
    staleTime: TICKER_TTL_MS,
    refetchInterval: TICKER_TTL_MS,
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

/** How often a running server tournament's page reads it again while its live room is not open. */
export const TOURNAMENT_POLL_MS = 5000

/**
 * A server tournament. With `poll`, read again every `TOURNAMENT_POLL_MS` while it runs: the
 * page's way when its live room is not open, since the room says when a match lands.
 */
export const tournamentQuery = (id: string, poll = false) =>
  queryOptions({
    queryKey: ['tournaments', id],
    queryFn: ({ signal }) =>
      apiGet(
        `/tournaments/${segment(id)}`,
        (v) => parse(TournamentDetail, v, 'the tournament'),
        signal,
      ),
    refetchInterval: (query) =>
      poll && query.state.data?.tournament.status === 'running' ? TOURNAMENT_POLL_MS : false,
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

/** Whether someone may be signed in here: the API's hint beside the session. */
export function mayBeSignedIn(): boolean {
  return SIGNED_IN.test(globalThis.document?.cookie ?? '')
}

/** The signed-in user, or null when nobody is. */
export const meQuery = () =>
  queryOptions({
    queryKey: ['me'],
    queryFn: async ({ signal }): Promise<Me | null> => {
      if (!mayBeSignedIn()) return null
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
/** A hill submission, polled while its job runs unless `poll` is false; waits while `id` is null. */
export const useSubmission = (slug: string, id: string | null, poll = true) =>
  useQuery({ ...submissionQuery(slug, id ?? '', poll), enabled: id !== null })
export const useBot = (id: string) => useQuery(botQuery(id))
/** One version of a bot; waits while `version` is null. */
export const useBotVersion = (id: string, version: number | null) =>
  useQuery({ ...botVersionQuery(id, version ?? 0), enabled: version !== null })
/** The stored replay `key`; waits while `key` is null. */
export const useReplay = (key: string | null) =>
  useQuery({ ...replayQuery(key ?? ''), enabled: key !== null })
export const useTournaments = () => useQuery(tournamentsQuery())
/** One tournament, polled while it runs when `poll` is on; waits while `id` is null. */
export const useTournament = (id: string | null, poll = false) =>
  useQuery({ ...tournamentQuery(id ?? '', poll), enabled: id !== null })
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
