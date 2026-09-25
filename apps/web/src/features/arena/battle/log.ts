/**
 * The battle's story as the rail tells it (PRODUCT_SPEC §2): the events log (spawns, deaths, first
 * blood, bot deaths, round ends), how each bot died, and each bot's process count over the last
 * frames for its sparkline. It reads the Worker's messages as they come, so it keeps what the
 * store's latest frame forgets.
 *
 * The log is a timeline of the round, not a list of frames: each cycle's events go in once. A seek
 * back replays cycles already logged, and those add nothing; a seek ahead skips cycles, and of
 * those only the bots' deaths and the first blood come in, from the full frame. A new round starts
 * the log over.
 */
import { type DeathReason, SPAWN_RECORD } from '@asmbots/engine'
import { hexAddress } from '@asmbots/ui'
import type { ArenaClient } from '../worker/client'
import {
  BOT_DEATH_FIELDS,
  botResults,
  DEATH_FIELDS,
  deathReason,
  type EndedMessage,
  type FrameMessage,
  type LoadedMessage,
  STAT_FIELDS,
  STAT_PROCS,
} from '../worker/protocol'
import type { EventFilter } from './view'

/** The frames of process counts a bot's sparkline shows (PRODUCT_SPEC §2). */
export const HISTORY = 120

/** The spawns and process deaths the log keeps: the newest. It keeps every bot's fate. */
export const MAX_MINOR = 1000

/** A line of the log, from the round's start to its end. */
export type LogKind = 'round' | 'spawn' | 'death' | 'blood' | 'dead' | 'end'

export interface LogEvent {
  /** Unique, in the order the log took it. */
  readonly id: number
  readonly cycle: number
  readonly kind: LogKind
  /** The bot the line is about, whose hue it shows; null for the round's own lines. */
  readonly bot: number | null
  /** A spawn's child address, or the address a process died at. */
  readonly address?: number | undefined
  /** Why a process or a bot died. */
  readonly reason?: DeathReason | undefined
  /** The owner tag of the byte that killed (`DEATH_KILLER`): of a death, or of first blood. */
  readonly killer?: number | undefined
  /** A round's start or end: the round, from 0. */
  readonly round?: number | undefined
  /** A round's start: its seed. */
  readonly seed?: number | undefined
  /** A round's end: the bots standing. */
  readonly standing?: readonly number[] | undefined
}

/** How a bot died: when, why, and whose byte its last process ran. */
export interface BotDeath {
  readonly cycle: number
  readonly reason: DeathReason
  /** 0: nobody's, the core as it started; the bot's own tag; or its killer's tag. */
  readonly killer: number
}

/** A death reason in the log's words. */
export function reasonText(reason: DeathReason): string {
  switch (reason) {
    case 'undefined':
      return 'bad opcode'
    case 'div':
      return 'divide error'
    default:
      return reason
  }
}

/** Whose byte killed a process of `bot`: `by Dwarf`, `self`, or `empty core`. */
export function killerText(killer: number, bot: number, names: readonly string[]): string {
  if (killer === 0) return 'empty core'
  if (killer === bot + 1) return 'self'
  return `by ${nameOf(names, killer - 1)}`
}

function nameOf(names: readonly string[], bot: number): string {
  return names[bot] ?? `bot ${bot + 1}`
}

/** A log line's words (DESIGN_SYSTEM §9: terse, technical). */
export function describe(event: LogEvent, names: readonly string[], rounds: number): string {
  const name = event.bot === null ? '' : nameOf(names, event.bot)
  const bot = event.bot ?? 0
  const round = (event.round ?? 0) + 1
  switch (event.kind) {
    case 'round':
      return rounds > 1 ? `round ${round} of ${rounds} · seed ${event.seed}` : `seed ${event.seed}`
    case 'spawn':
      return `${name} split → ${hexAddress(event.address ?? 0)}`
    case 'death':
      return `${name} died @ ${hexAddress(event.address ?? 0)} · ${reasonText(
        event.reason ?? 'undefined',
      )} · ${killerText(event.killer ?? 0, bot, names)}`
    case 'dead':
      return `${name} dead · ${reasonText(event.reason ?? 'undefined')} · ${killerText(
        event.killer ?? 0,
        bot,
        names,
      )}`
    case 'blood':
      return `first blood · ${nameOf(names, (event.killer ?? 1) - 1)} → ${name}`
    case 'end': {
      const standing = event.standing ?? []
      const over = rounds > 1 ? `round ${round} over` : 'battle over'
      if (standing.length === 1) return `${over} · ${nameOf(names, standing[0] as number)} wins`
      if (standing.length === 0) return `${over} · no survivors`
      return `${over} · draw, ${standing.length} standing`
    }
  }
}

/**
 * The log of the battle a client drives. `attach` it to the client before the first load, so no
 * message goes by unread.
 */
export class BattleLog {
  /** The bots' names, in the load's order. */
  names: readonly string[] = []
  /** The round, from 0, and the rounds in the match. */
  round = 0
  rounds = 1
  /** Per bot: its process counts over the last `HISTORY` frames, oldest first. */
  history: number[][] = []
  /** Per bot: how it died, as of the last frame; null while it lives. */
  deaths: (BotDeath | null)[] = []
  /** Bumped at each change. */
  version = 0
  /** Round starts and ends, first blood, and bot deaths, in cycle order. */
  private major: LogEvent[] = []
  /** Spawns and process deaths, in cycle order: the newest `MAX_MINOR`, and a few more. */
  private minor: LogEvent[] = []
  /** The round's order, to read an engine result. */
  private order: readonly number[] = []
  /** Every cycle before this one has had its events logged. */
  private loggedUntil = 0
  private bloodLogged = false
  private endLogged = false
  private nextId = 1
  private readonly listeners = new Set<() => void>()

  /** Reads `client`'s messages from now on. Returns what stops it. */
  attach(client: Pick<ArenaClient, 'on'>): () => void {
    const offs = [
      client.on('loaded', (message) => this.loaded(message)),
      client.on('frame', (frame) => this.frame(frame)),
      client.on('ended', (message) => this.ended(message)),
    ]
    return () => {
      for (const off of offs) off()
    }
  }

  /** Calls `listener` after each change. Returns what stops it. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** The lines `filter` keeps, newest first. */
  events(filter: EventFilter): LogEvent[] {
    const minor =
      filter === 'bots'
        ? []
        : this.minor.slice(-MAX_MINOR).filter((event) => filter === 'all' || event.kind !== 'spawn')
    const out: LogEvent[] = []
    let i = this.major.length - 1
    let j = minor.length - 1
    while (i >= 0 || j >= 0) {
      const a = this.major[i]
      const b = minor[j]
      if (b === undefined || (a !== undefined && later(a, b))) {
        out.push(a as LogEvent)
        i--
      } else {
        out.push(b)
        j--
      }
    }
    return out
  }

  /** The round's first blood, once a process has died of another bot's byte; null before. */
  firstBlood(): LogEvent | null {
    return this.major.find((event) => event.kind === 'blood') ?? null
  }

  /** Each bot death the round has logged, the earliest first: the scrub bar's marks. */
  botDeathMarks(): { bot: number; cycle: number }[] {
    return this.major.flatMap((event) =>
      event.kind === 'dead' && event.bot !== null ? [{ bot: event.bot, cycle: event.cycle }] : [],
    )
  }

  /** A round starts: the log starts over with it. */
  loaded(message: LoadedMessage): void {
    this.names = message.botMeta.map((bot) => bot.name)
    this.round = message.round
    this.rounds = message.rounds
    this.order = message.order
    this.history = this.names.map(() => [])
    this.deaths = this.names.map(() => null)
    this.major = []
    this.minor = []
    this.loggedUntil = 0
    this.bloodLogged = false
    this.endLogged = false
    this.add(this.major, {
      cycle: 0,
      kind: 'round',
      bot: null,
      round: message.round,
      seed: message.config.seed,
    })
    this.changed()
  }

  frame(frame: FrameMessage): void {
    this.sample(frame.stats)
    const from = this.loggedUntil
    if (frame.ownerDirty !== null) {
      // A full frame: the bots dead by its cycle, and nothing of what happened before it.
      this.deaths = this.names.map(() => null)
      this.readBotDeaths(frame.botDeaths, frame.cycle > from ? from : Number.POSITIVE_INFINITY)
    } else {
      this.readMinor(frame, from)
      this.readBotDeaths(frame.botDeaths, from)
    }
    const blood = frame.firstBlood
    if (blood !== null && !this.bloodLogged) {
      this.bloodLogged = true
      this.add(this.major, {
        cycle: blood.cycle,
        kind: 'blood',
        bot: blood.victim,
        killer: blood.killer + 1,
      })
      this.major.sort(byCycle)
    }
    this.loggedUntil = Math.max(from, frame.cycle)
    this.changed()
  }

  ended(message: EndedMessage): void {
    if (this.endLogged) return
    this.endLogged = true
    const results = botResults(message.result, this.order)
    const standing = results.flatMap((bot, index) => (bot.alive ? [index] : []))
    this.add(this.major, {
      cycle: message.result.cycles,
      kind: 'end',
      bot: null,
      round: message.round,
      standing,
    })
    this.changed()
  }

  private sample(stats: Float32Array): void {
    this.history.forEach((series, bot) => {
      series.push(stats[bot * STAT_FIELDS + STAT_PROCS] ?? 0)
      if (series.length > HISTORY) series.shift()
    })
  }

  /** The frame's spawns and process deaths from cycle `from` on: the newest `MAX_MINOR`. */
  private readMinor(frame: FrameMessage, from: number): void {
    const fresh: LogEvent[] = []
    const { spawns, deaths } = frame
    for (
      let o = Math.max(0, spawns.length - MAX_MINOR * SPAWN_RECORD);
      o < spawns.length;
      o += SPAWN_RECORD
    ) {
      const cycle = spawns[o] as number
      if (cycle < from) continue
      fresh.push(
        this.event({
          cycle,
          kind: 'spawn',
          bot: spawns[o + 1] as number,
          address: spawns[o + 3] as number,
        }),
      )
    }
    for (
      let o = Math.max(0, deaths.length - MAX_MINOR * DEATH_FIELDS);
      o < deaths.length;
      o += DEATH_FIELDS
    ) {
      const cycle = deaths[o] as number
      if (cycle < from) continue
      fresh.push(
        this.event({
          cycle,
          kind: 'death',
          bot: deaths[o + 1] as number,
          address: deaths[o + 3] as number,
          reason: deathReason(deaths[o + 4] as number),
          killer: deaths[o + 5] as number,
        }),
      )
    }
    if (fresh.length === 0) return
    fresh.sort(byCycle)
    this.minor.push(...fresh.slice(-MAX_MINOR))
    if (this.minor.length > 2 * MAX_MINOR) this.minor = this.minor.slice(-MAX_MINOR)
  }

  /** Sets each bot death of `records`, and logs those from cycle `from` on. */
  private readBotDeaths(records: Uint32Array, from: number): void {
    for (let o = 0; o < records.length; o += BOT_DEATH_FIELDS) {
      const cycle = records[o] as number
      const bot = records[o + 1] as number
      const death: BotDeath = {
        cycle,
        reason: deathReason(records[o + 2] as number),
        killer: records[o + 3] as number,
      }
      this.deaths[bot] = death
      if (cycle >= from) this.add(this.major, { ...death, kind: 'dead', bot })
    }
  }

  private event(parts: Omit<LogEvent, 'id'>): LogEvent {
    return { id: this.nextId++, ...parts }
  }

  private add(list: LogEvent[], parts: Omit<LogEvent, 'id'>): void {
    list.push(this.event(parts))
  }

  private changed(): void {
    this.version++
    for (const listener of this.listeners) listener()
  }
}

/** Whether `a` comes after `b` in the round: a later cycle, or the same cycle logged later. */
function later(a: LogEvent, b: LogEvent): boolean {
  return a.cycle !== b.cycle ? a.cycle > b.cycle : a.id > b.id
}

function byCycle(a: LogEvent, b: LogEvent): number {
  return a.cycle - b.cycle || a.id - b.id
}
