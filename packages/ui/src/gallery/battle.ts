/*
 * A frozen battle for the gallery's arena: the 64 KB core at cycle 12,480 of an 8-bot melee, as the
 * roster's strategies leave it. A stand-in for the engine's snapshot until the renderer (EXEC 2.3)
 * draws real ones. Seeded, so every draw is the same.
 */
import { BATTLE_BOTS, random } from './data'

/** Bytes in the core, and in one row of the arena's 256 × 256 grid. */
export const CORE_SIZE = 0x1_0000
export const ROW_BYTES = 0x100

/**
 * Where the zoomed sheet looks: a copy of paper-v2 half written, one of its processes running in
 * an older copy, a copy of silk, a scanner carpet, and stone's bombs passing through.
 */
export const HOTSPOT = 0x5810

/** A live process: its bot, its IP, and whether it runs next in its bot's queue. */
export interface Process {
  bot: number
  ip: number
  front: boolean
}

/** A byte touched a moment ago: `age` ms since the write or the execution. */
export interface Touch {
  address: number
  age: number
}

export interface Battle {
  /** The owner of each byte: 0 for none, else the bot index + 1. */
  owner: Uint8Array
  /** 1 where the byte holds zero: owned-but-zero bytes draw dim (DESIGN_SYSTEM §5). */
  zero: Uint8Array
  /** Bots that have died: their territory draws desaturated. */
  dead: ReadonlySet<number>
  processes: readonly Process[]
  /** Recent writes, for the white flash. */
  writes: readonly Touch[]
  /** Recent executions, for the yellow trail. */
  execs: readonly Touch[]
}

/** The battle, built once on first use. */
export function battle(): Battle {
  cached ??= build()
  return cached
}

let cached: Battle | undefined

function build(): Battle {
  const owner = new Uint8Array(CORE_SIZE)
  const zero = new Uint8Array(CORE_SIZE)
  const next = random(0x1a2f)
  const at = (address: number) => address & (CORE_SIZE - 1)
  const put = (bot: number, address: number, isZero: boolean) => {
    owner[at(address)] = bot + 1
    zero[at(address)] = isZero ? 1 : 0
  }
  const block = (bot: number, start: number, length: number, zeroShare = 0) => {
    for (let i = 0; i < length; i++) put(bot, start + i, next() < zeroShare)
  }
  const somewhere = () => Math.floor(next() * CORE_SIZE)

  const processes: Process[] = []
  const writes: Touch[] = []
  const execs: Touch[] = []
  const run = (bot: number, ips: readonly number[], stride: number) => {
    ips.forEach((ip, n) => {
      processes.push({ bot, ip: at(ip), front: n === 0 })
      // The instructions it ran just before: a trail back from the IP.
      for (let k = 1; k <= 10; k++) execs.push({ address: at(ip - k * stride), age: k * 55 })
    })
  }
  /** Recent writes, newest first. */
  const flash = (addresses: readonly number[]) => {
    addresses.forEach((address, k) => {
      writes.push({ address: at(address), age: k * 45 })
    })
  }

  // imp-ring (1), dead at 10,733: the trail its copies laid, still its own.
  block(1, 0x2c00, 0x1500)
  // gate (7), dead at 11,902: its code and the strip it kept clear.
  block(7, 0xe400, 40)
  block(7, 0xe428, 0x1d8, 1)
  // stone (2): its code, then a bomb every 0x137 bytes around the core.
  block(2, 0x4a00, 32)
  const stone = Array.from({ length: 1_900 }, (_, k) => 0x4a20 + k * 0x137)
  for (const address of stone) put(2, address, next() < 0.8)
  // dwarf-v3 (0): its code, then a zero every 4 bytes, 3,120 of them.
  block(0, 0x0400, 24)
  const dwarf = Array.from({ length: 3_120 }, (_, k) => 0x0418 + k * 4)
  for (const address of dwarf) put(0, address, true)
  // paper-v2 (3): 28 copies of its 48 bytes, and at the hot spot one more, half written.
  const paper = [...Array.from({ length: 27 }, somewhere), HOTSPOT + 0x604]
  for (const start of paper) block(3, start, 48, 0.1)
  block(3, HOTSPOT + 0x208, 36, 0.1)
  // silk (6): 34 copies of its 32 bytes, in two bursts.
  const silk = Array.from({ length: 34 }, (_, k) =>
    k < 20 ? 0xb000 + Math.floor(next() * 0x2000) : somewhere(),
  )
  for (const start of [...silk, HOTSPOT + 0x912]) block(6, start, 32, 0.1)
  // scanner (4): its code, and a carpet of 24 bytes on each of 6 bots it found.
  block(4, 0x8c00, 36)
  const carpets = [0x2f40, HOTSPOT + 0xc00, 0x6a80, 0x9e20, 0xc6c0, 0xe8a0]
  for (const start of carpets) block(4, start, 24)
  // vampire (5): its code, its pit, and a fang every 0x233 bytes.
  block(5, 0xa600, 44)
  block(5, 0xa680, 64, 1)
  const fangs = Array.from({ length: 260 }, (_, k) => 0xa6c0 + k * 0x233)
  for (const address of fangs) put(5, address, false)

  // The 41 live processes (DESIGN_SYSTEM §4: "8 bots · 41 procs").
  run(0, [0x040c], 2)
  run(2, [0x4a10], 3)
  run(
    3,
    [...paper.slice(0, 13), HOTSPOT + 0x604].map((start) => start + 8),
    2,
  )
  run(4, [0x8c18, 0x8c04], 3)
  run(5, [0xa610, 0xa690, 0xa6a0, 0xa688, 0xa6b0, 0xa698, 0xa6a8, 0xa680], 2)
  run(
    6,
    silk.slice(0, 15).map((start) => start + 6),
    2,
  )
  // The last bytes each writer wrote: paper-v2's copy front, and each bomber's last bombs.
  flash(Array.from({ length: 12 }, (_, k) => HOTSPOT + 0x208 + 35 - k))
  flash(dwarf.slice(-14).reverse())
  flash(stone.slice(-8).reverse())
  flash(fangs.slice(-6).reverse())

  const dead = new Set(BATTLE_BOTS.filter((b) => b.died !== null).map((b) => b.index))
  return { owner, zero, dead, processes, writes, execs }
}

/** How many bytes each bot owns, by bot index. */
export function footprints(state: Battle, bots: number): number[] {
  const counts = Array<number>(bots).fill(0)
  for (const id of state.owner) if (id > 0 && id <= bots) counts[id - 1] = (counts[id - 1] ?? 0) + 1
  return counts
}
