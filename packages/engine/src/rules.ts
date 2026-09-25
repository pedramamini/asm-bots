/**
 * The rules a battle is set up by (ISA §5.5): the config and its defaults, placement, and pMARS
 * scoring. Nothing here runs a battle: a page that needs the rules loads none of the interpreter
 * (`Battle`, exec.ts).
 */
import { ADDR_MASK, CORE_SIZE } from './core'
import type { Pcg32 } from './prng'

/** What the assembler reads from `%author`, `%strategy`, and `%version` (ISA §6.2). */
export interface BotMeta {
  readonly author?: string | undefined
  readonly strategy?: string | undefined
  readonly version?: string | undefined
}

/** A bot ready to fight: its machine code, loaded at the base and entered there (ISA §6.5). */
export interface LoadedBot {
  readonly name: string
  readonly bytes: Uint8Array
  /** Carried for the UI. The engine never reads it. */
  readonly meta?: BotMeta | undefined
}

/** The battle parameters (ISA §5.5). */
export interface BattleConfig {
  /** Fixed at 65,536 in x16c v1. */
  readonly coreSize: number
  /** The battle ends when this many cycles have run. At most 2^32 - 1, so events fit a uint32. */
  readonly maxCycles: number
  /** Processes per bot. SPL is a NOP at the cap. */
  readonly maxProcesses: number
  /** The fewest free bytes allowed between two bot images. */
  readonly minSpacing: number
  /** The largest bot image, in bytes. */
  readonly maxBotBytes: number
  /** A uint32 that seeds the placement PRNG, PCG32 stream 0. */
  readonly seed: number
}

/** Config input: a field left out or undefined takes its `DEFAULT_CONFIG` value. */
export type BattleConfigInput = { readonly [K in keyof BattleConfig]?: number | undefined }

/** ISA §5.5 values. The spec gives the seed no default; 0 is this engine's. */
export const DEFAULT_CONFIG: BattleConfig = Object.freeze({
  coreSize: CORE_SIZE,
  maxCycles: 100_000,
  maxProcesses: 64,
  minSpacing: 1024,
  maxBotBytes: 512,
  seed: 0,
})

/** Owner tags are bytes and 0 is nobody (ISA §5.4), so a battle holds at most 255 bots. */
export const MAX_BOTS = 255

/** Draws per bot before placement fails (ISA §5.5). */
export const PLACEMENT_ATTEMPTS = 1000

/** The bots do not fit: a bot drew `PLACEMENT_ATTEMPTS` bases and none was clear (ISA §5.5). */
export class PlacementError extends Error {
  /** The index of the bot that did not fit. */
  readonly bot: number

  constructor(bot: number, size: number, minSpacing: number) {
    super(
      `cannot place bot ${bot} (${size} bytes) ${minSpacing} bytes clear of the ${bot} placed ` +
        `before it in ${PLACEMENT_ATTEMPTS} draws`,
    )
    this.name = 'PlacementError'
    this.bot = bot
  }
}

/**
 * A base for each image size, in order (ISA §5.5). A base is `rng.nextInt(65536)`, drawn again
 * until the image keeps `minSpacing` free bytes on each side from every image placed before it,
 * around the wrap. A bot that finds no base in `PLACEMENT_ATTEMPTS` draws throws
 * `PlacementError`.
 */
export function place(
  sizes: readonly number[],
  minSpacing: number,
  rng: Pick<Pcg32, 'nextInt'>,
): number[] {
  const bases: number[] = []
  for (let i = 0; i < sizes.length; i++) bases.push(draw(i, sizes, minSpacing, bases, rng))
  return bases
}

function draw(
  i: number,
  sizes: readonly number[],
  m: number,
  bases: readonly number[],
  rng: Pick<Pcg32, 'nextInt'>,
): number {
  const size = sizes[i] as number
  for (let t = 0; t < PLACEMENT_ATTEMPTS; t++) {
    const base = rng.nextInt(CORE_SIZE)
    if (clear(base, size, bases, sizes, m)) return base
  }
  throw new PlacementError(i, size, m)
}

/**
 * Whether `size` bytes at `base` keep `m` free bytes from each placed image. Take `d` as the
 * distance from `base` forward to a placed image's base. That image must start `m` or more bytes
 * after the new one ends (`d >= size + m`) and end `m` or more bytes before the new one starts,
 * around the wrap (`d + its size + m <= 65536`).
 */
function clear(
  base: number,
  size: number,
  bases: readonly number[],
  sizes: readonly number[],
  m: number,
): boolean {
  for (let j = 0; j < bases.length; j++) {
    const d = ((bases[j] as number) - base) & ADDR_MASK
    if (d < size + m || d + (sizes[j] as number) + m > CORE_SIZE) return false
  }
  return true
}

/** The score of each survivor when `survivors` of `n` bots live (ISA §5.5). Dead bots score 0. */
export function pmarsPoints(n: number, survivors: number): number {
  return survivors > 0 ? Math.floor((n * n - 1) / survivors) : 0
}
