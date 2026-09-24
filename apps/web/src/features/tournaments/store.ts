/**
 * Local tournaments (PRODUCT_SPEC §4): each one a record in this browser's IndexedDB, run by
 * `runner.ts` in the arena Worker and saved after every match, so a reload picks it up where it
 * stopped. A record carries all it needs to run: the config, the entrants (a local bot's source
 * is copied in, so editing the bot later changes nothing), and every match played so far.
 */
import type { BattleConfigInput } from '@asmbots/engine'
import type { Bracket, MatchResult, MeleeStanding, Seeding, Standing } from '@asmbots/tourney'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createStore, del, get, set, type UseStore, values } from 'idb-keyval'

export type TournamentKind = 'round-robin' | 'bracket' | 'melee'

export const TOURNAMENT_KINDS: readonly TournamentKind[] = ['round-robin', 'bracket', 'melee']

/** How the UI names a kind. */
export const KIND_LABELS: Readonly<Record<TournamentKind, string>> = {
  'round-robin': 'round robin',
  bracket: 'bracket',
  melee: 'melee',
}

/**
 * `scheduled`: made, not started. `running`: a runner is on it, or will be once the page loads.
 * `paused`, `cancelled`: stopped by the user. `failed`: a match could not run (`error` says why).
 */
export type TournamentStatus =
  | 'scheduled'
  | 'running'
  | 'paused'
  | 'finished'
  | 'cancelled'
  | 'failed'

/** A bot in a tournament. */
export interface TournamentEntrant {
  /**
   * A roster bot, one of this browser's (a saved bot or a dropped file), or a server tournament's
   * bot version (`server.ts`), whose bytes come with its matches' replays.
   */
  readonly source: 'roster' | 'local' | 'server'
  /** The roster slug, the local bot's id (a dropped file's name), or the bot version's id. */
  readonly ref: string
  /** Its name in the tournament's matches: its own, made unique (`Dwarf`, `Dwarf 2`). */
  readonly name: string
  /** A local bot's source as it was when the tournament was made. */
  readonly code?: string | undefined
  /**
   * A shared tournament's local bot (`share.ts`): its machine code, when the link carried it.
   * Such a bot has no `code`.
   */
  readonly bytes?: Uint8Array | undefined
}

export interface Tournament {
  readonly id: string
  readonly name: string
  readonly kind: TournamentKind
  readonly entrants: readonly TournamentEntrant[]
  /** Every match's battle config; its seed is each match's seed. */
  readonly config: BattleConfigInput
  /** Rounds per match; a melee's rounds. */
  readonly rounds: number
  readonly status: TournamentStatus
  /** A bracket's seeding and third-place match. */
  readonly seeding?: Seeding | undefined
  readonly thirdPlace?: boolean | undefined
  /** A bracket's state, once it has started: its matches hold their results. */
  readonly bracket?: Bracket | undefined
  /** A round robin's or a melee's standings so far. */
  readonly standings?: readonly Standing[] | readonly MeleeStanding[] | undefined
  /**
   * The matches played. A round robin's, in schedule order; a bracket's, in the order played; a
   * melee's one match, whole or in part.
   */
  readonly matches: readonly MatchResult[]
  /** Matches (a melee's rounds) played, and in all as far as the runner knows. */
  readonly progress: { readonly done: number; readonly of: number }
  /** The winner's entrant index, once finished. */
  readonly champion: number | null
  /** Why it failed. */
  readonly error?: string | undefined
  /** ms since the epoch. */
  readonly createdAt: number
  readonly updatedAt: number
  /**
   * A server tournament's stored replays by match key (`MatchResult.key`): watching one of its
   * rounds loads the match's replay, which carries the bots. None for a local tournament.
   */
  readonly replays?: Readonly<Record<string, string>> | undefined
}

/** What `createTournament` takes: the rest starts empty. */
export type NewTournament = Pick<
  Tournament,
  'name' | 'kind' | 'entrants' | 'config' | 'rounds' | 'seeding' | 'thirdPlace'
>

/** The IndexedDB database and object store of the tournaments. */
export const TOURNAMENTS_DB = 'asmbots-tournaments'
export const TOURNAMENTS_STORE = 'tournaments'

/**
 * The query key of the tournament list; one tournament's is `[...TOURNAMENTS_KEY, id]`. Not the
 * API's `['tournaments']` (`api/queries.ts`): the server's tournaments share the cache.
 */
export const TOURNAMENTS_KEY = ['local', 'tournaments'] as const

let store: UseStore | undefined
/** Opened on first use, so a page that never touches tournaments never opens the database. */
function tournamentStore(): UseStore {
  store ??= createStore(TOURNAMENTS_DB, TOURNAMENTS_STORE)
  return store
}

/** Every tournament, the newest first. */
export async function listTournaments(): Promise<Tournament[]> {
  const all = await values<Tournament>(tournamentStore())
  return all.sort((a, b) => b.createdAt - a.createdAt || a.name.localeCompare(b.name))
}

export function getTournament(id: string): Promise<Tournament | undefined> {
  return get<Tournament>(id, tournamentStore())
}

/** Saves `tournament` as it is, stamped now. */
export async function saveTournament(tournament: Tournament): Promise<Tournament> {
  const saved = { ...tournament, updatedAt: Date.now() }
  await set(saved.id, saved, tournamentStore())
  return saved
}

/** A new tournament, `scheduled`, with nothing played. */
export async function createTournament(input: NewTournament): Promise<Tournament> {
  const now = Date.now()
  const tournament: Tournament = {
    ...input,
    id: crypto.randomUUID(),
    status: 'scheduled',
    matches: [],
    progress: { done: 0, of: 0 },
    champion: null,
    createdAt: now,
    updatedAt: now,
  }
  await set(tournament.id, tournament, tournamentStore())
  return tournament
}

export async function deleteTournament(id: string): Promise<void> {
  await del(id, tournamentStore())
}

/** The key of one tournament in the query cache. */
export function tournamentKey(id: string) {
  return [...TOURNAMENTS_KEY, id] as const
}

/** The tournaments, through the query cache. The runner keeps it current (`useRunnerSync`). */
export function useTournaments() {
  return useQuery({ queryKey: TOURNAMENTS_KEY, queryFn: listTournaments, staleTime: Infinity })
}

/** One tournament, through the query cache; null when this browser has none by that id. */
export function useTournament(id: string) {
  return useQuery({
    queryKey: tournamentKey(id),
    queryFn: async () => (await getTournament(id)) ?? null,
    staleTime: Infinity,
  })
}

/** The mutations of the tournaments; each refreshes `useTournaments` and `useTournament`. */
export function useTournamentActions() {
  const client = useQueryClient()
  const onSuccess = () => client.invalidateQueries({ queryKey: TOURNAMENTS_KEY })
  return {
    create: useMutation({ mutationFn: createTournament, onSuccess }),
    remove: useMutation({ mutationFn: deleteTournament, onSuccess }),
  }
}
