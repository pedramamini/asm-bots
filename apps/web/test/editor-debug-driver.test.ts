/**
 * What drives the debugger: the arena strip's frames (`debug/source.ts`), which the arena's scene
 * must turn into the session's battle, and the controller (`debug/controller.ts`), whose runs go
 * on over display frames.
 */
import { describe, expect, it } from 'bun:test'
import { fighter } from '@asmbots/bots'
import type { Battle, Bot } from '@asmbots/engine'
import { ArenaScene } from '../src/features/arena/render/scene'
import type { FrameMessage } from '../src/features/arena/worker/protocol'
import { DebugController, RUN_PUBLISH_MS } from '../src/features/editor/debug/controller'
import { DebugSession } from '../src/features/editor/debug/session'
import { BattleSource } from '../src/features/editor/debug/source'

const DWARF = fighter('dwarf')
const IMP = fighter('imp')
const PAPER = fighter('paper')

/** Calls waiting for "the next frame", or "after this task": the test runs them. */
function manual() {
  const waiting: (() => void)[] = []
  return {
    schedule: (run: () => void) => {
      waiting.push(run)
      return () => {
        const i = waiting.indexOf(run)
        if (i >= 0) waiting.splice(i, 1)
      }
    },
    /** Runs what waits now; what it schedules waits for the next call. */
    flush: () => {
      for (const run of waiting.splice(0)) run()
    },
    get size() {
      return waiting.length
    },
  }
}

/** The first address where `a` and `b` differ, or -1. */
function firstDifference(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i
  return a.length === b.length ? -1 : a.length
}

/** The scene's core and owners as the battle's: the owner tags are the battle's, in load order. */
function expectDrawn(scene: ArenaScene, battle: Battle): void {
  expect(firstDifference(scene.bytes, battle.core.bytes)).toBe(-1)
  expect(firstDifference(scene.owner, battle.core.owner)).toBe(-1)
  expect(scene.cycle).toBe(battle.cycle)
}

describe('BattleSource', () => {
  function drawn(bots = [DWARF, PAPER]) {
    const session = new DebugSession(bots, { seed: 1 })
    const tasks = manual()
    const source = new BattleSource(session, { schedule: tasks.schedule })
    const scene = new ArenaScene(0)
    const frames: FrameMessage[] = []
    source.on('frame', (frame) => {
      frames.push(frame)
      scene.apply(frame)
    })
    let now = 0
    const settle = () => {
      tasks.flush()
      now += 16
      scene.advance(now)
    }
    return { session, source, scene, frames, settle, tasks }
  }

  it("draws the session's battle through runs, steps, step back, and reset", () => {
    const { session, scene, frames, settle } = drawn()
    // The canvas asks for the battle as it stands, whatever cycle it names.
    const one = drawn()
    one.source.seek(123)
    one.settle()
    expect(one.frames[0]?.ownerDirty).not.toBeNull()
    expectDrawn(one.scene, one.session.battle)

    session.run(300)
    settle()
    expect(frames[0]?.ownerDirty).not.toBeNull()
    expectDrawn(scene, session.battle)
    session.run(250)
    session.step()
    settle()
    expect(frames.at(-1)?.ownerDirty).toBeNull()
    expect(frames.at(-1)?.execs.length).toBeGreaterThan(0)
    expectDrawn(scene, session.battle)
    // A step back replaces the battle: the frame after it is full.
    session.stepBack()
    session.stepBack()
    settle()
    expect(frames.at(-1)?.ownerDirty).not.toBeNull()
    expectDrawn(scene, session.battle)
    session.run(40)
    settle()
    expect(frames.at(-1)?.ownerDirty).toBeNull()
    expectDrawn(scene, session.battle)
    session.reset()
    settle()
    expect(frames.at(-1)?.ownerDirty).not.toBeNull()
    expect(frames.at(-1)?.cycle).toBe(0)
    expectDrawn(scene, session.battle)
  })

  it('sends one frame for the moves of one task, with what they all did', () => {
    const { session, frames, settle, tasks } = drawn()
    session.step()
    settle()
    expect(frames).toHaveLength(1)
    session.step()
    session.step()
    session.run(10)
    expect(tasks.size).toBe(1)
    settle()
    expect(frames).toHaveLength(2)
    const frame = frames[1] as FrameMessage
    expect(frame.ownerDirty).toBeNull()
    expect(frame.cycle).toBe(13)
    // Both bots ran in each of the 12 cycles: the dwarf's code and the paper's are in the frame.
    const bots = new Set<number>()
    for (let i = 1; i < frame.execs.length; i += 2) bots.add(frame.execs[i] as number)
    expect([...bots].sort()).toEqual([0, 1])
  })

  it('keeps a store of the battle: its bots, placement, and where it stands', () => {
    const { session, source, settle } = drawn([DWARF, IMP])
    const state = () => source.store.getState()
    expect(state().status).toBe('paused')
    expect(state().botMeta.map((b) => b.name)).toEqual(['Dwarf', 'Imp'])
    expect(state().placements).toEqual(
      session.battle.bots.map((b: Bot) => ({ base: b.base, size: b.size })),
    )
    session.run(100)
    settle()
    expect(state().cycle).toBe(100)
    expect(state().alive).toBe(session.battle.alive)
    session.runUntilDeath(1)
    session.run(Number.POSITIVE_INFINITY)
    settle()
    expect(state().status).toBe('ended')
  })

  it('gives the session its tap back as it goes, and sends nothing after', () => {
    const { session, source, frames, settle } = drawn()
    expect(session.tap).not.toBeNull()
    session.step()
    source.dispose()
    expect(session.tap).toBeNull()
    settle()
    session.step()
    settle()
    expect(frames).toHaveLength(0)
  })
})

describe('DebugController', () => {
  function driven(bots = [DWARF, IMP]) {
    const frames = manual()
    let clock = 0
    const controller = new DebugController({ schedule: frames.schedule, now: () => clock })
    const seen: number[] = []
    controller.subscribe(() => seen.push(controller.snapshot.state?.cycle ?? -1))
    const session = controller.load(bots, { seed: 1 }) as DebugSession
    return {
      controller,
      session,
      frames,
      seen,
      tick: (ms = 16) => {
        clock += ms
        frames.flush()
      },
    }
  }

  it('loads a session, and says why when the bots do not fit', () => {
    const { controller, session } = driven()
    expect(controller.snapshot.session).toBe(session)
    expect(controller.snapshot.state).toBe(session.state)
    expect(controller.snapshot.error).toBeNull()
    expect(controller.load([DWARF, IMP], { minSpacing: 0x8000 })).toBeNull()
    expect(controller.snapshot.session).toBeNull()
    expect(controller.snapshot.error).toMatch(/place/)
    controller.load([DWARF], { seed: 2 })
    expect(controller.snapshot.error).toBeNull()
    controller.unload()
    expect(controller.snapshot.session).toBeNull()
  })

  it('shows each move once, as it ends', () => {
    const { controller, seen } = driven()
    seen.length = 0
    controller.step()
    controller.step()
    controller.stepBack()
    controller.stepOver()
    controller.reset()
    expect(seen).toEqual([1, 2, 1, 2, 0])
  })

  it('runs over display frames: the speed each frame, until a stop', () => {
    const { controller, session, tick } = driven()
    controller.setSpeed(100)
    controller.run()
    expect(controller.snapshot.running).toEqual({ kind: 'run' })
    expect(session.state.cycle).toBe(0)
    tick()
    expect(session.state.cycle).toBe(100)
    tick()
    expect(session.state.cycle).toBe(200)
    const base = (session.battle.bots[0] as Bot).base
    // The dwarf's `loop` is at base + 0x13: a breakpoint there stops the run on its next pass.
    controller.setBreakpoint(base + 0x13)
    tick()
    expect(controller.snapshot.running).toBeNull()
    expect(controller.snapshot.state?.stop).toMatchObject({ kind: 'breakpoint', addr: base + 0x13 })
    const at = session.state.cycle
    tick()
    expect(session.state.cycle).toBe(at)
  })

  it('pauses where the run stands, and a move pauses it first', () => {
    const { controller, session, tick, frames } = driven()
    controller.setSpeed(50)
    controller.run()
    tick()
    controller.pause()
    expect(controller.snapshot.running).toBeNull()
    expect(frames.size).toBe(0)
    expect(session.state.cycle).toBe(50)
    controller.run()
    tick()
    controller.step()
    expect(controller.snapshot.running).toBeNull()
    expect(session.state.cycle).toBe(101)
    tick()
    expect(session.state.cycle).toBe(101)
  })

  it('runs N cycles, to the cursor, and until a death, to the cycle', () => {
    const { controller, session, tick } = driven([DWARF, PAPER])
    controller.setSpeed(64)
    controller.run({ kind: 'cycles', until: 150 })
    for (let k = 0; k < 5; k++) tick()
    expect(session.state.cycle).toBe(150)
    expect(controller.snapshot.running).toBeNull()
    const base = (session.battle.bots[0] as Bot).base
    controller.run({ kind: 'cursor', addr: base + 0x0f })
    for (let k = 0; k < 5 && controller.snapshot.running !== null; k++) tick()
    expect(controller.snapshot.state?.stop).toMatchObject({ kind: 'cursor', addr: base + 0x0f })
    controller.setSpeed('max')
    controller.run({ kind: 'death', bot: 0 })
    // `max` runs a frame's budget of time: the fake clock moves 16 ms a look.
    let looks = 0
    for (let k = 0; k < 10_000 && controller.snapshot.running !== null; k++) {
      tick()
      looks++
    }
    expect(controller.snapshot.running).toBeNull()
    expect(['death', 'over']).toContain(controller.snapshot.state?.stop.kind as string)
    expect(looks).toBeGreaterThan(0)
  })

  it(`shows a run at most every ${RUN_PUBLISH_MS} ms, and its end at once`, () => {
    const { controller, seen, tick } = driven()
    controller.setSpeed(10)
    controller.run()
    seen.length = 0
    for (let k = 0; k < 12; k++) tick(20)
    // 240 ms of frames: a new snapshot at most every 100 ms.
    expect(seen.length).toBeLessThanOrEqual(3)
    expect(seen.length).toBeGreaterThan(0)
    controller.pause()
    expect(seen.at(-1)).toBe(120)
  })

  it('does nothing after dispose', () => {
    const { controller, frames } = driven()
    controller.dispose()
    controller.run()
    expect(frames.size).toBe(0)
    expect(controller.snapshot.running).toBeNull()
  })
})
