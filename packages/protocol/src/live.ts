/**
 * `LiveRoom` messages (ARCHITECTURE §7): one Durable Object per hill or tournament fans them out
 * over WebSocket. They carry inputs and outcomes only; spectators simulate a match themselves.
 */
import * as z from 'zod/mini'
import { JobStatus } from './jobs'
import { Match } from './models'
import { Seed } from './replay'
import { Id, parse, Timestamp, whole } from './schema'

/** This protocol's version: a client that speaks another reloads. */
export const LIVE_PROTOCOL = 1

/** What a room is of. */
export const LiveRoomRef = z.object({ kind: z.enum(['hill', 'tournament']), id: Id })
export type LiveRoomRef = z.output<typeof LiveRoomRef>

/** A room's name, and so its `LiveRoom`'s: `hill:<hill id>` or `tournament:<tournament id>`. */
export function liveRoomName(ref: LiveRoomRef): string {
  return `${ref.kind}:${ref.id}`
}

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

/** A match began: its inputs, so a spectator can run it alongside. */
export const MatchStarted = z.object({
  type: z.literal('matchStarted'),
  match: z.object({
    id: Id,
    participants: z.array(Id).check(z.minLength(2)),
    rounds: whole('rounds', 1, 100),
    seed: Seed,
  }),
})

export const MatchFinished = z.object({ type: z.literal('matchFinished'), match: Match })

export const Standings = z.object({ type: z.literal('standings'), entries: z.array(Standing) })

/**
 * How far a `Runner` job is: `done` of the `of` matches it knows of ("fighting 24 of 32"). A hill
 * job can learn of more when an entry joins the hill while it runs.
 */
export const Progress = z.object({
  type: z.literal('progress'),
  job: z.string().check(z.minLength(1), z.maxLength(128)),
  status: JobStatus,
  done: whole('done', 0, Number.MAX_SAFE_INTEGER),
  of: whole('of', 0, Number.MAX_SAFE_INTEGER),
})

/** Either side's keepalive; `t` is the sender's clock, ms, echoed back. */
export const Ping = z.object({ type: z.literal('ping'), t: z.number() })

export const LiveMessage = z.discriminatedUnion('type', [
  Hello,
  MatchStarted,
  MatchFinished,
  Standings,
  Progress,
  Ping,
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
