/**
 * Server tournaments (ARCHITECTURE §7) in the local tournaments' views: a `TournamentDetail` from
 * the API as the `Tournament` record the bracket, round robin, and melee views draw. The server's
 * `Runner` plays them; the page only reads them. Their entrants are bot versions, whose bytes come
 * with each match's replay (`replays`), so watching a round loads its replay.
 */
import type {
  BotLabel,
  Match,
  TournamentSummary as ServerSummary,
  Tournament as ServerTournament,
  TournamentDetail,
} from '@asmbots/protocol'
import {
  type Bracket,
  champion as bracketChampion,
  type MatchResult,
  meleeStandings,
  plannedMatches,
  roundRobinSchedule,
  standingsFromMatches,
} from '@asmbots/tourney'
import { bracketProgress } from './runner'
import type { Tournament, TournamentEntrant, TournamentKind, TournamentStatus } from './store'

/** A server kind as the local views name it. */
export const SERVER_KIND: Readonly<Record<ServerTournament['kind'], TournamentKind>> = {
  roundrobin: 'round-robin',
  bracket: 'bracket',
  melee: 'melee',
}

/** A server status as the local views name it: a draft is not started, as a scheduled one. */
export const SERVER_STATUS: Readonly<Record<ServerTournament['status'], TournamentStatus>> = {
  draft: 'scheduled',
  scheduled: 'scheduled',
  running: 'running',
  finished: 'finished',
  cancelled: 'cancelled',
}

/**
 * The entrants' names, one each: a bot's name, and its owner's handle after it when another
 * entrant has the same name (`Dwarf (alice)`, `Dwarf (bob)`).
 */
export function entrantNames(labels: readonly BotLabel[]): string[] {
  const seen = new Map<string, number>()
  for (const label of labels) seen.set(label.name, (seen.get(label.name) ?? 0) + 1)
  return labels.map((label) =>
    (seen.get(label.name) ?? 0) > 1 ? `${label.name} (${label.owner})` : label.name,
  )
}

/** `match` as the tourney has a played match, its bots named as `nameOf` names their versions. */
function matchResult(match: Match, nameOf: (versionId: string) => string): MatchResult | null {
  const { result } = match
  if (result === null) return null
  return {
    key: match.key ?? match.id,
    names: match.participants.map(nameOf),
    of: match.rounds,
    rounds: result.rounds ?? [],
    points: result.points,
  }
}

/** The spec id of a job's match: the tail of its id, `<tournament id>-<n>`; null when it is not. */
function specOf(tournamentId: string, match: Match): number | null {
  const tail = match.id.startsWith(`${tournamentId}-`)
    ? match.id.slice(tournamentId.length + 1)
    : ''
  return /^\d+$/.test(tail) ? Number(tail) : null
}

/**
 * `detail` as a local record: its kind and status, its entrants in the order its matches index,
 * a round robin's matches in schedule order (up to the first not played), a bracket's in the order
 * played, a melee's one match; the standings, the progress, and the champion they make, and the
 * replays of its matches by key.
 */
export function fromServer({ tournament: t, entrants, matches }: TournamentDetail): Tournament {
  const kind = SERVER_KIND[t.kind]
  const names = entrantNames(entrants)
  const byVersion = new Map(entrants.map((label, e) => [label.versionId, e]))
  const nameOf = (versionId: string) => names[byVersion.get(versionId) ?? -1] ?? versionId
  const played = matches.flatMap((m) => {
    const result = matchResult(m, nameOf)
    return result === null ? [] : [{ match: m, result }]
  })
  const config = { ...t.config.battle, seed: t.config.seed }
  const n = entrants.length
  let results: MatchResult[]
  let bracket: Bracket | undefined
  let standings: Tournament['standings']
  if (kind === 'round-robin') {
    const bySpec = new Map(played.map((p) => [specOf(t.id, p.match), p.result]))
    results = []
    for (let i = 0; bySpec.has(i); i++) results.push(bySpec.get(i) as MatchResult)
    const schedule = n < 2 ? [] : roundRobinSchedule(n)
    standings =
      results.length === 0
        ? undefined
        : standingsFromMatches(
            names,
            results.map((result, i) => ({ entrants: schedule[i]?.entrants ?? [], result })),
          )
  } else if (kind === 'melee') {
    results = played.slice(0, 1).map((p) => p.result)
    standings = results[0] === undefined ? undefined : meleeStandings(results[0], config)
  } else {
    results = played.map((p) => p.result)
    bracket = t.bracket === null ? undefined : { ...(t.bracket as Bracket), names }
  }
  const progress =
    bracket !== undefined && t.status === 'running'
      ? bracketProgress(bracket)
      : {
          done: results.length,
          of: Math.max(results.length, plannedMatches(t.kind, n, t.config.thirdPlace ?? false)),
        }
  const winner =
    t.championId === null
      ? bracket === undefined
        ? null
        : bracketChampion(bracket)
      : (byVersion.get(t.championId) ?? null)
  const replays: Record<string, string> = {}
  for (const { match, result } of played) {
    if (match.replayKey !== null) replays[result.key] = match.replayKey
  }
  return {
    id: t.id,
    name: t.name,
    kind,
    entrants: entrants.map(
      (label, e): TournamentEntrant => ({
        source: 'server',
        ref: label.versionId,
        name: names[e] as string,
      }),
    ),
    config,
    rounds: t.config.rounds,
    status: SERVER_STATUS[t.status],
    seeding: t.config.seeding,
    thirdPlace: t.config.thirdPlace,
    bracket,
    standings,
    matches: results,
    progress,
    champion: t.status === 'finished' ? winner : null,
    createdAt: Date.parse(t.createdAt),
    updatedAt: Date.parse(t.finishedAt ?? t.startsAt ?? t.createdAt),
    replays,
  }
}

/** A server tournament's card: what the list shows of a `TournamentSummary`. */
export interface ServerCard {
  readonly summary: ServerSummary
  readonly kind: TournamentKind
  readonly status: TournamentStatus
}

/** `summary` as the list's card reads it. */
export function serverCard(summary: ServerSummary): ServerCard {
  return {
    summary,
    kind: SERVER_KIND[summary.tournament.kind],
    status: SERVER_STATUS[summary.tournament.status],
  }
}
