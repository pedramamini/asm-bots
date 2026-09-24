/**
 * The arena's battle config (PRODUCT_SPEC §2): what the setup form edits, its limits, and the
 * preset chips. `ArenaConfig` is the settings store's, which keeps the last one fought.
 */
import { HILL_RULES } from '@asmbots/bots'
import { type BattleConfigInput, DEFAULT_CONFIG } from '@asmbots/engine'
import { MAX_MELEE_ENTRANTS } from '@asmbots/tourney'
import type { ArenaConfig } from '../../../store/settings'

/** The most bots in one arena battle: a melee's cap. */
export const MAX_ARENA_BOTS = MAX_MELEE_ENTRANTS

/** The fewest bots that make a fight. */
export const MIN_ARENA_BOTS = 2

/** A numeric field's range, and its grain where the control rounds to one. */
export interface Limits {
  readonly min: number
  readonly max: number
  readonly step: number
}

/** Rounds per match (PRODUCT_SPEC §2). */
export const ROUNDS: Limits = { min: 1, max: 10, step: 1 }
/** Max cycles per round (PRODUCT_SPEC §2): 10k..1M. */
export const CYCLES: Limits = { min: 10_000, max: 1_000_000, step: 1_000 }
/**
 * Processes per bot. The engine takes up to 65,536; past 256, the Worker's 128 keyframes of a
 * 16-bot battle would pass 28 MB.
 */
export const PROCS: Limits = { min: 1, max: 256, step: 1 }
/** Free bytes between two bot images. */
export const SPACING: Limits = { min: 0, max: 8192, step: 64 }
/** Seeds are uint32 (ISA §5.5). */
export const SEED: Limits = { min: 0, max: 0xffff_ffff, step: 1 }

/** The config fields a preset sets: everything but the seed. */
export type PresetValues = Pick<ArenaConfig, 'rounds' | 'maxCycles' | 'maxProcesses' | 'minSpacing'>

/** The preset chips, in order (PRODUCT_SPEC §2). */
export const PRESET_NAMES = ['duel', 'melee 8', 'melee 16', 'hill rules'] as const
export type PresetName = (typeof PRESET_NAMES)[number]

/**
 * What each preset sets. `duel` is the engine's defaults (ISA §5.5), one round. The melees give a
 * crowd more cycles to thin out, and `melee 16` halves the process cap and the spacing, so 16 bots
 * share the process budget of 8 and place easily. `hill rules` is the main hill's: 80,000 cycles,
 * 10 rounds (PRODUCT_SPEC §5).
 */
export const PRESETS: Readonly<Record<PresetName, PresetValues>> = {
  duel: {
    rounds: 1,
    maxCycles: DEFAULT_CONFIG.maxCycles,
    maxProcesses: DEFAULT_CONFIG.maxProcesses,
    minSpacing: DEFAULT_CONFIG.minSpacing,
  },
  'melee 8': {
    rounds: 1,
    maxCycles: 200_000,
    maxProcesses: DEFAULT_CONFIG.maxProcesses,
    minSpacing: DEFAULT_CONFIG.minSpacing,
  },
  'melee 16': { rounds: 1, maxCycles: 300_000, maxProcesses: 32, minSpacing: 512 },
  'hill rules': {
    rounds: 10,
    maxCycles: HILL_RULES.maxCycles ?? DEFAULT_CONFIG.maxCycles,
    maxProcesses: DEFAULT_CONFIG.maxProcesses,
    minSpacing: DEFAULT_CONFIG.minSpacing,
  },
}

/** A first visit's config: `duel`, with a random seed. */
export const DEFAULT_ARENA_CONFIG: ArenaConfig = Object.freeze({
  preset: 'duel',
  seed: null,
  ...PRESETS.duel,
})

/** The preset whose values `config` has, or null for a hand-made config. */
export function presetOf(config: PresetValues): PresetName | null {
  return (
    PRESET_NAMES.find((name) => {
      const preset = PRESETS[name]
      return (
        preset.rounds === config.rounds &&
        preset.maxCycles === config.maxCycles &&
        preset.maxProcesses === config.maxProcesses &&
        preset.minSpacing === config.minSpacing
      )
    }) ?? null
  )
}

/** `config` with the values of preset `name`, the seed as it was. */
export function withPreset(config: ArenaConfig, name: PresetName): ArenaConfig {
  return { ...config, ...PRESETS[name], preset: name }
}

/** `config` with `change`, held to the limits, and its `preset` field brought up to date. */
export function withConfig(config: ArenaConfig, change: Partial<ArenaConfig>): ArenaConfig {
  const next = sanitizeConfig({ ...config, ...change })
  return { ...next, preset: presetOf(next) }
}

/**
 * A config the form can show: each count an integer within its limits (the default in place of
 * junk), the seed a uint32 or null, and `preset` matching the values.
 */
export function sanitizeConfig(config: Partial<Record<keyof ArenaConfig, unknown>>): ArenaConfig {
  const values: PresetValues = {
    rounds: countOf(config.rounds, ROUNDS) ?? DEFAULT_ARENA_CONFIG.rounds,
    maxCycles: countOf(config.maxCycles, CYCLES) ?? DEFAULT_ARENA_CONFIG.maxCycles,
    maxProcesses: countOf(config.maxProcesses, PROCS) ?? DEFAULT_ARENA_CONFIG.maxProcesses,
    minSpacing: countOf(config.minSpacing, SPACING) ?? DEFAULT_ARENA_CONFIG.minSpacing,
  }
  return { ...values, seed: seedOf(config.seed), preset: presetOf(values) }
}

/**
 * `value` as an integer within `limits`: from a number, or a string of digits (a URL gives both),
 * rounded, and past an end that end. Null for anything else.
 */
export function countOf(value: unknown, limits: Limits): number | null {
  const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  if (typeof n !== 'number' || !Number.isFinite(n)) return null
  return Math.min(limits.max, Math.max(limits.min, Math.round(n)))
}

/** A uint32 seed from a number or a string of digits, else null (random). */
export function seedOf(value: unknown): number | null {
  const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  return typeof n === 'number' && Number.isInteger(n) && n >= SEED.min && n <= SEED.max ? n : null
}

/** The engine's part of `config`, for a round placed with `seed` (ISA §5.5). */
export function battleConfig(config: ArenaConfig, seed: number): BattleConfigInput {
  return {
    maxCycles: config.maxCycles,
    maxProcesses: config.maxProcesses,
    minSpacing: config.minSpacing,
    seed,
  }
}

/** A random uint32 seed. */
export function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] as number
}
