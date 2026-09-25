/**
 * The arena's sound (DESIGN_SYSTEM §7): the engine on a fake `AudioContext` (no context before
 * the first gesture, nothing while muted or with a cue off, the budget, coalesced writes, the
 * master volume), and the cues a battle's messages sound (`attachArenaSound`).
 */
import { describe, expect, it, mock } from 'bun:test'
import type { Result } from '@asmbots/engine'
import type { MatchResult, MatchRound } from '@asmbots/tourney'
import { type ArenaEvents, createArenaStore } from '../src/features/arena/worker/client'
import {
  BOT_DEATH_FIELDS,
  DEATH_FIELDS,
  type EndedMessage,
  type LoadedMessage,
} from '../src/features/arena/worker/protocol'
import { attachArenaSound, TICK_CYCLES } from '../src/features/sound/arena'
import {
  botPitch,
  CUE_LIMITS,
  MAX_CUES_PER_SECOND,
  masterLevel,
  SoundEngine,
  WRITE_WINDOW_MS,
  weightLevel,
} from '../src/features/sound/engine'
import { DEFAULT_SETTINGS, SOUND_CUES, type SoundSettings } from '../src/store/settings'
import { emptyFrame } from './arena-frame'
import { type FakeAudioContext, FakeBufferSource, fakeContexts } from './fake-audio'

/** The default settings with sound on, and `parts` over them. */
function soundOn(parts: Partial<SoundSettings> = {}): SoundSettings {
  return { ...structuredClone(DEFAULT_SETTINGS.sound), on: true, ...parts }
}

/** A key press, as the page's gestures come. */
function key(name: string): Event {
  return Object.assign(new Event('keydown'), { key: name })
}

/**
 * An engine on fake contexts, with a clock the test moves. `activated`: the page has had a
 * gesture before the engine started.
 */
function engineOf({
  activated = true,
  state = 'running' as AudioContextState,
  settings = soundOn(),
} = {}) {
  const contexts = fakeContexts(state)
  const gestures = new EventTarget()
  const clock = { now: 0 }
  const engine = new SoundEngine({
    createContext: contexts.createContext,
    gestures,
    activated: () => activated,
    now: () => clock.now,
  })
  engine.configure(settings)
  const context = () => contexts.made[0] as FakeAudioContext
  return { engine, gestures, clock, made: contexts.made, context }
}

/** Lets promise callbacks run: a context's `resume`, and what waits on it. */
async function microtasks(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve()
}

describe('SoundEngine', () => {
  it('makes no AudioContext before a gesture, and makes one at the first', () => {
    const { engine, gestures, made, context } = engineOf({ activated: false })
    for (const cue of SOUND_CUES) expect(engine.play(cue)).toBe(false)
    expect(engine.preview('click')).toBe(false)
    expect(made).toHaveLength(0)
    // `esc` gives the page no activation.
    gestures.dispatchEvent(key('Escape'))
    expect([engine.unlocked, made.length]).toEqual([false, 0])
    gestures.dispatchEvent(key('a'))
    // Made in the gesture itself, since sound is on: a browser lets it start there.
    expect([engine.unlocked, made.length]).toEqual([true, 1])
    expect(engine.play('victory')).toBe(true)
    expect(
      context()
        .oscillators()
        .map((note) => note.frequency.changes[0]?.value),
    ).toEqual([440, 659.26, 880])
    expect(made).toHaveLength(1)
  })

  it('makes none at a gesture while sound is off, and one when it comes on', () => {
    const { engine, gestures, made } = engineOf({
      activated: false,
      settings: DEFAULT_SETTINGS.sound,
    })
    gestures.dispatchEvent(new Event('mousedown'))
    expect([engine.unlocked, made.length]).toEqual([true, 0])
    expect(engine.play('click')).toBe(false)
    engine.configure(soundOn())
    expect(made).toHaveLength(1)
  })

  it('needs no new gesture on a page that has had one', () => {
    const { engine, made } = engineOf({ activated: true })
    expect(made).toHaveLength(1)
    expect(engine.play('tick')).toBe(true)
  })

  it('schedules no cue while muted, and none that is turned off', async () => {
    const { engine, clock, context } = engineOf()
    expect(engine.play('tick')).toBe(true)
    const started = context().started.length
    engine.configure(soundOn({ on: false }))
    expect(context().state).toBe('suspended')
    for (const cue of SOUND_CUES) {
      clock.now += 1000
      expect([cue, engine.play(cue), engine.preview(cue)]).toEqual([cue, false, false])
    }
    expect(context().started).toHaveLength(started)
    const cues = { ...DEFAULT_SETTINGS.sound.cues, victory: false }
    engine.configure(soundOn({ cues }))
    await microtasks()
    expect(context().state).toBe('running')
    clock.now += 1000
    expect(engine.play('victory')).toBe(false)
    expect(context().started).toHaveLength(started)
    // The settings page previews a cue whatever its switch.
    expect(engine.preview('victory')).toBe(true)
    expect(context().started).toHaveLength(started + 3)
  })

  it('stops listening once disposed', () => {
    const { engine, gestures, made } = engineOf({ activated: false })
    engine.dispose()
    gestures.dispatchEvent(key('a'))
    expect([engine.unlocked, made.length]).toEqual([false, 0])
  })

  it('plays at most 12 cues a second, and keeps room for the story', () => {
    const { engine, clock } = engineOf()
    const played = Array.from({ length: 20 }, () => engine.play('botDeath'))
    expect(played.filter(Boolean)).toHaveLength(MAX_CUES_PER_SECOND)
    clock.now = 999
    expect(engine.play('victory')).toBe(false)
    // A second after the first: the window has room again.
    clock.now = 1000
    expect(engine.play('victory')).toBe(true)
  })

  it('spaces the frequent cues, and lets them fill only part of the second', () => {
    const { engine, clock } = engineOf()
    const { ambient, ui } = CUE_LIMITS
    expect(engine.play('tick')).toBe(true)
    clock.now = ambient.gap - 1
    expect(engine.play('death')).toBe(false)
    clock.now = ambient.gap
    expect(engine.play('death')).toBe(true)

    const busy = engineOf()
    // Eight story cues: the frequent cues have no room left, the clicks two more, the story four.
    for (let i = 0; i < ambient.ceiling; i++) expect(busy.engine.play('botDeath')).toBe(true)
    expect(busy.engine.play('tick')).toBe(false)
    expect(busy.engine.play('click')).toBe(true)
    busy.clock.now = ui.gap - 1
    expect(busy.engine.play('click')).toBe(false)
    busy.clock.now = ui.gap
    expect(busy.engine.play('click')).toBe(true)
    busy.clock.now = 2 * ui.gap
    expect(busy.engine.play('click')).toBe(false)
    expect([busy.engine.play('botDeath'), busy.engine.play('victory')]).toEqual([true, true])
    expect(busy.engine.play('botDeath')).toBe(false)
  })

  it('coalesces writes into a click a window, as loud as the writes it stands for', () => {
    const { engine, clock, context } = engineOf()
    const clickPeak = () => (context().gains.at(-1)?.gain.peak ?? 0) - 0.1
    expect(engine.play('write', { weight: 1 })).toBe(true)
    expect(context().started.at(-1)).toBeInstanceOf(FakeBufferSource)
    expect(clickPeak()).toBeCloseTo(0.25 * weightLevel(1))
    clock.now = 100
    expect(engine.play('write', { weight: 5 })).toBe(false)
    clock.now = 200
    expect(engine.play('write', { weight: 10 })).toBe(false)
    clock.now = WRITE_WINDOW_MS
    expect(engine.play('write', { weight: 1 })).toBe(true)
    expect(clickPeak()).toBeCloseTo(0.25 * weightLevel(16))
    expect(context().started).toHaveLength(2)
    // A write the budget turns away (a tick just played) counts toward the next click too.
    clock.now = 2 * WRITE_WINDOW_MS
    expect(engine.play('tick')).toBe(true)
    expect(engine.play('write', { weight: 3 })).toBe(false)
    clock.now += CUE_LIMITS.ambient.gap
    expect(engine.play('write', { weight: 2 })).toBe(true)
    expect(clickPeak()).toBeCloseTo(0.25 * weightLevel(5))
  })

  it('sets the master gain from the volume', () => {
    const { engine, context } = engineOf({ settings: soundOn({ volume: 0.5 }) })
    const master = context().gains[0]
    expect(master?.gain.value).toBe(masterLevel(0.5))
    engine.configure(soundOn({ volume: 0.8 }))
    expect(master?.gain.value).toBeCloseTo(0.64)
    expect(masterLevel(0)).toBe(0)
  })

  it('plays a preview once a context that is starting runs, but drops cues meanwhile', async () => {
    const { engine, context } = engineOf({ state: 'suspended' })
    expect(context().state).toBe('suspended')
    expect(engine.play('click')).toBe(false)
    expect(engine.preview('click')).toBe(true)
    expect(context().started).toHaveLength(0)
    await microtasks()
    expect(context().state).toBe('running')
    expect(context().started).toHaveLength(1)
  })

  it('makes nothing where there is no WebAudio', () => {
    const engine = new SoundEngine({
      createContext: () => null,
      gestures: null,
      activated: () => true,
    })
    engine.configure(soundOn())
    expect(engine.play('victory')).toBe(false)
  })

  it('drops a bot’s death from its own pitch, a pentatonic step a hue', () => {
    const { engine, context } = engineOf()
    engine.play('botDeath', { bot: 5 })
    const tone = context().oscillators()[0]
    expect(tone?.frequency.changes.map((change) => change.value)).toEqual([
      botPitch(5),
      botPitch(5) / 4,
    ])
    expect(botPitch(0)).toBeCloseTo(329.63)
    expect(botPitch(5)).toBeCloseTo(659.26)
    expect(botPitch(12)).toBe(botPitch(0))
  })
})

/** A client's `on` and `store`, whose messages the test sends. */
function fakeClient() {
  const listeners = new Map<string, Set<(message: never) => void>>()
  return {
    store: createArenaStore(),
    on<K extends keyof ArenaEvents>(type: K, listener: (message: ArenaEvents[K]) => void) {
      const set = listeners.get(type) ?? new Set()
      listeners.set(type, set)
      set.add(listener as (message: never) => void)
      return () => set.delete(listener as (message: never) => void)
    },
    emit<K extends keyof ArenaEvents>(type: K, message: ArenaEvents[K]) {
      for (const listener of listeners.get(type) ?? [])
        (listener as (m: ArenaEvents[K]) => void)(message)
    },
  }
}

/** The cues `play` was asked for, with their options. */
function player() {
  const play = mock((_cue: string, _options?: object) => true)
  const calls = () => play.mock.calls.map(([cue, options]) => (options ? [cue, options] : [cue]))
  return { play, calls }
}

const LOADED = { type: 'loaded' } as LoadedMessage
const FULL = { ownerDirty: new Uint8Array(0), bytesDirty: new Uint8Array(0) }

/** Records of `fields` fields each, from `values`. */
function records(fields: number, ...values: number[][]): Uint32Array {
  return new Uint32Array(
    values.flatMap((record) => [...record, ...Array(fields).fill(0)].slice(0, fields)),
  )
}

/** A round in which `survivors` stand, for `ended`. */
function roundOf(survivors: number[], points: number[]): MatchRound {
  return {
    round: 0,
    seed: 1,
    order: points.map((_, i) => i),
    resultHash: 'x',
    durationCycles: 100,
    points,
    survivors,
    survival: points.map(() => 100),
  }
}

/** The `ended` of a match of `of` rounds after `rounds`: the last round's bots alive as `alive`. */
function endedOf(of: number, rounds: MatchRound[], alive: boolean[]): EndedMessage {
  const points = alive.map((_, i) => rounds.reduce((sum, r) => sum + (r.points[i] ?? 0), 0))
  const match: MatchResult = {
    key: 'k',
    names: alive.map((_, i) => `bot ${i}`),
    of,
    rounds,
    points,
  }
  const result = { cycles: 100, bots: alive.map((up) => ({ alive: up })) } as unknown as Result
  return { type: 'ended', result, hash: 'x', round: rounds.length - 1, match }
}

describe('attachArenaSound', () => {
  it('sounds a frame’s deaths and writes, and ticks at a few cycles a frame', () => {
    const client = fakeClient()
    const { play, calls } = player()
    attachArenaSound(client, { play })
    client.emit('loaded', LOADED)
    client.emit('frame', emptyFrame({ cycle: 0, ...FULL }))
    expect(calls()).toEqual([])
    client.emit('frame', emptyFrame({ cycle: 1, writes: new Uint16Array([5, 0x0101, 6, 0x0102]) }))
    expect(calls()).toEqual([['write', { weight: 2 }], ['tick']])
    play.mockClear()
    client.emit(
      'frame',
      emptyFrame({
        cycle: 1 + TICK_CYCLES + 1,
        deaths: records(DEATH_FIELDS, [3, 0], [4, 1]),
        botDeaths: records(BOT_DEATH_FIELDS, [4, 1]),
      }),
    )
    expect(calls()).toEqual([
      ['botDeath', { bot: 1 }],
      ['death', { weight: 1 }],
    ])
  })

  it('stays silent on a load or a seek, but ticks a step back', () => {
    const client = fakeClient()
    const { play, calls } = player()
    attachArenaSound(client, { play })
    client.emit('loaded', LOADED)
    client.emit('frame', emptyFrame({ cycle: 0, ...FULL }))
    client.emit('frame', emptyFrame({ cycle: 500 }))
    client.emit('frame', emptyFrame({ cycle: 400, ...FULL }))
    expect(calls()).toEqual([])
    client.emit('frame', emptyFrame({ cycle: 399, ...FULL }))
    expect(calls()).toEqual([['tick']])
  })

  it('plays the victory when a match ends with one winner, and not otherwise', () => {
    const client = fakeClient()
    const { play, calls } = player()
    attachArenaSound(client, { play })
    client.emit('ended', endedOf(1, [roundOf([0], [3, 0])], [true, false]))
    expect(calls()).toEqual([['victory']])
    play.mockClear()
    // A draw; a round of three; a match of three that two bots share.
    client.emit('ended', endedOf(1, [roundOf([0, 1], [1, 1])], [true, true]))
    client.emit('ended', endedOf(3, [roundOf([0], [3, 0])], [true, false]))
    const shared = [roundOf([0], [3, 0]), roundOf([1], [0, 3]), roundOf([0, 1], [1, 1])]
    client.emit('ended', endedOf(3, shared, [true, true]))
    expect(calls()).toEqual([])
    const won = [roundOf([0], [3, 0]), roundOf([1], [0, 3]), roundOf([0], [3, 0])]
    client.emit('ended', endedOf(3, won, [true, false]))
    expect(calls()).toEqual([['victory']])
  })

  it('clicks when the battle plays, pauses, or changes speed, not when it loads or ends', () => {
    const client = fakeClient()
    const { play, calls } = player()
    attachArenaSound(client, { play })
    const { store } = client
    store.setState({ status: 'loading' })
    store.setState({ status: 'playing' })
    expect(calls()).toEqual([])
    store.setState({ status: 'paused' })
    store.setState({ status: 'playing' })
    store.setState({ speed: 'max' })
    store.setState({ status: 'ended' })
    expect(calls()).toEqual([['click'], ['click'], ['click']])
  })

  it('stops at the function it returns', () => {
    const client = fakeClient()
    const { play } = player()
    const stop = attachArenaSound(client, { play })
    stop()
    client.emit('loaded', LOADED)
    client.emit('frame', emptyFrame({ cycle: 0, ...FULL }))
    client.emit('frame', emptyFrame({ cycle: 1 }))
    client.store.setState({ speed: 1 })
    expect(play).not.toHaveBeenCalled()
  })
})
