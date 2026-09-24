/**
 * The debugger's battle (PRODUCT_SPEC §3, ARCHITECTURE §6): a `Battle` on the main thread, not in
 * the arena Worker, so a move runs synchronously and stops between any two cycles. The session
 * holds the process it follows, the breakpoints, and the snapshots that step back. After each
 * change it gives its listeners a new `DebugState`.
 *
 * Moves. The engine runs whole cycles, each living bot one instruction of its front process, so a
 * move runs whole cycles until its goal:
 * - `step` runs until the followed process has run one instruction. A bot runs one of its
 *   processes a cycle, so a process of a bot with 3 waits 3 cycles for its turn, and a step of it
 *   runs the other bots, and the bot's other processes, in between.
 * - `stepOver` does the same, except on a `call` and on a REP string instruction: then it runs
 *   until the process stands on the next instruction, back from the call or done repeating.
 * - `stepOut` runs until the process runs a `ret` that pops at or above the SP it had.
 * - `runToCursor(addr)` runs until a process is about to run the instruction at `addr`.
 * - `runUntilDeath(bot)` runs until the bot has no process left. `run(n)` runs `n` cycles.
 * Each move also stops at a breakpoint, at an INT3, and at the end of the battle.
 *
 * Breakpoints are checks, never bytes in the core. Before each cycle, the session reads the front
 * process of each living bot, the one that runs in the cycle, and stops when one stands on an
 * enabled breakpoint whose condition holds. Nothing that a cycle does can change which process a
 * bot runs, or its registers, before its turn, so a check before the cycle is exact. A move never
 * stops where it starts: it checks from its second cycle on, so `run` from a breakpoint runs the
 * instruction there, as a debugger resumes. ISA §3.6 makes INT3 a breakpoint in the debugger: the
 * session stops before a process runs an INT3 that its bot owns (its own code), and a move from
 * there runs it, so the process dies as it does in the arena. An INT3 that another bot wrote is a
 * bomb, and kills without a stop, as a DAT does.
 *
 * Step back. Before a step (`step`, `stepOver`, `stepOut`) the session keeps a snapshot, and step
 * back returns to it. A run (`run`, `runToCursor`, `runUntilDeath`) keeps one where it starts and
 * one every `RUN_SNAPSHOT_INTERVAL` cycles, and step back goes back through it a cycle at a time:
 * it restores the snapshot at or before the cycle and runs forward to it. A battle is a pure
 * function of its state, so that cycle is the one the run went through. The session keeps
 * `HISTORY_DEPTH` snapshots, the newest.
 */
import { decode } from '@asmbots/codec'
import {
  AX,
  Battle,
  type BattleConfig,
  type BattleConfigInput,
  type Bot,
  BP,
  BX,
  CX,
  type DeathReason,
  DI,
  DX,
  EventRing,
  FLAGS,
  IP,
  type LoadedBot,
  NullSink,
  type ProcQueue,
  type ProcRow,
  restore,
  SI,
  type Snapshot,
  SP,
  snapshot,
  WRITE_RECORD,
} from '@asmbots/engine'
import { type CompiledCondition, compileCondition, testCondition } from './condition'

/** Snapshots kept for step back (PRODUCT_SPEC §3: 256 deep). */
export const HISTORY_DEPTH = 256
/** Cycles between two snapshots of a run. */
export const RUN_SNAPSHOT_INTERVAL = 64
/** Writes kept for `lastWrites`: the newest. */
export const MAX_LAST_WRITES = 256

const INT3 = 0xcc
const RET = 0xc3
const RET_IMM = 0xc2

/** A process: its bot, and its row in the bot's queue, which it keeps from its spawn to its death. */
export interface ProcRef {
  readonly bot: number
  readonly row: number
}

/** The followed process, and where it is in its bot's queue. */
export interface SelectedProc extends ProcRef {
  /** Its place in the queue: 0 runs next. -1 once it is dead, when its row keeps its last values. */
  readonly index: number
}

/** A process's 16-bit registers. */
export interface Registers {
  readonly ax: number
  readonly bx: number
  readonly cx: number
  readonly dx: number
  readonly si: number
  readonly di: number
  readonly bp: number
  readonly sp: number
}

/** A store of one bot: `len` bytes (1 or 2) from `addr`, in cycle `cycle`. */
export interface WriteRecord {
  readonly cycle: number
  readonly bot: number
  readonly addr: number
  readonly len: number
}

/** A process about to run the instruction at `addr`. */
interface At extends ProcRef {
  readonly addr: number
}

/** The followed process died running the instruction at `addr`, for `reason`. */
interface Died extends At {
  readonly kind: 'died'
  readonly reason: DeathReason
}

/** Why the session stands where it does. */
export type DebugStop =
  /** A new battle, or a reset one: nothing has run. */
  | { readonly kind: 'start' }
  /** A step, a step over, or a step out got to its end. */
  | { readonly kind: 'step' }
  /** `run(n)` ran its cycles. */
  | { readonly kind: 'cycles' }
  /**
   * A process stands on a breakpoint whose condition holds. `error` says why the condition could
   * not be evaluated (a division by zero), which stops as a hold does.
   */
  | (At & { readonly kind: 'breakpoint'; readonly error?: string })
  /** A process stands on an INT3 of its own bot (ISA §3.6). */
  | (At & { readonly kind: 'int3' })
  /** A process stands on the cursor of `runToCursor`. */
  | (At & { readonly kind: 'cursor' })
  /** The followed process died running the instruction at `addr`. */
  | Died
  /** The bot of `runUntilDeath` has no process left. */
  | { readonly kind: 'death'; readonly bot: number }
  /** The battle is over (ISA §5.5). */
  | { readonly kind: 'over' }
  /** A step back. */
  | { readonly kind: 'back' }

/** A breakpoint, as the Breakpoints panel shows it. */
export interface Breakpoint {
  readonly addr: number
  readonly enabled: boolean
  /** As typed, or `''` for none. */
  readonly condition: string
  /** Stops it made since the battle started. */
  readonly hits: number
}

/** What the session tells its listeners after every change. */
export interface DebugState {
  /** Cycles run. */
  readonly cycle: number
  readonly over: boolean
  readonly stop: DebugStop
  readonly selectedProc: SelectedProc
  /** The followed process's registers, FLAGS, and IP. */
  readonly regs: Registers
  readonly flags: number
  readonly ip: number
  /** The stores of the last move, oldest first: at most `MAX_LAST_WRITES`, the newest. */
  readonly lastWrites: readonly WriteRecord[]
  /** By address. */
  readonly breakpoints: readonly Breakpoint[]
  readonly canStepBack: boolean
}

/** Where a move goes. */
type Goal =
  | { readonly kind: 'step' }
  | { readonly kind: 'over'; readonly ret: number }
  | { readonly kind: 'out' }
  | { readonly kind: 'cycles'; readonly until: number; readonly stop: DebugStop }
  | { readonly kind: 'cursor'; readonly addr: number }
  | { readonly kind: 'death'; readonly bot: number }

/** A snapshot for step back. After a fine one, each cycle up to the next snapshot is a stop. */
interface Mark {
  readonly snap: Snapshot
  readonly fine: boolean
}

interface BreakpointEntry {
  readonly addr: number
  enabled: boolean
  condition: CompiledCondition | null
  hits: number
}

const START: DebugStop = Object.freeze({ kind: 'start' })
const STEP: DebugStop = Object.freeze({ kind: 'step' })
const CYCLES: DebugStop = Object.freeze({ kind: 'cycles' })
const OVER: DebugStop = Object.freeze({ kind: 'over' })
const BACK: DebugStop = Object.freeze({ kind: 'back' })

/** The sink of a step back's run forward, which only goes back over what already ran. */
const SILENT = new NullSink()

/** `q`'s place of `row`, or -1 when it holds no process there. */
function queueIndex(q: ProcQueue, row: number): number {
  for (let i = 0; i < q.size; i++) if (q.at(i) === row) return i
  return -1
}

/** The row of the last process of a dead bot: `shift` leaves it just behind the head. */
function lastDead(q: ProcQueue): number {
  return q.data[(q.head + q.capacity - 1) % q.capacity] as number
}

/** The row a bot is followed by: its front process, or its last one once it is dead. */
function rowOf(bot: Bot): number {
  return bot.queue.size > 0 ? bot.queue.front() : lastDead(bot.queue)
}

/**
 * The session's event sink: a move's writes, and what the followed process does. Events come
 * before the instruction runs (`exec`), so the sink still reads the registers it runs on.
 */
class DebugSink extends NullSink {
  readonly writes = new EventRing(WRITE_RECORD, MAX_LAST_WRITES)
  /** The followed process. */
  bot = -1
  row = -1
  /** For `stepOut`: a `ret` popping at or above this SP leaves the function. -1 for none. */
  outSp = -1
  /** Whether the followed process has run in this move. */
  ran = false
  /** Whether it ran a `ret` that leaves the function `stepOut` started in. */
  returned = false
  /** Its death in this move, or null. */
  fatal: Died | null = null
  private battle: Battle | null = null

  attach(battle: Battle): void {
    this.battle = battle
  }

  /** Starts a move that follows `proc`. */
  follow(proc: ProcRef, outSp: number): void {
    this.bot = proc.bot
    this.row = proc.row
    this.outSp = outSp
    this.ran = false
    this.returned = false
    this.fatal = null
    this.writes.start = 0
    this.writes.length = 0
    this.writes.dropped = 0
  }

  override exec(_cycle: number, bot: number, proc: number, addr: number): void {
    if (bot !== this.bot || proc !== this.row) return
    this.ran = true
    if (this.outSp < 0) return
    const battle = this.battle as Battle
    const op = battle.core.bytes[addr]
    if (op !== RET && op !== RET_IMM) return
    const sp = ((battle.bots[bot] as Bot).queue.rows[proc] as ProcRow)[SP] as number
    // At or above within half the core: the stack wraps at 64 KB.
    if (((sp - this.outSp) & 0xffff) < 0x8000) this.returned = true
  }

  override write(cycle: number, bot: number, addr: number, len: number): void {
    const d = this.writes.data
    const o = this.writes.add()
    d[o] = cycle
    d[o + 1] = bot
    d[o + 2] = addr
    d[o + 3] = len
  }

  override death(
    _cycle: number,
    bot: number,
    proc: number,
    addr: number,
    reason: DeathReason,
  ): void {
    if (bot !== this.bot || proc !== this.row) return
    this.fatal = { kind: 'died', bot, row: proc, addr, reason }
  }

  /** The move's writes, oldest first. Empties the ring. */
  drain(): WriteRecord[] {
    const d = this.writes.drain()
    const out: WriteRecord[] = []
    for (let o = 0; o < d.length; o += WRITE_RECORD) {
      out.push({
        cycle: d[o] as number,
        bot: d[o + 1] as number,
        addr: d[o + 2] as number,
        len: d[o + 3] as number,
      })
    }
    return out
  }
}

function checkAddress(what: string, addr: number): number {
  if (!Number.isInteger(addr) || addr < 0 || addr > 0xffff) {
    throw new RangeError(`${what}: an address is an integer in 0..0xFFFF, got ${addr}`)
  }
  return addr
}

/**
 * One debug battle: the bot in the editor and its opponents, placed by the config's seed. Throws
 * as `new Battle` does for bots that do not fit.
 */
export class DebugSession {
  /** The bots, the one debugged first. */
  readonly bots: readonly LoadedBot[]
  readonly config: BattleConfig
  private current: Battle
  private readonly sink = new DebugSink()
  private readonly listeners = new Set<(state: DebugState) => void>()
  private marks: Mark[] = []
  /**
   * Whether the battle stands where the last run left it, with nothing changed since: the next
   * run goes on from the newest snapshot, which is fine. Anything that changes the battle other
   * than a move (a step back, a reset, an edit of a register) must clear it, or a step back
   * would run forward from before the change.
   */
  private continuing = false
  /**
   * The followed process. After a step that it died in, its row stays followed, so the state shows
   * the instruction that killed it, until the next move follows the bot's next process.
   */
  private selected: ProcRef
  private readonly bps = new Map<number, BreakpointEntry>()
  /** 1 at the address of each enabled breakpoint. */
  private readonly bpAt = new Uint8Array(0x10000)
  /** The breakpoints as the state lists them; null once one changes, until the next state. */
  private bpList: readonly Breakpoint[] | null = null
  private stopped: DebugStop = START
  private writes: readonly WriteRecord[] = []
  private published: DebugState

  constructor(bots: readonly LoadedBot[], config: BattleConfigInput = {}) {
    const battle = new Battle(bots, config, this.sink)
    this.bots = bots
    this.config = battle.config
    this.current = battle
    this.sink.attach(battle)
    this.selected = { bot: 0, row: rowOf(battle.bots[0] as Bot) }
    this.published = this.read()
  }

  /** The battle as it stands. A step back and a reset replace it, so read it again after one. */
  get battle(): Battle {
    return this.current
  }

  /** The state the listeners last got. */
  get state(): DebugState {
    return this.published
  }

  /** Calls `listener` with each new state. Returns what stops the calls. */
  readonly subscribe = (listener: (state: DebugState) => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Follows process `row` of `bot`: its front process when `row` is left out. */
  select(bot: number, row?: number): DebugState {
    const b = this.botAt('select', bot)
    const target = row ?? rowOf(b)
    if (queueIndex(b.queue, target) < 0 && !(b.queue.size === 0 && target === lastDead(b.queue))) {
      throw new RangeError(`select: bot ${bot} has no process in row ${target}`)
    }
    this.selected = { bot, row: target }
    return this.publish()
  }

  /**
   * Runs until the followed process has run one instruction. Of a dead bot, runs one cycle.
   */
  step(): DebugState {
    if (!this.refollow()) return this.move(this.oneCycle(), false)
    return this.move({ kind: 'step' }, false)
  }

  /**
   * On a `call` or a REP string instruction, runs until the followed process stands on the next
   * instruction; on any other, steps.
   */
  stepOver(): DebugState {
    if (!this.refollow()) return this.step()
    const bytes = this.current.core.bytes
    const ip = this.followedRow()[IP] as number
    const d = decode((a) => bytes[a & 0xffff] as number, ip)
    if (!d.ok || (d.instr.mnemonic !== 'call' && d.instr.prefix === undefined)) return this.step()
    return this.move({ kind: 'over', ret: (ip + d.length) & 0xffff }, false)
  }

  /** Runs until the followed process runs a `ret` that pops at or above its SP. */
  stepOut(): DebugState {
    if (!this.refollow()) return this.step()
    return this.move({ kind: 'out' }, false, this.followedRow()[SP] as number)
  }

  /** Runs until a process is about to run the instruction at `addr`. */
  runToCursor(addr: number): DebugState {
    return this.move({ kind: 'cursor', addr: checkAddress('runToCursor', addr) }, true)
  }

  /** Runs until `bot` has no process left. */
  runUntilDeath(bot: number): DebugState {
    this.botAt('runUntilDeath', bot)
    return this.move({ kind: 'death', bot }, true)
  }

  /** Runs `cycles` cycles: `Infinity` runs until something stops it. */
  run(cycles: number): DebugState {
    if (!(cycles >= 0) || !(Number.isInteger(cycles) || cycles === Number.POSITIVE_INFINITY)) {
      throw new RangeError(`run: a whole number of cycles, got ${cycles}`)
    }
    return this.move({ kind: 'cycles', until: this.current.cycle + cycles, stop: CYCLES }, true)
  }

  /**
   * Goes back one stop: to before the last step, or a cycle back in a run. Null when there is no
   * snapshot to go back to.
   */
  stepBack(): DebugState | null {
    const now = this.current.cycle
    let mark = this.marks.at(-1)
    while (mark !== undefined && mark.snap.cycle >= now) {
      this.marks.pop()
      mark = this.marks.at(-1)
    }
    if (mark === undefined) return null
    const from = mark.snap.cycle
    const target = mark.fine ? now - 1 : from
    if (target === from) this.marks.pop()
    const battle = restore(mark.snap, this.bots, this.config, SILENT)
    battle.run(target - from)
    battle.events = this.sink
    this.replace(battle)
    this.continuing = false
    this.writes = []
    this.stopped = BACK
    const { bot, row } = this.selected
    const b = battle.bots[bot] as Bot
    if (queueIndex(b.queue, row) < 0) this.selected = { bot, row: rowOf(b) }
    return this.publish()
  }

  /** Starts the battle again: the same bots and seed. Breakpoints stay, their hits back at 0. */
  reset(): DebugState {
    this.replace(new Battle(this.bots, this.config, this.sink))
    this.marks = []
    this.continuing = false
    for (const bp of this.bps.values()) bp.hits = 0
    this.bpList = null
    const bot = this.selected.bot
    this.selected = { bot, row: rowOf(this.current.bots[bot] as Bot) }
    this.writes = []
    this.stopped = START
    return this.publish()
  }

  /**
   * Sets a breakpoint at `addr`, or changes the one there. A field left out keeps its value, or
   * for a new breakpoint takes enabled and no condition. An empty condition is none. Throws
   * `RangeError` for a condition that does not compile: check it with `compileCondition` first.
   */
  setBreakpoint(
    addr: number,
    options: { readonly condition?: string; readonly enabled?: boolean } = {},
  ): Breakpoint {
    checkAddress('setBreakpoint', addr)
    const text = options.condition
    const blank = text?.trim() === ''
    let condition: CompiledCondition | null | undefined = blank ? null : undefined
    if (text !== undefined && !blank) {
      const compiled = compileCondition(text)
      if (!compiled.ok) {
        const { col, message } = compiled.error
        throw new RangeError(`setBreakpoint: column ${col}: ${message}`)
      }
      condition = compiled.compiled
    }
    const bp = this.bps.get(addr) ?? { addr, enabled: true, condition: null, hits: 0 }
    if (condition !== undefined) bp.condition = condition
    if (options.enabled !== undefined) bp.enabled = options.enabled
    this.bps.set(addr, bp)
    this.bpAt[addr] = bp.enabled ? 1 : 0
    this.bpList = null
    this.publish()
    return view(bp)
  }

  /** Removes the breakpoint at `addr`. Returns whether there was one. */
  removeBreakpoint(addr: number): boolean {
    checkAddress('removeBreakpoint', addr)
    if (!this.bps.delete(addr)) return false
    this.bpAt[addr] = 0
    this.bpList = null
    this.publish()
    return true
  }

  /** Removes the breakpoint at `addr`, or sets one there. Returns whether one is set now. */
  toggleBreakpoint(addr: number): boolean {
    if (this.removeBreakpoint(addr)) return false
    this.setBreakpoint(addr)
    return true
  }

  private botAt(what: string, bot: number): Bot {
    const b = Number.isInteger(bot) ? this.current.bots[bot] : undefined
    if (b === undefined) throw new RangeError(`${what}: no bot ${bot}`)
    return b
  }

  private followedRow(): ProcRow {
    const { bot, row } = this.selected
    return (this.current.bots[bot] as Bot).queue.rows[row] as ProcRow
  }

  /**
   * Whether the followed process lives. When it died and its bot lives on, follows the bot's
   * next process first.
   */
  private refollow(): boolean {
    const { bot, row } = this.selected
    const b = this.current.bots[bot] as Bot
    if (queueIndex(b.queue, row) >= 0) return true
    if (!b.alive) return false
    this.selected = { bot, row: b.queue.front() }
    return true
  }

  private oneCycle(): Goal {
    return { kind: 'cycles', until: this.current.cycle + 1, stop: STEP }
  }

  private replace(battle: Battle): void {
    this.current = battle
    this.sink.attach(battle)
  }

  /**
   * Runs cycles until `goal`, a stop, or the end of the battle. A `fine` move is a run: its
   * cycles are stops for step back. `outSp` is `stepOut`'s SP.
   */
  private move(goal: Goal, fine: boolean, outSp = -1): DebugState {
    const battle = this.current
    const sink = this.sink
    sink.follow(this.selected, outSp)
    const cursor = goal.kind === 'cursor' ? goal.addr : -1
    let moved = false
    let stop: DebugStop
    for (;;) {
      // The first cycle runs unchecked: a move does not stop where it starts.
      const hit = moved ? this.check(cursor) : null
      if (hit !== null) {
        stop = hit
        break
      }
      const reached = this.reached(goal)
      if (reached !== null) {
        stop = reached
        break
      }
      if (battle.over) {
        stop = OVER
        break
      }
      if (!moved) {
        moved = true
        if (!(fine && this.continuing)) this.keep(fine)
      }
      battle.step()
      if (fine && battle.cycle % RUN_SNAPSHOT_INTERVAL === 0) this.keep(true)
    }
    if (moved) this.continuing = fine
    if (stop.kind === 'breakpoint' || stop.kind === 'int3' || stop.kind === 'cursor') {
      this.selected = { bot: stop.bot, row: stop.row }
    } else if (sink.fatal !== null && stop.kind !== 'died') {
      // It died during a run: follow the process of its bot that runs next, or the last one.
      const bot = this.selected.bot
      this.selected = { bot, row: rowOf(battle.bots[bot] as Bot) }
    }
    this.writes = sink.drain()
    this.stopped = stop
    return this.publish()
  }

  /** The stop of `goal` if the battle has reached it. */
  private reached(goal: Goal): DebugStop | null {
    const sink = this.sink
    switch (goal.kind) {
      case 'step':
        return sink.fatal ?? (sink.ran ? STEP : null)
      case 'over':
        return sink.fatal ?? ((this.followedRow()[IP] as number) === goal.ret ? STEP : null)
      case 'out':
        return sink.fatal ?? (sink.returned ? STEP : null)
      case 'cycles':
        return this.current.cycle >= goal.until ? goal.stop : null
      case 'cursor':
        return null
      case 'death':
        return (this.current.bots[goal.bot] as Bot).alive ? null : { kind: 'death', bot: goal.bot }
    }
  }

  /**
   * Checks the front process of each living bot, in the cycle's turn order, before the cycle
   * runs: each breakpoint that holds counts a hit, and the first process that stops the move,
   * at a breakpoint, an INT3, or the cursor, is the stop. Null when none does.
   */
  private check(cursor: number): DebugStop | null {
    const battle = this.current
    const { bytes, owner } = battle.core
    const bots = battle.bots
    const n = bots.length
    let stop: DebugStop | null = null
    let i = battle.cycle % n
    for (let k = 0; k < n; k++, i = i + 1 === n ? 0 : i + 1) {
      const bot = bots[i] as Bot
      const q = bot.queue
      if (q.size === 0) continue
      const row = q.front()
      const r = q.rows[row] as ProcRow
      const addr = r[IP] as number
      let hit: DebugStop | null = null
      if (this.bpAt[addr] === 1) {
        const bp = this.bps.get(addr) as BreakpointEntry
        const held = bp.condition === null ? true : testCondition(bp.condition, r)
        if (held !== false) {
          bp.hits++
          this.bpList = null
          const at = { kind: 'breakpoint', bot: i, row, addr } as const
          hit = typeof held === 'string' ? { ...at, error: held } : at
        }
      }
      if (hit === null && bytes[addr] === INT3 && owner[addr] === bot.tag) {
        hit = { kind: 'int3', bot: i, row, addr }
      }
      if (hit === null && addr === cursor) hit = { kind: 'cursor', bot: i, row, addr }
      if (stop === null) stop = hit
    }
    return stop
  }

  /** Keeps a snapshot for step back. */
  private keep(fine: boolean): void {
    this.marks.push({ snap: snapshot(this.current), fine })
    if (this.marks.length > HISTORY_DEPTH) this.marks.shift()
  }

  /** The state as it stands. */
  private read(): DebugState {
    const battle = this.current
    const { bot, row } = this.selected
    const q = (battle.bots[bot] as Bot).queue
    const r = q.rows[row] as ProcRow
    const first = this.marks[0]
    return Object.freeze({
      cycle: battle.cycle,
      over: battle.over,
      stop: this.stopped,
      selectedProc: Object.freeze({ bot, row, index: queueIndex(q, row) }),
      regs: Object.freeze({
        ax: r[AX] as number,
        bx: r[BX] as number,
        cx: r[CX] as number,
        dx: r[DX] as number,
        si: r[SI] as number,
        di: r[DI] as number,
        bp: r[BP] as number,
        sp: r[SP] as number,
      }),
      flags: r[FLAGS] as number,
      ip: r[IP] as number,
      lastWrites: this.writes,
      breakpoints: (this.bpList ??= [...this.bps.values()].sort((a, b) => a.addr - b.addr).map(view)),
      canStepBack: first !== undefined && first.snap.cycle < battle.cycle,
    })
  }

  private publish(): DebugState {
    const state = this.read()
    this.published = state
    for (const listener of this.listeners) listener(state)
    return state
  }
}

function view(bp: BreakpointEntry): Breakpoint {
  return Object.freeze({
    addr: bp.addr,
    enabled: bp.enabled,
    condition: bp.condition?.text ?? '',
    hits: bp.hits,
  })
}
