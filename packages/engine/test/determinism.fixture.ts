/**
 * The determinism tests' battle: four hand-assembled bots that between them write, repeat string
 * stores, call and return, spawn, and die, by DAT, HLT, and a divide error. `determinism.test.ts`
 * runs it on the main thread and `determinism.worker.ts` runs it in a Worker.
 */
import type { BattleConfigInput, LoadedBot, Result, Snapshot } from '../src/index'
import { Battle, eventHash, HashSink, resultHash, snapshot } from '../src/index'

/** A program: each instruction's source and its hand-assembled bytes. */
export type Source = readonly (readonly [text: string, bytes: readonly number[]])[]

/**
 * Finds its own address, then paints DAT words from 8 KB past itself: 128 words, skip 256 bytes,
 * and again. Each `rep stosw` takes 128 turns.
 */
export const PAINTER: Source = [
  ['call $ + 3', [0xe8, 0x00, 0x00]],
  ['pop di', [0x5f]],
  ['add di, 0x2000', [0x81, 0xc7, 0x00, 0x20]],
  ['mov cx, 0x80', [0xb9, 0x80, 0x00]],
  ['rep stosw', [0xf3, 0xab]],
  ['add di, 0x100', [0x81, 0xc7, 0x00, 0x01]],
  ['jmp short $ - 9', [0xeb, 0xf5]],
]

/** The parent spawns forever. Each child counts CX down from 16, then runs into a DAT. */
export const SPAWNER: Source = [
  ['spl $ + 4', [0x60, 0x02]],
  ['jmp short $ - 2', [0xeb, 0xfc]],
  ['mov cx, 0x10', [0xb9, 0x10, 0x00]],
  ['loop $', [0xe2, 0xfe]],
  ['dat', [0x00, 0x00]],
]

/** Calls a routine that pushes and pops 32 times, then halts: it dies in cycle 193. */
export const CALLER: Source = [
  ['mov cx, 0x20', [0xb9, 0x20, 0x00]],
  ['call $ + 6', [0xe8, 0x03, 0x00]],
  ['loop $ - 3', [0xe2, 0xfb]],
  ['hlt', [0xf4]],
  ['push ax', [0x50]],
  ['inc ax', [0x40]],
  ['pop bx', [0x5b]],
  ['ret', [0xc3]],
]

/** Adds and shifts 300 times, then divides by BL, which is 0: it dies in cycle 901. */
export const DIVIDER: Source = [
  ['mov cx, 0x12C', [0xb9, 0x2c, 0x01]],
  ['add ax, cx', [0x01, 0xc8]],
  ['shl ax, 1', [0xd1, 0xe0]],
  ['loop $ - 4', [0xe2, 0xfa]],
  ['div bl', [0xf6, 0xf3]],
]

export const PROGRAMS: readonly Source[] = [PAINTER, SPAWNER, CALLER, DIVIDER]

export const BOTS: readonly LoadedBot[] = PROGRAMS.map((source, i) => ({
  name: ['painter', 'spawner', 'caller', 'divider'][i] as string,
  bytes: Uint8Array.from(source.flatMap(([, bytes]) => bytes)),
}))

/** A seed that places the painter's first 1,000 cycles of paint clear of the other bots. */
export const CONFIG: BattleConfigInput = { seed: 7, maxProcesses: 8 }

/** What a run reports: its hashes and its state at the end. */
export interface Run {
  readonly eventHash: string
  readonly resultHash: string
  readonly snapshot: Snapshot
  readonly result: Result
}

/** Runs the battle for up to `cycles` cycles, hashing every event. */
export function hashedRun(
  cycles = Number.POSITIVE_INFINITY,
  bots: readonly LoadedBot[] = BOTS,
  config: BattleConfigInput = CONFIG,
): Run {
  const sink = new HashSink()
  const battle = new Battle(bots, config, sink)
  battle.run(cycles)
  const result = battle.result()
  return {
    eventHash: eventHash(sink),
    resultHash: resultHash(result),
    snapshot: snapshot(battle),
    result,
  }
}
