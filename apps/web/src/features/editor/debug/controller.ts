/**
 * The debugger's driver (PRODUCT_SPEC §3): the session of the bot in the editor, the moves the
 * transport and the keys ask for, and the runs, which go on over display frames so the page and
 * the arena strip keep drawing. A step is one call of the session; a run (`run`, `run N`, `run to
 * cursor`, `run until death`) is a part of a frame's time each frame, until the session stops it
 * or `pause` does. The page reads a `DebugSnapshot`: a new one after each move, and while a run
 * goes on at most every `RUN_PUBLISH_MS`, since the panels need not redraw at 60 fps.
 */
import type { BattleConfigInput, LoadedBot } from '@asmbots/engine'
import { animationFrame, type Schedule } from '../../arena/worker/client'
import type { Speed } from '../../arena/worker/protocol'
import { type Breakpoint, DebugSession, type DebugState, type RegisterEdit } from './session'

/** What a run goes on until, besides a breakpoint, an INT3, and the end of the battle. */
export type RunGoal =
  /** Nothing else: `run` (F5). */
  | { readonly kind: 'run' }
  /** `run N`: the battle's cycle reaching `until`. */
  | { readonly kind: 'cycles'; readonly until: number }
  /** `run to cursor`: a process about to run the instruction at `addr`. */
  | { readonly kind: 'cursor'; readonly addr: number }
  /** `run until death`: `bot` with no process left. */
  | { readonly kind: 'death'; readonly bot: number }

/** What the page shows of the debugger. */
export interface DebugSnapshot {
  /** The session, once a bot is loaded. */
  readonly session: DebugSession | null
  /** Its state as of this snapshot. */
  readonly state: DebugState | null
  /** The run going on, or null. */
  readonly running: RunGoal | null
  /** Cycles a run runs per display frame, or `max`: all a frame's budget allows. */
  readonly speed: Speed
  /** Why the last load failed, until the next one. */
  readonly error: string | null
}

/** The most time a run takes of a display frame, ms: the page draws in the rest. */
export const RUN_BUDGET_MS = 8
/** Cycles a run runs between two looks at the clock. */
const RUN_CHUNK = 2048
/** How often the snapshot follows a run, ms. */
export const RUN_PUBLISH_MS = 100
/** A run's speed until the page sets one: the next stop as soon as can be. */
export const DEFAULT_DEBUG_SPEED: Speed = 'max'

export interface DebugControllerOptions {
  /** The display frame that paces runs. Default: `animationFrame`. */
  readonly schedule?: Schedule
  /** The clock of the frame budget and the snapshot's pace, ms. */
  readonly now?: () => number
}

/** Drives one debug session at a time; `load` replaces it. */
export class DebugController {
  private readonly schedule: Schedule
  private readonly now: () => number
  private readonly listeners = new Set<() => void>()
  private current: DebugSnapshot = {
    session: null,
    state: null,
    running: null,
    speed: DEFAULT_DEBUG_SPEED,
    error: null,
  }
  private session: DebugSession | null = null
  private unsubscribe: (() => void) | null = null
  private running: RunGoal | null = null
  private cancelTick: (() => void) | null = null
  private publishedAt = Number.NEGATIVE_INFINITY
  /** In a move: its states show once, as it ends. */
  private moving = false
  private disposed = false

  constructor(options: DebugControllerOptions = {}) {
    this.schedule = options.schedule ?? animationFrame
    this.now = options.now ?? (() => performance.now())
  }

  /** The snapshot as of the last change. */
  get snapshot(): DebugSnapshot {
    return this.current
  }

  /** Calls `listener` after each new snapshot. Returns what stops the calls. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * A new session of `bots`, the debugged one first, placed by `config`'s seed: the old one goes,
   * and a run stops. Returns the session, or null when the bots do not fit, which the snapshot's
   * `error` then tells.
   */
  load(bots: readonly LoadedBot[], config: BattleConfigInput): DebugSession | null {
    this.stopRun()
    let session: DebugSession
    try {
      session = new DebugSession(bots, config)
    } catch (error) {
      this.drop()
      this.update({ error: error instanceof Error ? error.message : String(error) })
      return null
    }
    this.drop()
    this.session = session
    this.unsubscribe = session.subscribe(() => this.changed())
    this.update({ state: session.state, error: null })
    return session
  }

  /** No session: the bot does not assemble, and none was loaded. */
  unload(): void {
    this.stopRun()
    this.drop()
    this.update({ error: null })
  }

  /** Runs until the followed process has run one instruction (F11, `.`). */
  step(): void {
    this.move((s) => s.step())
  }

  /** Steps, over a `call` or a REP string instruction (F10). */
  stepOver(): void {
    this.move((s) => s.stepOver())
  }

  /** Runs until the followed process returns from its function (Shift+F11). */
  stepOut(): void {
    this.move((s) => s.stepOut())
  }

  /** Goes back one stop (`,`). False when nothing is left to go back to. */
  stepBack(): boolean {
    let back = false
    this.move((s) => {
      back = s.stepBack() !== null
    })
    return back
  }

  /** The battle from its start again, breakpoints kept. */
  reset(): void {
    this.move((s) => s.reset())
  }

  /** Follows process `row` of `bot`: its front process when `row` is left out. */
  select(bot: number, row?: number): void {
    this.session?.select(bot, row)
  }

  /** Changes the followed process's registers (the Registers panel). Pauses a run first. */
  setRegisters(edit: RegisterEdit): void {
    this.move((s) => s.setRegisters(edit))
  }

  /** Sets or clears the breakpoint at `addr`. Returns whether one is set now. */
  toggleBreakpoint(addr: number): boolean {
    return this.session?.toggleBreakpoint(addr) ?? false
  }

  /** Sets a breakpoint at `addr`, or changes it: as `DebugSession.setBreakpoint`. */
  setBreakpoint(
    addr: number,
    options?: { readonly condition?: string; readonly enabled?: boolean },
  ): Breakpoint | null {
    return this.session?.setBreakpoint(addr, options) ?? null
  }

  removeBreakpoint(addr: number): void {
    this.session?.removeBreakpoint(addr)
  }

  /**
   * Starts a run toward `goal` over the display frames: the next frame runs the first part. A
   * run going on stops first. Nothing without a session, or once the battle is over.
   */
  run(goal: RunGoal = { kind: 'run' }): void {
    const session = this.session
    if (session === null || session.state.over || this.disposed) return
    this.stopRun()
    this.running = goal
    this.update({})
    this.cancelTick = this.schedule(this.tick)
  }

  /** Stops the run going on, where it stands (F6). */
  pause(): void {
    if (this.running === null) return
    this.stopRun()
    this.update({})
  }

  /** Cycles per display frame for runs, or `max`. */
  setSpeed(speed: Speed): void {
    this.update({ speed })
  }

  /** Stops runs and lets the session go. The controller does nothing after this. */
  dispose(): void {
    this.disposed = true
    this.stopRun()
    this.drop()
    this.listeners.clear()
  }

  /** Runs `change` on the session, a run paused first, and shows the state it leaves. */
  private move(change: (session: DebugSession) => void): void {
    const session = this.session
    if (session === null) return
    if (this.running !== null) this.stopRun()
    this.moving = true
    try {
      change(session)
    } finally {
      this.moving = false
    }
    this.update({ state: session.state })
  }

  /** One display frame of a run: parts of it until the frame's budget, its speed, or a stop. */
  private readonly tick = (): void => {
    this.cancelTick = null
    const session = this.session
    const goal = this.running
    if (session === null || goal === null || this.disposed) return
    const { speed } = this.current
    const cap = speed === 'max' ? Number.POSITIVE_INFINITY : speed
    const deadline = this.now() + RUN_BUDGET_MS
    let ran = 0
    for (;;) {
      const before = session.state.cycle
      const part = Math.min(RUN_CHUNK, cap - ran)
      const state = this.runPart(session, goal, part)
      ran += state.cycle - before
      const done =
        state.over ||
        state.stop.kind !== 'cycles' ||
        (goal.kind === 'cycles' && state.cycle >= goal.until)
      if (done) {
        this.running = null
        this.update({ state })
        return
      }
      // A part that ran nothing waits for the next frame rather than asking again at once.
      if (state.cycle === before || ran >= cap || this.now() >= deadline) break
    }
    this.cancelTick = this.schedule(this.tick)
  }

  /** At most `cycles` cycles of a run toward `goal`. */
  private runPart(session: DebugSession, goal: RunGoal, cycles: number): DebugState {
    switch (goal.kind) {
      case 'run':
        return session.run(cycles)
      case 'cycles':
        return session.run(Math.max(0, Math.min(cycles, goal.until - session.state.cycle)))
      case 'cursor':
        return session.runToCursor(goal.addr, cycles)
      case 'death':
        return session.runUntilDeath(goal.bot, cycles)
    }
  }

  private stopRun(): void {
    this.cancelTick?.()
    this.cancelTick = null
    this.running = null
  }

  private drop(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    this.session = null
  }

  /** The session changed: the snapshot follows, at the run's pace while one goes on. */
  private changed(): void {
    const session = this.session
    if (session === null || this.moving) return
    if (this.running !== null && this.now() - this.publishedAt < RUN_PUBLISH_MS) return
    this.update({ state: session.state })
  }

  /** A new snapshot: the session and the run as they are, and `change`. */
  private update(change: {
    readonly state?: DebugState
    readonly speed?: Speed
    readonly error?: string | null
  }): void {
    const session = this.session
    this.current = {
      session,
      state: session === null ? null : (change.state ?? session.state),
      running: this.running,
      speed: change.speed ?? this.current.speed,
      error: change.error === undefined ? this.current.error : change.error,
    }
    this.publishedAt = this.now()
    for (const listener of this.listeners) listener()
  }
}
