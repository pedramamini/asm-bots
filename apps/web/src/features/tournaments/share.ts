/**
 * Tournament links (PRODUCT_SPEC §4): `share` copies `/tournaments/<id>#t=…`, the base64url of
 * the tournament's deflated JSON. The link carries the inputs (name, kind, config, rounds, the
 * entrants, a bracket's seeding) and every match played; the page rebuilds the rest (the bracket,
 * the standings, the progress, the champion) with `@asmbots/tourney`, so a link cannot show
 * standings its matches do not add up to. A roster bot travels as its slug. A local bot travels as
 * its machine code when that is at most `INLINE_BYTES_UP_TO` bytes (the assembler's limit, so any
 * bot that assembles), so its rounds can be watched; one that does not travels as its name only.
 *
 * `/tournaments/$id` reads the fragment when this browser has no tournament by that id. A shared
 * tournament is a snapshot: nothing runs it here, so one that was running reads as paused.
 */
import { MAX_BOT_BYTES } from '@asmbots/asm'
import { DEFAULT_CONFIG } from '@asmbots/engine'
import { fromBase64Url, toBase64Url } from '@asmbots/protocol'
import {
  advance,
  type Bracket,
  champion,
  createBracket,
  type MatchResult,
  meleeStandings,
  nextMatches,
  roundRobinSchedule,
  type Seeding,
  standingsFromMatches,
} from '@asmbots/tourney'
import type { ToastApi } from '@asmbots/ui'
import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate'
import {
  fail,
  fields,
  integer,
  list,
  NAME,
  parseConfig,
  parseMatch,
  ReplayError,
  text,
  UINT32,
} from '../arena/battle/replay'
import { assembleCached } from '../arena/setup/assembly'
import { ROUNDS } from '../arena/setup/config'
import { copyLink } from '../arena/share'
import { ENTRANT_LIMITS } from './create'
import { bracketProgress } from './runner'
import {
  TOURNAMENT_KINDS,
  type Tournament,
  type TournamentEntrant,
  type TournamentKind,
  type TournamentStatus,
} from './store'

/** The schema's name and version. */
export const TOURNAMENT_LINK_FORMAT = 'asmbots-tournament-link/1'

/** The fragment key of a tournament link. */
export const TOURNAMENT_KEY = 't'

/** The largest local bot a link carries, in bytes of machine code: the most a bot assembles to. */
export const INLINE_BYTES_UP_TO = MAX_BOT_BYTES

/** The most JSON a link may unpack to: a 32-bot round robin of 10 rounds is about 1.5 MB. */
const MAX_LINK_TEXT = 8 * 1024 * 1024

const STATUSES: readonly TournamentStatus[] = [
  'scheduled',
  'running',
  'paused',
  'finished',
  'cancelled',
  'failed',
]

/** A roster slug or a dropped file's name: one line. */
const REF = /^[^\n\r]{1,256}$/

/** An entrant as a link carries it: `bytes` is base64url machine code. */
interface LinkEntrant {
  readonly source: TournamentEntrant['source']
  readonly ref: string
  readonly name: string
  readonly bytes?: string | undefined
}

/** A tournament as a link carries it: its id is the page's. */
interface TournamentLink {
  readonly format: typeof TOURNAMENT_LINK_FORMAT
  readonly name: string
  readonly kind: TournamentKind
  readonly status: TournamentStatus
  readonly config: Tournament['config']
  readonly rounds: number
  readonly seeding?: Seeding | undefined
  readonly thirdPlace?: boolean | undefined
  readonly entrants: readonly LinkEntrant[]
  readonly matches: readonly MatchResult[]
  readonly error?: string | undefined
  readonly createdAt: number
  readonly updatedAt: number
}

/** The machine code of a local entrant a link can carry: none for one that does not assemble. */
function inlineBytes(entrant: TournamentEntrant): Uint8Array | undefined {
  if (entrant.source !== 'local') return undefined
  let bytes = entrant.bytes
  if (entrant.code !== undefined) {
    const assembled = assembleCached(entrant.code)
    bytes = assembled.diagnostics.some((d) => d.severity === 'error') ? undefined : assembled.bytes
  }
  return bytes !== undefined && bytes.length > 0 && bytes.length <= INLINE_BYTES_UP_TO
    ? bytes
    : undefined
}

/**
 * The entrants of `t` whose machine code a link cannot carry (a local bot that does not assemble,
 * a server tournament's): their rounds cannot be watched from it.
 */
export function leftOut(t: Tournament): TournamentEntrant[] {
  return t.entrants.filter((e) => e.source !== 'roster' && inlineBytes(e) === undefined)
}

/** The fragment of `t`'s link: `t=` and the base64url of its deflated JSON. */
export function tournamentFragment(t: Tournament): string {
  const link: TournamentLink = {
    format: TOURNAMENT_LINK_FORMAT,
    name: t.name,
    kind: t.kind,
    status: t.status,
    // Written out in full: the engine's defaults could change, the match keys could not.
    config: { ...DEFAULT_CONFIG, ...t.config },
    rounds: t.rounds,
    seeding: t.seeding,
    thirdPlace: t.thirdPlace,
    entrants: t.entrants.map((e) => {
      const bytes = inlineBytes(e)
      return {
        source: e.source,
        ref: e.ref,
        name: e.name,
        ...(bytes !== undefined && { bytes: toBase64Url(bytes) }),
      }
    }),
    matches: t.matches,
    error: t.error,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  }
  const json = JSON.stringify(link)
  return `${TOURNAMENT_KEY}=${toBase64Url(deflateSync(strToU8(json), { level: 9 }))}`
}

/** The link of `t`: its page, and the tournament in the fragment. */
export function tournamentUrl(origin: string, t: Tournament): string {
  return `${origin}/tournaments/${encodeURIComponent(t.id)}#${tournamentFragment(t)}`
}

/**
 * Copies `t`'s link and says so in a toast, with the local bots it leaves out. Returns the link,
 * or null when the clipboard refused it.
 */
export function copyTournamentLink(
  t: Tournament,
  toast: ToastApi['toast'],
): Promise<string | null> {
  const out = leftOut(t).map((e) => e.name)
  const note =
    out.length === 0
      ? ''
      : ` without the machine code of ${out.join(', ')}: ${out.length === 1 ? 'its' : 'their'} rounds cannot be watched from it`
  return copyLink(tournamentUrl(window.location.origin, t), toast, `link copied${note}.`)
}

/** What a tournament link's fragment holds. */
export type TournamentRead =
  | { readonly kind: 'none' }
  | { readonly kind: 'broken'; readonly reason: string }
  | { readonly kind: 'ok'; readonly tournament: Tournament }

/**
 * The tournament of a link's fragment (`#t=…`, the `#` optional), with the id `id`: none when it
 * has no `t`; broken, and why, when it does not decode or its matches do not fit its entrants.
 */
export function readTournamentFragment(fragment: string, id: string): TournamentRead {
  const payload = new URLSearchParams(fragment.replace(/^#/, '')).get(TOURNAMENT_KEY)
  if (payload === null || payload === '') return { kind: 'none' }
  try {
    let json: unknown
    try {
      // A fixed buffer: inflate never grows it, and output that fills it is too big.
      const out = inflateSync(fromBase64Url(payload), { out: new Uint8Array(MAX_LINK_TEXT) })
      if (out.length >= MAX_LINK_TEXT) fail('it unpacks to more than any tournament')
      json = JSON.parse(strFromU8(out))
    } catch (error) {
      if (error instanceof ReplayError) throw error
      fail('it does not decode, so the link may be cut short')
    }
    return { kind: 'ok', tournament: parseTournamentLink(json, id) }
  } catch (error) {
    if (error instanceof ReplayError) return { kind: 'broken', reason: error.message }
    throw error
  }
}

function oneOf<T extends string>(value: unknown, options: readonly T[], what: string): T {
  if (!options.includes(value as T)) fail(`${what} is not one of ${options.join(', ')}`)
  return value as T
}

function parseSeeding(value: unknown): Seeding {
  if (value === 'given' || value === 'rating') return value
  const s = fields(value, 'the seeding')
  return { random: integer(s.random, 'the seeding', 0, UINT32) }
}

function parseEntrant(value: unknown, i: number): TournamentEntrant {
  const what = `bot ${i + 1}`
  const e = fields(value, what)
  const source = oneOf(e.source, ['roster', 'local', 'server'] as const, `${what}'s source`)
  const ref = text(e.ref, `${what}'s id`, REF)
  const name = text(e.name, `${what}'s name`, NAME)
  if (e.bytes === undefined || source === 'roster') return { source, ref, name }
  let bytes: Uint8Array
  try {
    bytes = fromBase64Url(text(e.bytes, `${name}'s bytes`))
  } catch {
    fail(`${name}'s bytes are not base64url`)
  }
  if (bytes.length === 0 || bytes.length > INLINE_BYTES_UP_TO) {
    fail(`${name}'s bytes must be 1..${INLINE_BYTES_UP_TO}`)
  }
  return { source, ref, name, bytes }
}

function drawBracket(names: readonly string[], seeding: Seeding, thirdPlace: boolean): Bracket {
  try {
    return createBracket(
      names.map((name) => ({ name })),
      { seeding, thirdPlace },
    )
  } catch (error) {
    fail(`its bracket cannot be drawn: ${(error as Error).message}`)
  }
}

/** `result` as the match of `entrants`: its names are theirs, in order. */
function checkNames(result: MatchResult, names: readonly string[], what: string): void {
  if (result.names.some((name, j) => name !== names[j])) fail(`${what} is not of its bots`)
}

/**
 * `value` as a tournament, `id` its id, or a `ReplayError` that says what is wrong. The derived
 * state is rebuilt from the matches as the runner builds it: a round robin's matches follow its
 * schedule, a bracket's are played in id order, a melee's one match may be partial.
 */
export function parseTournamentLink(value: unknown, id: string): Tournament {
  const r = fields(value, 'the tournament')
  if (r.format !== TOURNAMENT_LINK_FORMAT) {
    fail(`it is not a tournament of format ${TOURNAMENT_LINK_FORMAT}`)
  }
  const name = text(r.name, 'its name', NAME)
  const kind = oneOf(r.kind, TOURNAMENT_KINDS, 'its kind')
  const shared = oneOf(r.status, STATUSES, 'its status')
  const config = parseConfig(r.config)
  const rounds = integer(r.rounds, 'rounds', ROUNDS.min, ROUNDS.max)
  const entrants = list(r.entrants, 'the bots').map(parseEntrant)
  const { min, max } = ENTRANT_LIMITS[kind]
  if (entrants.length < min || entrants.length > max) {
    fail(`it has ${entrants.length} bots, and a ${kind} has ${min} to ${max}`)
  }
  const names = entrants.map((e) => e.name)
  const played = list(r.matches, 'the matches')
  const error = r.error === undefined ? undefined : text(r.error, 'its error')
  const base = {
    id,
    name,
    kind,
    entrants,
    config,
    rounds,
    // Nothing runs a shared tournament here.
    status: shared === 'running' ? ('paused' as const) : shared,
    error,
    createdAt: integer(r.createdAt, 'its date', 0, Number.MAX_SAFE_INTEGER),
    updatedAt: integer(r.updatedAt, 'its date', 0, Number.MAX_SAFE_INTEGER),
  }

  switch (kind) {
    case 'round-robin': {
      const schedule = roundRobinSchedule(entrants.length)
      if (played.length > schedule.length) fail(`it has more matches than its ${schedule.length}`)
      const matches = played.map((m, i) => {
        const spec = schedule[i] as (typeof schedule)[number]
        const result = parseMatch(m, 2, rounds)
        checkNames(
          result,
          spec.entrants.map((e) => names[e] as string),
          `match ${i + 1}`,
        )
        return result
      })
      const standings = standingsFromMatches(
        names,
        matches.map((result, i) => ({
          entrants: (schedule[i] as (typeof schedule)[number]).entrants,
          result,
        })),
      )
      const done = matches.length === schedule.length
      return {
        ...base,
        matches,
        standings: matches.length === 0 ? undefined : standings,
        progress: { done: matches.length, of: schedule.length },
        champion: done ? (standings[0]?.entrant ?? null) : null,
      }
    }
    case 'bracket': {
      const seeding = r.seeding === undefined ? 'given' : parseSeeding(r.seeding)
      const thirdPlace = r.thirdPlace === true
      // As the runner draws it: a third-place match from 3 bots, where a bye may leave it empty.
      let bracket = drawBracket(names, seeding, thirdPlace && entrants.length >= 3)
      const matches: MatchResult[] = []
      for (const [i, m] of played.entries()) {
        const next = nextMatches(bracket)[0]
        if (next === undefined) fail('it has more matches than its bracket')
        const result = parseMatch(m, 2, rounds)
        const pair = next.slots.map((s) => names[s.entrant as number] as string)
        checkNames(result, pair, `match ${i + 1}`)
        bracket = advance(bracket, next.id, result)
        matches.push(result)
      }
      const drawn = shared !== 'scheduled' || matches.length > 0
      return {
        ...base,
        seeding,
        thirdPlace,
        bracket: drawn ? bracket : undefined,
        matches,
        progress: drawn ? bracketProgress(bracket) : { done: 0, of: 0 },
        champion: champion(bracket),
      }
    }
    case 'melee': {
      if (played.length > 1) fail('a melee has one match')
      const matches = played.map((m) => parseMatch(m, entrants.length, rounds, true))
      const match = matches[0]
      if (match !== undefined) checkNames(match, names, 'the melee')
      const standings = match === undefined ? undefined : meleeStandings(match, config)
      const done = match !== undefined && match.rounds.length === rounds
      return {
        ...base,
        matches,
        standings,
        progress: { done: match?.rounds.length ?? 0, of: rounds },
        champion: done ? (standings?.[0]?.entrant ?? null) : null,
      }
    }
  }
}
