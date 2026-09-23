/**
 * The bench battle: eight hand-assembled bots that never die, which between them paint with
 * `rep stosw`, spin, replicate with SPL, scan, and copy bytes. `ips.ts` times it and
 * `test/ips.test.ts` checks it.
 */
import type { BattleConfigInput, LoadedBot } from '../src/index'
import { Battle } from '../src/index'

/** A program: each instruction's source and its hand-assembled bytes. */
export type Source = readonly (readonly [text: string, bytes: readonly number[]])[]

/**
 * Paints 256 zero words below its base, then again, forever: 256 of every 260 turns are
 * `rep stosw` iterations. SP starts at the base, and `minSpacing` keeps those 512 bytes clear of
 * the other bots.
 */
export const PAINTER: Source = [
  ['mov di, sp', [0x89, 0xe7]],
  ['sub di, 0x200', [0x81, 0xef, 0x00, 0x02]],
  ['mov cx, 0x100', [0xb9, 0x00, 0x01]],
  ['rep stosw', [0xf3, 0xab]],
  ['jmp short $ - 11', [0xeb, 0xf3]],
]

/** Counts BX up forever. */
export const SPINNER: Source = [
  ['inc bx', [0x43]],
  ['jmp short $ - 1', [0xeb, 0xfd]],
]

/**
 * Each process starts a child at the top, counts CX down from 8, and dies on the DAT, so each
 * one replaces itself. The bot holds about 12 processes, and a spawn and a death come about
 * every 11 cycles.
 */
export const REPLICATOR: Source = [
  ['spl $', [0x60, 0xfe]],
  ['mov cx, 8', [0xb9, 0x08, 0x00]],
  ['loop $', [0xe2, 0xfe]],
  ['dat', [0x00, 0x00]],
]

/** Reads a word every 42 bytes around the core and counts the nonzero ones in DX. */
export const SCANNER: Source = [
  ['add di, 0x2A', [0x83, 0xc7, 0x2a]],
  ['cmp word [di], 0', [0x83, 0x3d, 0x00]],
  ['jz $ - 6', [0x74, 0xf8]],
  ['inc dx', [0x42]],
  ['jmp short $ - 9', [0xeb, 0xf5]],
]

/** Copies [SI] to [DI] forever. SI = DI = 0 at the start, so it rewrites the core onto itself. */
export const IMP: Source = [
  ['movsb', [0xa4]],
  ['jmp short $ - 1', [0xeb, 0xfd]],
]

export const PROGRAMS: Readonly<Record<string, Source>> = {
  painter: PAINTER,
  spinner: SPINNER,
  replicator: REPLICATOR,
  scanner: SCANNER,
  imp1: IMP,
  imp2: IMP,
  imp3: IMP,
  imp4: IMP,
}

export const BOTS: readonly LoadedBot[] = Object.entries(PROGRAMS).map(([name, source]) => ({
  name,
  bytes: Uint8Array.from(source.flatMap(([, bytes]) => bytes)),
}))

/** Cycles per run. No bot dies, so a run executes 8 instructions a cycle. */
export const CYCLES = 2_000_000

export const CONFIG: BattleConfigInput = { seed: 1, maxCycles: CYCLES }

/** One timed run. */
export interface Measurement {
  readonly instructions: number
  readonly cycles: number
  readonly seconds: number
}

/**
 * Places the bots, then times a run of `cycles` cycles with a `NullSink`. Placement is not
 * timed.
 */
export function measure(cycles = CYCLES): Measurement {
  const battle = new Battle(BOTS, { ...CONFIG, maxCycles: cycles })
  const start = performance.now()
  battle.run()
  const seconds = (performance.now() - start) / 1000
  const instructions = battle.bots.reduce((n, b) => n + b.stats.cycles, 0)
  return { instructions, cycles: battle.cycle, seconds }
}
