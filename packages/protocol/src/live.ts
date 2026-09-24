/**
 * `LiveRoom` messages (ARCHITECTURE §7): one Durable Object per hill or tournament fans them out
 * over WebSocket. They carry inputs and outcomes only; spectators simulate a match themselves.
 *
 * A socket opens with `hello`, then `spectators`, then the room's last events (`LiveEvent`s,
 * oldest first), then each event as it happens and `spectators` when the count changes. A
 * spectator sends `LIVE_PING` now and then, and the room answers `LIVE_PONG`: nothing else.
 */
import * as z from 'zod/mini'
import { JobStatus } from './jobs'
import { Match } from './models'
import {
  MAX_REPLAY_BOTS,
  MAX_REPLAY_ROUNDS,
  MIN_REPLAY_BOTS,
  ReplayBot,
  ReplayConfig,
  Seed,
} from './replay'
import { HASH64, Id, matching, parse, Timestamp, whole } from './schema'

/** This protocol's version: a client that speaks another reloads. */
export const LIVE_PROTOCOL = 1

/** What a room is of. */
export const LiveRoomRef = z.object({ kind: z.enum(['hill', 'tournament']), id: Id })
export type LiveRoomRef = z.output<typeof LiveRoomRef>

/** A room's name, and so its `LiveRoom`'s: `hill:<hill id>` or `tournament:<tournament id>`. */
export function liveRoomName(ref: LiveRoomRef): string {
  return `${ref.kind}:${ref.id}`
}

/** The room `name` names (`liveRoomName`), or a `ProtocolError`. */
export function parseLiveRoomName(name: string): LiveRoomRef {
  const colon = name.indexOf(':')
  const ref = colon < 0 ? undefined : { kind: name.slice(0, colon), id: name.slice(colon + 1) }
  return parse(LiveRoomRef, ref, 'the room')
}

/** A `Runner` job's id (`runnerJobId`): `hill:<slug>:<submission id>`, `tournament:<id>`. */
const JobName = z.string().check(z.minLength(1), z.maxLength(128))

/** A place in the room's standings. */
export const Standing = z.object({
  botVersionId: Id,
  rank: whole('rank', 1, Number.MAX_SAFE_INTEGER),
  score: z.number(),
  wins: whole('wins', 0, Number.MAX_SAFE_INTEGER),
  ties: whole('ties', 0, Number.MAX_SAFE_INTEGER),
  losses: whole('losses', 0, Number.MAX_SAFE_INTEGER),
})
export type Standing = z.output<typeof Standing>

/** The first message on a socket: the room, and the version of this protocol it speaks. */
export const Hello = z.object({
  type: z.literal('hello'),
  protocol: z.literal(LIVE_PROTOCOL),
  room: LiveRoomRef,
  now: Timestamp,
})

/**
 * The inputs of a match a `Runner` has begun: what a spectator loads to run it alongside, and what
 * `GET /api/matches/:id/verify` answers for a published one. `bots` are the entrants in order
 * (`participants` names their bot versions), each with its name in the match, its bytes, and
 * their SHA-256; `key` is the match's `matchHash` (`@asmbots/tourney`).
 */
export const LiveMatch = z
  .object({
    id: Id,
    key: matching(HASH64),
    participants: z.array(Id).check(z.minLength(MIN_REPLAY_BOTS), z.maxLength(MAX_REPLAY_BOTS)),
    rounds: whole('rounds', 1, MAX_REPLAY_ROUNDS),
    /** The match seed: round i is placed with `seed + i`, mod 2^32. */
    seed: Seed,
    config: ReplayConfig,
    bots: z.array(ReplayBot),
  })
  .check(
    z.refine(
      (match) => match.bots.length === match.participants.length,
      'a live match names as many bots as participants',
    ),
  )
export type LiveMatch = z.output<typeof LiveMatch>

/** A match began: its inputs, so a spectator can run it alongside. */
export const MatchStarted = z.object({
  type: z.literal('matchStarted'),
  job: JobName,
  match: LiveMatch,
})

/** A match ended: the row the server stored, its result hash with each round's. */
export const MatchFinished = z.object({
  type: z.literal('matchFinished'),
  job: JobName,
  match: Match,
})

export const Standings = z.object({ type: z.literal('standings'), entries: z.array(Standing) })

/**
 * How far a `Runner` job is: `done` of the `of` matches it knows of ("fighting 24 of 32"). A hill
 * job can learn of more when an entry joins the hill while it runs.
 */
export const Progress = z.object({
  type: z.literal('progress'),
  job: JobName,
  status: JobStatus,
  done: whole('done', 0, Number.MAX_SAFE_INTEGER),
  of: whole('of', 0, Number.MAX_SAFE_INTEGER),
})

/** The sockets open on the room, the reader's own among them. */
export const Spectators = z.object({
  type: z.literal('spectators'),
  count: whole('count', 0, Number.MAX_SAFE_INTEGER),
})

/**
 * A spectator's keepalive, and the room's answer. The room answers without waking (the WebSocket
 * hibernation API's auto-response), so each is sent as exactly `LIVE_PING` and `LIVE_PONG`.
 */
export const Ping = z.object({ type: z.literal('ping') })
export const Pong = z.object({ type: z.literal('pong') })
export const LIVE_PING = '{"type":"ping"}'
export const LIVE_PONG = '{"type":"pong"}'

/** What happens in a room: what a `Runner` publishes, and what a room keeps for late joiners. */
export const LiveEvent = z.discriminatedUnion('type', [
  MatchStarted,
  MatchFinished,
  Standings,
  Progress,
])
export type LiveEvent = z.output<typeof LiveEvent>

export const LiveMessage = z.discriminatedUnion('type', [
  Hello,
  MatchStarted,
  MatchFinished,
  Standings,
  Progress,
  Spectators,
  Ping,
  Pong,
])
export type LiveMessage = z.output<typeof LiveMessage>

/** A socket's text as a message, or a `ProtocolError`. */
export function parseLiveMessage(text: string): LiveMessage {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    value = undefined
  }
  return parse(LiveMessage, value, 'the message')
}
