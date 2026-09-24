/**
 * The rules of the new tournament form (PRODUCT_SPEC §4): how many bots each kind takes, how many
 * matches a tournament plays and how long they may take, and the record `createTournament` gets.
 */
import { MAX_BRACKET_ENTRANTS, MAX_MELEE_ENTRANTS, roundRobinSchedule } from '@asmbots/tourney'
import type { ArenaConfig } from '../../store/settings'
import { fightSeed } from '../arena/setup/bots'
import { battleConfig, randomSeed } from '../arena/setup/config'
import {
  KIND_LABELS,
  type NewTournament,
  type TournamentEntrant,
  type TournamentKind,
} from './store'

/** The fewest and the most bots of each kind. */
export const ENTRANT_LIMITS: Readonly<Record<TournamentKind, { min: number; max: number }>> = {
  'round-robin': { min: 2, max: 32 },
  bracket: { min: 3, max: MAX_BRACKET_ENTRANTS },
  melee: { min: 2, max: MAX_MELEE_ENTRANTS },
}

/** Above this many bots, a round robin warns about its match count: n bots play n(n-1)/2. */
export const ROUND_ROBIN_WARN_ABOVE = 12

/**
 * Instructions per second the estimate takes for the arena Worker: well under the engine's bench
 * in Bun (about 55 M), since a browser tab shares its CPU. A cycle runs one instruction per bot.
 */
export const INSTRUCTIONS_PER_SECOND = 20_000_000

/** What a tournament of this shape plays. */
export interface Plan {
  readonly kind: TournamentKind
  readonly entrants: number
  readonly rounds: number
  readonly maxCycles: number
  /** A bracket's third-place match. */
  readonly thirdPlace: boolean
}

/** Whether a bracket of `entrants` bots plays its third-place match: it needs two semifinal losers. */
export function playsThirdPlace(entrants: number, thirdPlace: boolean): boolean {
  return thirdPlace && entrants >= 4
}

/**
 * The matches a tournament plays: every pair of a round robin; one fewer than the bots of a
 * bracket (a bye plays nothing), and its third-place match; a melee is one match.
 */
export function matchCount({ kind, entrants, thirdPlace }: Plan): number {
  switch (kind) {
    case 'round-robin':
      return entrants < 2 ? 0 : roundRobinSchedule(entrants).length
    case 'bracket':
      return entrants < 2 ? 0 : entrants - 1 + (playsThirdPlace(entrants, thirdPlace) ? 1 : 0)
    case 'melee':
      return entrants < 2 ? 0 : 1
  }
}

/** Seconds the tournament takes at most at max speed: every round runs to its last cycle. */
export function estimateSeconds(plan: Plan): number {
  const perMatch = plan.kind === 'melee' ? plan.entrants : 2
  const instructions = matchCount(plan) * plan.rounds * plan.maxCycles * perMatch
  return instructions / INSTRUCTIONS_PER_SECOND
}

/** `~40 s`, `~2 min`, `~1.5 h`. */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `~${Math.max(1, Math.ceil(seconds))} s`
  if (seconds < 3600) return `~${Math.round(seconds / 60)} min`
  return `~${(seconds / 3600).toFixed(1)} h`
}

/** What the form says of the entrants: why it cannot start, a warning, and the plan's size. */
export interface PlanCheck {
  /** Why the tournament cannot be made: too few or too many bots. */
  readonly error: string | null
  /** A round robin of many bots: its match count grows as the square. */
  readonly warning: string | null
  /** `66 matches · ~2 min at max speed`. */
  readonly summary: string
}

export function checkPlan(plan: Plan): PlanCheck {
  const { min, max } = ENTRANT_LIMITS[plan.kind]
  const n = plan.entrants
  const bots = (k: number) => `${k} ${k === 1 ? 'bot' : 'bots'}`
  const error =
    n < min || n > max
      ? `a ${KIND_LABELS[plan.kind]} takes ${min}..${max} bots: ${bots(n)} picked`
      : null
  const warning =
    error === null && plan.kind === 'round-robin' && n > ROUND_ROBIN_WARN_ABOVE
      ? `${bots(n)} play every pair: the matches grow as the square of the bots.`
      : null
  const matches = matchCount(plan)
  const played =
    plan.kind === 'melee'
      ? `1 melee · ${plan.rounds} ${plan.rounds === 1 ? 'round' : 'rounds'}`
      : `${matches} ${matches === 1 ? 'match' : 'matches'}`
  const summary = `${played} · ${formatDuration(estimateSeconds(plan))} at max speed`
  return { error, warning, summary }
}

/** `names`, each made unique: the second `Dwarf` is `Dwarf 2`. */
export function uniqueNames(names: readonly string[]): string[] {
  const taken = new Map<string, number>()
  return names.map((name) => {
    const seen = (taken.get(name) ?? 0) + 1
    taken.set(name, seen)
    return seen === 1 ? name : `${name} ${seen}`
  })
}

/** A bot the form picked: its entrant, before its name is made unique, and its image size. */
export interface PickedEntrant {
  readonly source: TournamentEntrant['source']
  readonly ref: string
  readonly name: string
  readonly code?: string | undefined
  readonly size: number
}

/** What the form holds when `create` is pressed. */
export interface TournamentDraft {
  readonly name: string
  readonly kind: TournamentKind
  readonly entrants: readonly PickedEntrant[]
  readonly config: ArenaConfig
  readonly thirdPlace: boolean
  /** A bracket's seeds: in the order picked, or shuffled. */
  readonly seeding: 'given' | 'random'
}

/** The name a draft with none gets: `bracket · 5 bots`. */
export function defaultName(kind: TournamentKind, entrants: number): string {
  return `${KIND_LABELS[kind]} · ${entrants} ${entrants === 1 ? 'bot' : 'bots'}`
}

/**
 * The record of `draft`, or null when its bots do not place in the core: a melee's all at once,
 * the two largest in the others. The seed is the config's, or a random one they place with.
 */
export function tournamentInput(
  draft: TournamentDraft,
  random: () => number = randomSeed,
): NewTournament | null {
  const { kind, config } = draft
  const sizes = draft.entrants.map((e) => e.size)
  const placed = kind === 'melee' ? sizes : [...sizes].sort((a, b) => b - a).slice(0, 2)
  const seed = fightSeed(placed, config.minSpacing, config.seed, random, config.rounds)
  if (seed === null) return null
  const names = uniqueNames(draft.entrants.map((e) => e.name))
  const entrants = draft.entrants.map(
    ({ source, ref, code }, i): TournamentEntrant => ({
      source,
      ref,
      name: names[i] as string,
      ...(code === undefined ? {} : { code }),
    }),
  )
  const name = draft.name.trim() || defaultName(kind, entrants.length)
  const base = { name, kind, entrants, config: battleConfig(config, seed), rounds: config.rounds }
  if (kind !== 'bracket') return base
  return {
    ...base,
    seeding: draft.seeding === 'random' ? { random: random() } : 'given',
    thirdPlace: playsThirdPlace(entrants.length, draft.thirdPlace),
  }
}
