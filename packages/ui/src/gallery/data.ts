/*
 * The gallery's placeholder data: one battle, one hill, one keymap, one trace. Every value is fixed
 * or comes from a seeded generator, so each render, and each screenshot, is the same.
 */
import type { KeyBinding } from '../primitives/KeyHelp'

/** A seeded generator (mulberry32): 0 ≤ n < 1, the same sequence for the same seed. */
export function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

/** `n` values from `from` to `to`, each off the straight line by up to `noise`, never under 0. */
export function ramp(seed: number, n: number, from: number, to: number, noise: number): number[] {
  const next = random(seed)
  return Array.from({ length: n }, (_, i) => {
    const line = from + ((to - from) * i) / Math.max(1, n - 1)
    const off = i === 0 || i === n - 1 ? 0 : (next() * 2 - 1) * noise
    return Math.max(0, Math.round((line + off) * 10) / 10)
  })
}

/** A count in en-US grouping: `12,480`. */
export const grouped = (n: number): string => n.toLocaleString('en-US')

/** The battle's cycle, and its limit. */
export const CYCLE = 12_480
export const MAX_CYCLES = 100_000

/** A bot in the arena's battle. Its index is its hue and its owner id in the core, minus 1. */
export interface BattleBot {
  index: number
  name: string
  /** Live processes: 0 once it is dead. */
  procs: number
  /** Processes over the last 48 frames, oldest first. */
  history: readonly number[]
  writes: number
  /** The cycle it died at, or null while it lives. */
  died: number | null
  /** pMARS points over the rounds so far. */
  points: number
}

export const BATTLE_BOTS: readonly BattleBot[] = [
  bot(0, 'dwarf-v3', ramp(1, 48, 1, 1, 0), 3_214, null, 6),
  bot(1, 'imp-ring', [...ramp(2, 40, 1, 8, 1), ...Array<number>(8).fill(0)], 5_402, 10_733, 3),
  bot(2, 'stone', ramp(3, 48, 1, 1, 0), 1_983, null, 4),
  bot(3, 'paper-v2', ramp(4, 48, 1, 14, 2), 1_496, null, 5),
  bot(4, 'scanner', ramp(5, 48, 1, 2, 0.4), 318, null, 1),
  bot(5, 'vampire', ramp(6, 48, 1, 8, 1.5), 1_107, null, 2),
  bot(6, 'silk', ramp(7, 48, 1, 15, 2.5), 1_266, null, 3),
  bot(7, 'gate', [...ramp(8, 44, 1, 2, 0.4), ...Array<number>(4).fill(0)], 612, 11_902, 0),
]

function bot(
  index: number,
  name: string,
  history: number[],
  writes: number,
  died: number | null,
  points: number,
): BattleBot {
  return { index, name, procs: history.at(-1) ?? 0, history, writes, died, points }
}

/** A line of the arena's event log. */
export interface BattleEvent {
  cycle: number
  /** The bot it is about, for its hue. */
  bot: number | null
  kind: 'spawn' | 'death' | 'blood' | 'round'
  text: string
}

export const BATTLE_EVENTS: readonly BattleEvent[] = [
  { cycle: 12_480, bot: 6, kind: 'spawn', text: 'silk split → 0xB2C0' },
  { cycle: 12_211, bot: 3, kind: 'spawn', text: 'paper-v2 split → 0x61A0' },
  { cycle: 11_902, bot: 7, kind: 'death', text: 'gate died @ 0xE41C' },
  { cycle: 10_733, bot: 1, kind: 'death', text: 'imp-ring died @ 0x3B08' },
  { cycle: 6_014, bot: 2, kind: 'blood', text: 'first blood · stone → imp-ring' },
  { cycle: 0, bot: null, kind: 'round', text: 'round 1 of 3 · seed 0x1A2F' },
]

/** A bot on the main hill. Its hue is a bot index. */
export interface Entrant {
  name: string
  author: string
  hue: number
  score: number
  rating: number
  /** The rating's deviation: `1,842 ± 41`. */
  rd: number
  wins: number
  ties: number
  losses: number
  /** Submissions it has survived on the hill. */
  age: number
  /** Places gained (up) or lost (down) at the last submission. */
  trend: number
}

export const HILL: readonly Entrant[] = [
  entrant('dwarf-v3', '@pedram', 0, 186.4, 1_842, 41, [212, 41, 57], 38, 0),
  entrant('silk-v4', '@kay', 6, 181.9, 1_815, 44, [205, 47, 58], 21, 1),
  entrant('paper-v2', '@nyx', 3, 177.2, 1_798, 39, [199, 48, 63], 4, 3),
  entrant('stone-age', '@moth', 2, 170.8, 1_771, 52, [188, 60, 62], 55, -2),
  entrant('vampire-x', '@0xdead', 5, 166.3, 1_760, 47, [184, 58, 68], 17, -1),
  entrant('scanner-9', '@rr', 4, 159.0, 1_731, 58, [171, 66, 73], 9, 0),
  entrant('hybrid-ii', '@lux', 9, 154.6, 1_702, 61, [166, 64, 80], 12, 2),
  entrant('imp-ring', '@vee', 1, 149.1, 1_688, 44, [150, 82, 78], 70, -1),
  entrant('gate-keeper', '@hex', 7, 143.7, 1_659, 66, [147, 71, 92], 6, -3),
  entrant('decoy-z', '@ada', 8, 138.2, 1_640, 71, [139, 70, 101], 3, 1),
  entrant('painter-lcg', '@moth', 10, 133.5, 1_618, 59, [131, 74, 105], 27, 0),
  entrant('dwarf-wide', '@pedram', 11, 131.0, 1_604, 63, [128, 75, 107], 15, -2),
  entrant('painter-spiral', '@kay', 12, 124.4, 1_577, 74, [119, 67, 124], 8, 0),
  entrant('imp', '@vee', 13, 118.9, 1_551, 80, [101, 95, 114], 88, -1),
]

function entrant(
  name: string,
  author: string,
  hue: number,
  score: number,
  rating: number,
  rd: number,
  [wins, ties, losses]: readonly [number, number, number],
  age: number,
  trend: number,
): Entrant {
  return { name, author, hue, score, rating, rd, wins, ties, losses, age, trend }
}

/** The king's rating, submission by submission. */
export const KING_RATINGS = ramp(21, 38, 1_604, 1_842, 22)

/** Your best bot's rank, submission by submission: lower is better. */
export const YOUR_RANKS = ramp(22, 24, 15, 7, 1.5)

/** A result in the hill's recent-submissions feed. */
export interface Submission {
  name: string
  author: string
  hue: number
  /** The rank it took, or null when it did not make the hill. */
  rank: number | null
  /** Places up (or down, below 0) since its last submission. */
  change: number
  /** Its score when it did not place, and the score it needed. */
  scored?: readonly [score: number, needed: number] | undefined
  ago: string
}

export const SUBMISSIONS: readonly Submission[] = [
  { name: 'paper-v2', author: '@nyx', hue: 3, rank: 3, change: 3, ago: '2m' },
  {
    name: 'silk-v5',
    author: '@kay',
    hue: 6,
    rank: null,
    change: 0,
    scored: [112, 131],
    ago: '14m',
  },
  { name: 'hybrid-ii', author: '@lux', hue: 9, rank: 7, change: 2, ago: '1h' },
  { name: 'gate-keeper', author: '@hex', hue: 7, rank: 9, change: -3, ago: '3h' },
  { name: 'decoy-z', author: '@ada', hue: 8, rank: 10, change: 0, ago: '5h' },
]

/** The keymap: the app's global keys (EXEC 2.2) and the arena's (PRODUCT_SPEC §2). */
export const KEYS: readonly KeyBinding[] = [
  { keys: ['?'], description: 'key help', group: 'global' },
  { keys: ['t'], description: 'next theme', group: 'global' },
  { keys: ['/'], description: 'search', group: 'global' },
  { keys: ['g', 'a'], description: 'go to arena', group: 'global' },
  { keys: ['g', 'e'], description: 'go to editor', group: 'global' },
  { keys: ['g', 't'], description: 'go to tournaments', group: 'global' },
  { keys: ['g', 'h'], description: 'go to hills', group: 'global' },
  { keys: ['g', 'd'], description: 'go to docs', group: 'global' },
  { keys: ['space'], description: 'play or pause', group: 'arena' },
  { keys: ['.'], description: 'step', group: 'arena' },
  { keys: [','], description: 'step back', group: 'arena' },
  { keys: ['['], description: 'slower', group: 'arena' },
  { keys: [']'], description: 'faster', group: 'arena' },
  { keys: ['0'], description: 'reset zoom', group: 'arena' },
  { keys: ['1…9'], description: 'isolate bot n', group: 'arena' },
  { keys: ['f'], description: 'fullscreen', group: 'arena' },
  { keys: ['s'], description: 'screenshot', group: 'arena' },
  { keys: ['m'], description: 'mute', group: 'arena' },
  { keys: ['b'], description: 'bot library', group: 'editor' },
]

/** A line of a process trace: the virtualized table's 1,000 rows. */
export interface TraceRow {
  n: number
  cycle: number
  address: number
  bytes: readonly number[]
  text: string
}

const OPS = [
  'mov ax, [bx+4]',
  'add bx, 4',
  'jmp short 0x0100',
  'stosw',
  'dec cx',
  'jnz 0x0104',
  'spl 0x0200',
  'dat 0x41',
] as const

export const TRACE: readonly TraceRow[] = Array.from({ length: 1_000 }, (_, n) => ({
  n,
  cycle: CYCLE - 1_000 + n,
  address: (0x0100 + n * 3) & 0xffff,
  bytes: [(n * 37) & 0xff, (n * 91) & 0xff, (n * 13) & 0xff],
  text: OPS[n % OPS.length] as string,
}))
