/**
 * The weekly championship (PRODUCT_SPEC §1, §4): an open bracket of up to 32 bots, seeded by
 * rating, with a third-place match, under the main hill's rules. The cron (`cron.ts`, Saturdays
 * 18:00 UTC) starts the championship due and makes next week's, which takes entries for six days:
 * from then until the Friday before it, 18:00 UTC. A championship has no owner; its results go to
 * the championships feed (`listChampionships`) when its `Runner` finishes it.
 *
 * Pure: the seed script (Bun) schedules the first championship with it too.
 */
import { DEFAULT_CONFIG } from '@asmbots/engine'
import type { ReplayConfig, TournamentConfig } from '@asmbots/protocol'

const DAY_MS = 24 * 60 * 60 * 1000

/** The engine's defaults as a config: all but the seed. */
const { seed: _, ...DEFAULTS } = DEFAULT_CONFIG

/** The main hill's rules (the launch seed's `main`): 80,000 cycles a round, bots up to 512 bytes. */
export const CHAMPIONSHIP_RULES: ReplayConfig = { ...DEFAULTS, maxCycles: 80_000, maxBotBytes: 512 }

/** Rounds a championship match, as the main hill's. */
export const CHAMPIONSHIP_ROUNDS = 10

/** How long before its start a championship stops taking entries: the six-day window's end. */
export const ENTRY_CLOSES_BEFORE_MS = DAY_MS

/** The first Saturday, 18:00 UTC, after `now`: when the next championship starts. */
export function nextChampionshipStart(now: Date): Date {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 18))
  start.setUTCDate(start.getUTCDate() + ((6 - start.getUTCDay() + 7) % 7))
  if (start.getTime() <= now.getTime()) start.setUTCDate(start.getUTCDate() + 7)
  return start
}

/** A championship's row, before it is one. */
export interface Championship {
  /** `weekly-<day>`: its id and slug. */
  readonly id: string
  readonly name: string
  readonly startsAt: string
  readonly entryClosesAt: string
  readonly config: TournamentConfig
}

/**
 * The weekly championship that starts at `startsAt`. Its matches place from a seed of its day
 * (`20261003`), so each week draws new placements.
 */
export function weeklyChampionship(startsAt: Date): Championship {
  const day = startsAt.toISOString().slice(0, 10)
  return {
    id: `weekly-${day}`,
    name: `weekly ${day}`,
    startsAt: startsAt.toISOString(),
    entryClosesAt: new Date(startsAt.getTime() - ENTRY_CLOSES_BEFORE_MS).toISOString(),
    config: {
      rounds: CHAMPIONSHIP_ROUNDS,
      seed: Number(day.replaceAll('-', '')),
      battle: CHAMPIONSHIP_RULES,
      seeding: 'rating',
      thirdPlace: true,
    },
  }
}

/**
 * The statement that makes championship `c`, scheduled and open, unless it is there already. Its
 * placeholders are plain `?`, in order: the seed script inlines them (`sqlScript`).
 */
export function championshipInsert(c: Championship): { sql: string; params: string[] } {
  return {
    sql: `INSERT INTO tournaments
            (id, slug, name, kind, status, config_json, owner_id, starts_at, entry, entry_closes_at)
          VALUES (?, ?, ?, 'bracket', 'scheduled', ?, NULL, ?, 'open', ?) ON CONFLICT DO NOTHING`,
    params: [c.id, c.id, c.name, JSON.stringify(c.config), c.startsAt, c.entryClosesAt],
  }
}
