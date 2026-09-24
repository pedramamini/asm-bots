/**
 * The arena strip's frames (PRODUCT_SPEC §3): the debugger's battle, drawn by the arena's renderer
 * with no Worker. `BattleSource` is what `ArenaCanvas` takes as its client: it taps the session's
 * events with the arena Worker's frame builder (`arena/worker/frames.ts`), and after the moves of
 * a task it sends one frame of what they did. A step back and a reset replace the session's
 * battle; the frame after one is a full frame, so the strip starts over from the battle as it is.
 */
import type { Battle } from '@asmbots/engine'
import { createStore, type StoreApi } from 'zustand'
import type { FrameSource } from '../../arena/ArenaCanvas'
import { type ArenaEvents, type ArenaState, INITIAL_ARENA_STATE } from '../../arena/worker/client'
import { FrameBuilder } from '../../arena/worker/frames'
import type { FrameMessage } from '../../arena/worker/protocol'
import type { DebugSession } from './session'

type Listeners = { [K in keyof ArenaEvents]: Set<(message: ArenaEvents[K]) => void> }

/** A full frame carries the keyframes a seek lands on fast: the debugger has none. */
const NO_KEYFRAMES = new Uint32Array(0)

export interface BattleSourceOptions {
  /** Runs `flush` after the current task: coalesces the moves of one task into one frame. */
  readonly schedule?: (flush: () => void) => void
}

/**
 * The frames of `session`'s battle, for an `ArenaCanvas`. It takes the session's tap while it
 * lives: `dispose` gives it back.
 */
export class BattleSource implements FrameSource {
  readonly store: StoreApi<ArenaState>
  private readonly session: DebugSession
  private readonly frames = new FrameBuilder()
  private readonly schedule: (flush: () => void) => void
  private readonly listeners: Listeners = {
    loaded: new Set(),
    frame: new Set(),
    ended: new Set(),
    error: new Set(),
  }
  /** The battle the last frame showed: another one, and the next frame is full. */
  private shown: Battle | null = null
  private full = true
  private pending = false
  private readonly off: () => void

  constructor(session: DebugSession, options: BattleSourceOptions = {}) {
    this.session = session
    // Called bare: `queueMicrotask` as a method of the source throws.
    this.schedule = options.schedule ?? ((flush) => queueMicrotask(flush))
    const { battle } = session
    this.frames.setOrder(battle.bots.map((_, i) => i))
    this.frames.watch.reset(battle.core.owner)
    session.tap = this.frames.sink
    this.store = createStore<ArenaState>()(() => ({
      ...INITIAL_ARENA_STATE,
      status: battle.over ? 'ended' : 'paused',
      cycle: battle.cycle,
      alive: battle.alive,
      placements: battle.bots.map((b) => ({ base: b.base, size: b.size })),
      botMeta: battle.bots.map((b) => ({ ...b.meta, name: b.name, size: b.size })),
      config: battle.config,
      order: battle.bots.map((_, i) => i),
      reached: battle.cycle,
    }))
    this.off = session.subscribe(() => this.request())
  }

  /** Calls `listener` with each message of `type`: only frames come. Returns what stops it. */
  on<K extends keyof ArenaEvents>(
    type: K,
    listener: (message: ArenaEvents[K]) => void,
  ): () => void {
    const listeners = this.listeners[type]
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  /**
   * A full frame of the battle as it stands, whatever `cycle` asks: the canvas asks for one as it
   * mounts. The session, not the strip, moves the debugger's battle.
   */
  seek(_cycle: number): void {
    this.full = true
    this.request()
  }

  /** Gives the session its tap back. The source sends nothing after this. */
  dispose(): void {
    this.off()
    if (this.session.tap === this.frames.sink) this.session.tap = null
    for (const listeners of Object.values(this.listeners)) listeners.clear()
    this.pending = false
  }

  private request(): void {
    if (this.pending) return
    this.pending = true
    this.schedule(this.flush)
  }

  private readonly flush = (): void => {
    if (!this.pending) return
    this.pending = false
    const battle = this.session.battle
    let frame: FrameMessage
    if (this.full || battle !== this.shown) {
      if (battle !== this.shown) {
        // A step back or a reset: the watch reads the new core's owners from here on.
        if (battle.cycle === 0) this.frames.watch.reset(battle.core.owner)
        else this.frames.watch.owner = battle.core.owner
      }
      frame = this.frames.full(battle, NO_KEYFRAMES)
      this.shown = battle
      this.full = false
    } else {
      frame = this.frames.activity(battle, null)
    }
    this.frames.sink.next()
    this.store.setState({
      status: battle.over ? 'ended' : 'paused',
      cycle: frame.cycle,
      alive: frame.alive,
      stats: frame.stats,
      reached: frame.cycle,
    })
    for (const listener of this.listeners.frame) listener(frame)
  }
}
