/**
 * The arena Worker's logic without the Worker (`src/features/arena/worker/session.ts`): each
 * request's messages checked against a battle run straight through by the engine.
 * `arena-worker.test.ts` runs the same protocol in a real Worker.
 */
import { describe, expect, it } from 'bun:test'
import { fighter } from '@asmbots/bots'
import {
  Battle,
  type BattleConfigInput,
  CORE_SIZE,
  fnv1a64,
  IP,
  type LoadedBot,
  NullSink,
  type ProcRow,
  RingSink,
  resultHash,
  simulate,
} from '@asmbots/engine'
import {
  type ArenaMessage,
  type ArenaRequest,
  type EndedMessage,
  type FrameMessage,
  IP_FRONT,
  KEYFRAME_INTERVAL,
  type LoadedMessage,
  MAX_KEYFRAMES,
} from '../src/features/arena/worker/protocol'
import { ArenaSession } from '../src/features/arena/worker/session'

/** Dwarf and Paper at seed 1 fight for 23,823 cycles, and Paper spawns throughout. */
const DUEL: readonly LoadedBot[] = [fighter('dwarf'), fighter('paper')]
const DUEL_CONFIG: BattleConfigInput = { seed: 1 }
/** Dwarf kills Imp in cycle 3,526 at seed 2: the battle is over after 3,527 cycles. */
const SHORT: readonly LoadedBot[] = [fighter('dwarf'), fighter('imp')]
const SHORT_CONFIG: BattleConfigInput = { seed: 2 }
const SHORT_END = 3527
/** Two bots that jump to themselves forever. */
const SPINNERS: readonly LoadedBot[] = [fighter('spin'), { ...fighter('spin'), name: 'Spin 2' }]

/** A battle run straight to `cycles` by the engine: what the session must agree with. */
function straight(bots: readonly LoadedBot[], config: BattleConfigInput, cycles: number): Battle {
  const battle = new Battle(bots, config)
  battle.run(cycles)
  return battle
}

function send(session: ArenaSession, request: ArenaRequest): ArenaMessage[] {
  return session.handle(request)
}

/** The one frame among `messages`. */
function frameIn(messages: readonly ArenaMessage[]): FrameMessage {
  const frames = messages.filter((m): m is FrameMessage => m.type === 'frame')
  expect(frames).toHaveLength(1)
  return frames[0] as FrameMessage
}

function loaded(session: ArenaSession, bots: readonly LoadedBot[], config: BattleConfigInput) {
  const messages = send(session, { type: 'load', bots, config })
  expect(messages.map((m) => m.type)).toEqual(['loaded', 'frame'])
  return { loaded: messages[0] as LoadedMessage, frame: messages[1] as FrameMessage }
}

/** The core as the renderer keeps it: a full frame's copy, then each frame's writes. */
class Mirror {
  readonly owner = new Uint8Array(CORE_SIZE)
  readonly bytes = new Uint8Array(CORE_SIZE)

  apply(frame: FrameMessage): void {
    if (frame.ownerDirty !== null) this.owner.set(frame.ownerDirty)
    if (frame.bytesDirty !== null) this.bytes.set(frame.bytesDirty)
    for (let i = 0; i < frame.writes.length; i += 2) {
      const a = frame.writes[i] as number
      const cell = frame.writes[i + 1] as number
      this.bytes[a] = cell & 0xff
      this.owner[a] = cell >> 8
    }
  }
}

/** Expects `frame` to match `battle`: cycle, bots alive, processes, and stats. */
function expectFrameOf(frame: FrameMessage, battle: Battle): void {
  expect(frame.cycle).toBe(battle.cycle)
  expect(frame.alive).toBe(battle.alive)
  expect(frame.over).toBe(battle.over)
  const result = battle.result()
  expect(Array.from(frame.stats)).toEqual(
    result.bots.flatMap((b) => [b.procs, b.footprint, b.writes]),
  )
  expect(Array.from(frame.ips)).toEqual(
    battle.bots.flatMap((bot) =>
      Array.from({ length: bot.queue.size }, (_, i) => [
        (bot.queue.rows[bot.queue.at(i)] as ProcRow)[IP] as number,
        i === 0 ? bot.index | IP_FRONT : bot.index,
      ]).flat(),
    ),
  )
}

/** The addresses of (address, value) pairs. */
function addresses(pairs: Uint16Array): number[] {
  return Array.from(pairs).filter((_, i) => i % 2 === 0)
}

describe('ArenaSession: load', () => {
  it('answers loaded, then a full frame at cycle 0', () => {
    const session = new ArenaSession()
    const { loaded: message, frame } = loaded(session, DUEL, DUEL_CONFIG)
    const battle = new Battle(DUEL, DUEL_CONFIG)
    expect(message.placements).toEqual(battle.bots.map((b) => ({ base: b.base, size: b.size })))
    expect(message.botMeta).toEqual([
      { ...fighter('dwarf').meta, name: 'Dwarf', size: 23 },
      { ...fighter('paper').meta, name: 'Paper', size: 34 },
    ])
    expect(message.config).toMatchObject({ seed: 1, maxCycles: 100_000, maxProcesses: 64 })

    expect(frame.ownerDirty).toEqual(battle.core.owner)
    expect(frame.bytesDirty).toEqual(battle.core.bytes)
    expect(frame.writes).toHaveLength(0)
    expect(frame.execs).toHaveLength(0)
    expect(frame.stats).toEqual(new Float32Array([1, 23, 0, 1, 34, 0]))
    expectFrameOf(frame, battle)
    expect(Array.from(frame.ips)).toEqual([
      battle.bots[0]?.base,
      IP_FRONT,
      battle.bots[1]?.base,
      1 | IP_FRONT,
    ])
  })

  it('refuses bots that do not fit, and keeps the battle it had', () => {
    const session = new ArenaSession()
    loaded(session, DUEL, DUEL_CONFIG)
    const [error] = send(session, {
      type: 'load',
      bots: DUEL,
      config: { seed: 1, minSpacing: 40_000 },
    })
    expect(error).toMatchObject({ type: 'error', request: 'load' })
    expect((error as { message: string }).message).toContain('cannot place bot 1')
    expectFrameOf(
      frameIn(send(session, { type: 'step', cycles: 10 })),
      straight(DUEL, DUEL_CONFIG, 10),
    )
  })

  it('answers an error to a request before the first load', () => {
    const session = new ArenaSession()
    for (const request of [
      { type: 'step', cycles: 1 },
      { type: 'seek', cycle: 0 },
      { type: 'play' },
      { type: 'requestFrame' },
      { type: 'setRound', seed: 3 },
    ] as const) {
      expect(send(session, request)).toEqual([
        { type: 'error', request: request.type, message: 'no battle: load one first' },
      ])
    }
    expect(send(session, { type: 'pause' })).toEqual([])
    expect(send(session, { type: 'speed', cyclesPerFrame: 50 })).toEqual([])
  })

  it('refuses a bad count, cycle, or speed', () => {
    const session = new ArenaSession()
    loaded(session, DUEL, DUEL_CONFIG)
    const bad: ArenaRequest[] = [
      { type: 'step', cycles: -3 },
      { type: 'step', cycles: 1.5 },
      { type: 'seek', cycle: -1 },
      { type: 'seek', cycle: Number.NaN },
      { type: 'speed', cyclesPerFrame: 0 },
      { type: 'speed', cyclesPerFrame: 10_001 },
      { type: 'speed', cyclesPerFrame: 2.5 },
    ]
    for (const request of bad) {
      const messages = send(session, request)
      expect(messages).toHaveLength(1)
      expect(messages[0]).toMatchObject({ type: 'error', request: request.type })
    }
  })
})

describe('ArenaSession: frames', () => {
  it('steps exactly, and a mirror of the frames stays the core', () => {
    const session = new ArenaSession()
    const mirror = new Mirror()
    mirror.apply(loaded(session, DUEL, DUEL_CONFIG).frame)
    let cycle = 0
    for (const cycles of [1, 1, 7, 100, 999, 2000, 3, 4321]) {
      const frame = frameIn(send(session, { type: 'step', cycles }))
      cycle += cycles
      const battle = straight(DUEL, DUEL_CONFIG, cycle)
      expectFrameOf(frame, battle)
      expect(frame.ownerDirty).toBeNull()
      mirror.apply(frame)
      expect(fnv1a64(mirror.owner)).toBe(fnv1a64(battle.core.owner))
      expect(fnv1a64(mirror.bytes)).toBe(fnv1a64(battle.core.bytes))
      // Each byte at most once a frame.
      expect(new Set(addresses(frame.writes)).size).toBe(frame.writes.length / 2)
      expect(new Set(addresses(frame.execs)).size).toBe(frame.execs.length / 2)
    }
  })

  it('marks every byte of each instruction run, with the bot that ran it', () => {
    const session = new ArenaSession()
    loaded(session, DUEL, DUEL_CONFIG)
    const runs = new Map<number, number>()
    const sink = new (class extends NullSink {
      override exec(_c: number, bot: number, _p: number, addr: number, len: number): void {
        for (let k = 0; k < len; k++) runs.set((addr + k) & 0xffff, bot)
      }
    })()
    new Battle(DUEL, DUEL_CONFIG, sink).run(40)
    const frame = frameIn(send(session, { type: 'step', cycles: 40 }))
    const got = new Map<number, number>()
    for (let i = 0; i < frame.execs.length; i += 2) {
      got.set(frame.execs[i] as number, frame.execs[i + 1] as number)
    }
    expect(got).toEqual(runs)
  })

  it('passes spawns, deaths, and bot deaths on as RingSink records, oldest first', () => {
    const session = new ArenaSession()
    loaded(session, DUEL, DUEL_CONFIG)
    const frames: FrameMessage[] = []
    for (let cycle = 0; cycle < 30_000; cycle += 2500) {
      frames.push(frameIn(send(session, { type: 'step', cycles: 2500 })))
    }
    const rings = new RingSink(1 << 15)
    new Battle(DUEL, DUEL_CONFIG, rings).run()
    const joined = (pick: (f: FrameMessage) => Uint32Array) =>
      frames.flatMap((f) => Array.from(pick(f)))
    expect(joined((f) => f.spawns)).toEqual(Array.from(rings.spawns.drain()))
    expect(joined((f) => f.deaths)).toEqual(Array.from(rings.deaths.drain()))
    expect(joined((f) => f.botDeaths)).toEqual(Array.from(rings.botDeaths.drain()))
    expect(joined((f) => f.spawns).length).toBeGreaterThan(0)
    expect(joined((f) => f.botDeaths)).toHaveLength(2)
  })

  it('gives each typed array a buffer of its own, so a transfer list has no repeats', () => {
    const session = new ArenaSession()
    const full = loaded(session, DUEL, DUEL_CONFIG).frame
    const activity = frameIn(send(session, { type: 'step', cycles: 500 }))
    for (const frame of [full, activity]) {
      const { writes, execs, ips, spawns, deaths, botDeaths, stats, ownerDirty, bytesDirty } = frame
      const arrays = [writes, execs, ips, spawns, deaths, botDeaths, stats, ownerDirty, bytesDirty]
      const buffers = arrays.flatMap((a) => (a === null ? [] : [a.buffer]))
      expect(new Set(buffers).size).toBe(buffers.length)
    }
  })

  it('ends once with the engine result, and again after a seek back', () => {
    const session = new ArenaSession()
    loaded(session, SHORT, SHORT_CONFIG)
    const want = simulate(SHORT, SHORT_CONFIG)
    expect(want.cycles).toBe(SHORT_END)

    const messages = send(session, { type: 'step', cycles: 10_000 })
    expect(messages.map((m) => m.type)).toEqual(['frame', 'ended'])
    expect(frameIn(messages)).toMatchObject({ cycle: SHORT_END, over: true, alive: 1 })
    expect(Array.from(frameIn(messages).botDeaths)).toEqual([SHORT_END - 1, 1])
    const ended = messages[1] as EndedMessage
    expect(ended.result).toEqual(want)
    expect(ended.hash).toBe(resultHash(want))

    expect(send(session, { type: 'step', cycles: 1 }).map((m) => m.type)).toEqual(['frame'])
    expect(send(session, { type: 'seek', cycle: 1000 }).map((m) => m.type)).toEqual(['frame'])
    expect(send(session, { type: 'step', cycles: 10_000 }).map((m) => m.type)).toEqual([
      'frame',
      'ended',
    ])
  })
})

describe('ArenaSession: seek', () => {
  it('seeks back from 6,000 to 5,000: the owner map is a fresh run to 5,000', () => {
    const session = new ArenaSession()
    loaded(session, DUEL, DUEL_CONFIG)
    expect(frameIn(send(session, { type: 'step', cycles: 6000 })).cycle).toBe(6000)
    const frame = frameIn(send(session, { type: 'seek', cycle: 5000 }))
    const battle = straight(DUEL, DUEL_CONFIG, 5000)
    expect(fnv1a64(frame.ownerDirty as Uint8Array)).toBe(fnv1a64(battle.core.owner))
    expect(fnv1a64(frame.bytesDirty as Uint8Array)).toBe(fnv1a64(battle.core.bytes))
    expectFrameOf(frame, battle)
    expect(frame.writes).toHaveLength(0)
    expect(frame.spawns).toHaveLength(0)
  })

  it('lands on the target from anywhere, and plays on from it', () => {
    const session = new ArenaSession()
    const mirror = new Mirror()
    mirror.apply(loaded(session, DUEL, DUEL_CONFIG).frame)
    frameIn(send(session, { type: 'step', cycles: 9000 }))
    // Back to a keyframe, back between keyframes, before any keyframe, forward to a keyframe ahead
    // of the battle, forward with none ahead (it runs on), past the end, and back from the end.
    for (const target of [5000, 5500, 5999, 500, 8000, 8900, 12_345, 99_999, 23_000]) {
      const frame = frameIn(send(session, { type: 'seek', cycle: target }))
      const battle = straight(DUEL, DUEL_CONFIG, target)
      expectFrameOf(frame, battle)
      mirror.apply(frame)
      expect(fnv1a64(mirror.owner)).toBe(fnv1a64(battle.core.owner))
      expect(Array.from(frame.botDeaths)).toEqual(
        battle.bots.flatMap((b) =>
          b.stats.deathCycle === null ? [] : [b.stats.deathCycle, b.index],
        ),
      )

      const next = frameIn(send(session, { type: 'step', cycles: 777 }))
      const after = straight(DUEL, DUEL_CONFIG, battle.cycle + 777)
      expectFrameOf(next, after)
      mirror.apply(next)
      expect(fnv1a64(mirror.owner)).toBe(fnv1a64(after.core.owner))
      expect(fnv1a64(mirror.bytes)).toBe(fnv1a64(after.core.bytes))
    }
  })

  it('stops a seek past the end at the end, and at maxCycles', () => {
    const session = new ArenaSession()
    loaded(session, SHORT, SHORT_CONFIG)
    const messages = send(session, { type: 'seek', cycle: 50_000 })
    expect(messages.map((m) => m.type)).toEqual(['frame', 'ended'])
    expect(frameIn(messages)).toMatchObject({ cycle: SHORT_END, over: true })

    loaded(session, SPINNERS, { maxCycles: 2000 })
    expect(frameIn(send(session, { type: 'seek', cycle: 5000 }))).toMatchObject({
      cycle: 2000,
      over: true,
      alive: 2,
    })
  })

  it('keeps a keyframe every 1,000 cycles, at most 128, the nearest the playhead', () => {
    const session = new ArenaSession()
    loaded(session, SPINNERS, { maxCycles: 200_000 })
    frameIn(send(session, { type: 'step', cycles: 130_500 }))
    const range = (from: number, to: number) =>
      Array.from({ length: (to - from) / KEYFRAME_INTERVAL + 1 }, (_, i) => from + i * 1000)
    expect(session.keyframeCycles()).toEqual(range(3000, 130_000))
    expect(session.keyframeCycles()).toHaveLength(MAX_KEYFRAMES)

    // Before the oldest keyframe: a fresh battle runs to 1,500 and keeps 1,000 again, which
    // drops 130,000, the keyframe farthest from it.
    expect(frameIn(send(session, { type: 'seek', cycle: 1500 })).cycle).toBe(1500)
    expect(session.keyframeCycles()).toEqual([1000, ...range(3000, 129_000)])
    const back = frameIn(send(session, { type: 'seek', cycle: 129_500 }))
    expectFrameOf(back, straight(SPINNERS, { maxCycles: 200_000 }, 129_500))
  })
})

describe('ArenaSession: playback', () => {
  it('runs nothing while paused, and speed cycles a frame while playing', () => {
    const session = new ArenaSession()
    loaded(session, DUEL, DUEL_CONFIG)
    expect(frameIn(send(session, { type: 'requestFrame' })).cycle).toBe(0)
    expect(send(session, { type: 'speed', cyclesPerFrame: 250 })).toEqual([])
    expect(send(session, { type: 'play' })).toEqual([])
    expect(frameIn(send(session, { type: 'requestFrame' })).cycle).toBe(250)
    const frame = frameIn(send(session, { type: 'requestFrame' }))
    expectFrameOf(frame, straight(DUEL, DUEL_CONFIG, 500))
    send(session, { type: 'pause' })
    expect(frameIn(send(session, { type: 'requestFrame' })).cycle).toBe(500)
  })

  it('stops a frame at the budget: max runs until it, a set speed runs short of its count', () => {
    let clock: number[] = []
    const session = new ArenaSession(() => clock.shift() ?? 1e9)
    loaded(session, DUEL, DUEL_CONFIG)
    send(session, { type: 'play' })
    send(session, { type: 'speed', cyclesPerFrame: 'max' })
    // Start at 0 (a 12 ms budget), 5 ms after the first chunk, past the budget after the second.
    clock = [0, 5, 100]
    expect(frameIn(send(session, { type: 'requestFrame' })).cycle).toBe(2 * 256)
    send(session, { type: 'speed', cyclesPerFrame: 10_000 })
    clock = [0, 100]
    // A chunk ends at the next keyframe cycle, 1,000, too.
    expect(frameIn(send(session, { type: 'requestFrame' })).cycle).toBe(768)
    clock = [0, 100]
    expect(frameIn(send(session, { type: 'requestFrame' })).cycle).toBe(1000)
  })

  it('plays a battle to its end at max with the real clock', () => {
    const session = new ArenaSession()
    loaded(session, DUEL, DUEL_CONFIG)
    send(session, { type: 'speed', cyclesPerFrame: 'max' })
    send(session, { type: 'play' })
    const messages: ArenaMessage[] = []
    for (let i = 0; i < 1000 && !messages.some((m) => m.type === 'ended'); i++) {
      messages.push(...send(session, { type: 'requestFrame' }))
    }
    const ended = messages.find((m): m is EndedMessage => m.type === 'ended')
    expect(ended?.result).toEqual(simulate(DUEL, DUEL_CONFIG))
    // The end turns playing off: another frame runs nothing.
    expect(frameIn(send(session, { type: 'requestFrame' })).cycle).toBe(ended?.result.cycles)
  })

  it('setRound places the same bots with a new seed, paused at cycle 0', () => {
    const session = new ArenaSession()
    loaded(session, DUEL, DUEL_CONFIG)
    send(session, { type: 'play' })
    frameIn(send(session, { type: 'step', cycles: 3000 }))
    const messages = send(session, { type: 'setRound', seed: 2 })
    expect(messages.map((m) => m.type)).toEqual(['loaded', 'frame'])
    const battle = new Battle(DUEL, { seed: 2 })
    expect((messages[0] as LoadedMessage).placements).toEqual(
      battle.bots.map((b) => ({ base: b.base, size: b.size })),
    )
    expect((messages[0] as LoadedMessage).config.seed).toBe(2)
    expect(frameIn(messages).ownerDirty).toEqual(battle.core.owner)
    expect(session.keyframeCycles()).toEqual([])
    expect(frameIn(send(session, { type: 'requestFrame' })).cycle).toBe(0)
    expectFrameOf(
      frameIn(send(session, { type: 'step', cycles: 42 })),
      straight(DUEL, { seed: 2 }, 42),
    )
  })
})
