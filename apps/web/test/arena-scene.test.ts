/**
 * The renderers' scene (`src/features/arena/render/scene.ts`): the core mirror built from frames,
 * the glows' ages, the ripples and pulses, and the dead bots' fade. The frames come from a real
 * `ArenaSession`, and the mirror is checked against a battle the engine runs straight through.
 */
import { describe, expect, it } from 'bun:test'
import { fighter } from '@asmbots/bots'
import { Battle, CORE_SIZE, fnv1a64, type LoadedBot } from '@asmbots/engine'
import {
  AGE_MAX,
  ArenaScene,
  BOT_FADE,
  BOT_FADE_MS,
  EFFECT_CAPACITY,
  EFFECT_FIELDS,
  GLOW_MS,
  isNonZero,
  PULSE,
  RIPPLE,
} from '../src/features/arena/render/scene'
import { ArenaSession } from '../src/features/arena/worker/session'
import { emptyFrame } from './arena-frame'

/** Dwarf and Paper at seed 1: Paper spawns throughout, and both write. */
const DUEL: readonly LoadedBot[] = [fighter('dwarf'), fighter('paper')]

/** A frame with nothing in it but what `parts` gives. */
const frame = emptyFrame

/** A full frame: `owner` and `bytes` as (address, value) pairs over an empty core. */
function full(owner: [number, number][], bytes: [number, number][] = [], dead: number[] = []) {
  const ownerDirty = new Uint8Array(CORE_SIZE)
  const bytesDirty = new Uint8Array(CORE_SIZE)
  for (const [a, tag] of owner) ownerDirty[a] = tag
  for (const [a, b] of bytes) bytesDirty[a] = b
  return frame({
    ownerDirty,
    bytesDirty,
    botDeaths: Uint32Array.from(dead.flatMap((b) => [0, b, 0, 0])),
  })
}

/** A spawn or a death record: (cycle, bot, proc, address), and a death's reason and killer. */
const spawns = (list: [bot: number, address: number][]) =>
  Uint32Array.from(list.flatMap(([bot, a]) => [0, bot, 0, a]))
const deaths = (list: [bot: number, address: number][]) =>
  Uint32Array.from(list.flatMap(([bot, a]) => [0, bot, 0, a, 1, 0]))

/** The scene's effects as (kind, bot, column, row) lists, oldest slot first. */
function effects(scene: ArenaScene): number[][] {
  const out: number[][] = []
  for (let i = 0; i < scene.effectCount; i++) {
    const o = i * EFFECT_FIELDS
    const code = scene.effects[o + 3] as number
    out.push([code >> 8, code & 0xff, scene.effects[o] as number, scene.effects[o + 1] as number])
  }
  return out
}

describe('ArenaScene: the core mirror', () => {
  it('takes a full frame whole, when it next advances', () => {
    const scene = new ArenaScene()
    scene.apply(
      full(
        [
          [0x1234, 1],
          [0x1235, 2],
        ],
        [
          [0x1234, 0x90],
          [0x8000, 7],
        ],
      ),
    )
    expect(scene.owner[0x1234]).toBe(0)
    expect(scene.advance(0)).toBe(true)
    expect(scene.owner[0x1234]).toBe(1)
    expect(scene.owner[0x1235]).toBe(2)
    expect(scene.bytes[0x1234]).toBe(0x90)
    expect(isNonZero(scene.nonZero, 0x1234)).toBe(true)
    expect(isNonZero(scene.nonZero, 0x1235)).toBe(false)
    expect(isNonZero(scene.nonZero, 0x8000)).toBe(true)
    expect(scene.nonZero.reduce((n, byte) => n + popcount(byte), 0)).toBe(2)
    expect(scene.fullVersion).toBe(1)
    expect(scene.changedCount).toBe(0)
  })

  it('writes cells and runs bytes: new owner, new byte, both ages 0, each byte listed once', () => {
    const scene = new ArenaScene()
    scene.apply(full([[0x10, 1]], [[0x10, 5]]))
    scene.advance(0)
    // (address, byte | owner << 8): bot 1 zeroes 0x10 and writes 0x11; 0x10 also runs.
    scene.apply(frame({ writes: Uint16Array.of(0x10, 2 << 8, 0x11, 0x42 | (2 << 8)) }))
    scene.apply(frame({ execs: Uint16Array.of(0x10, 1, 0x20, 0) }))
    scene.advance(10)
    expect([scene.owner[0x10], scene.bytes[0x10], isNonZero(scene.nonZero, 0x10)]).toEqual([
      2,
      0,
      false,
    ])
    expect([scene.owner[0x11], scene.bytes[0x11], isNonZero(scene.nonZero, 0x11)]).toEqual([
      2,
      0x42,
      true,
    ])
    expect([scene.writeAge[0x10], scene.writeAge[0x11], scene.writeAge[0x20]]).toEqual([
      0,
      0,
      AGE_MAX,
    ])
    expect([scene.execAge[0x10], scene.execAge[0x20], scene.execAge[0x11]]).toEqual([0, 0, AGE_MAX])
    expect(Array.from(scene.changed.subarray(0, scene.changedCount))).toEqual([0x10, 0x11, 0x20])
  })

  it('stays the core through a real session: steps, frames at speed, and seeks', () => {
    const session = new ArenaSession(() => 0)
    const scene = new ArenaScene()
    const take = (messages: ReturnType<ArenaSession['handle']>) => {
      for (const m of messages) if (m.type === 'frame') scene.apply(m)
    }
    take(session.handle({ type: 'load', bots: DUEL, config: { seed: 1 } }))
    let now = 0
    const check = () => {
      now += 16
      scene.advance(now)
      const battle = new Battle(DUEL, { seed: 1 })
      battle.run(scene.cycle)
      expect(fnv1a64(scene.owner)).toBe(fnv1a64(battle.core.owner))
      expect(fnv1a64(scene.bytes)).toBe(fnv1a64(battle.core.bytes))
      for (let a = 0; a < CORE_SIZE; a += 97) {
        expect(isNonZero(scene.nonZero, a)).toBe(battle.core.bytes[a] !== 0)
      }
    }
    check()
    for (const cycles of [1, 7, 500, 2000]) {
      take(session.handle({ type: 'step', cycles }))
      check()
    }
    take(session.handle({ type: 'speed', cyclesPerFrame: 2000 }))
    take(session.handle({ type: 'play' }))
    for (let i = 0; i < 3; i++) take(session.handle({ type: 'requestFrame' }))
    check()
    expect(scene.cycle).toBe(2508 + 6000)
    take(session.handle({ type: 'seek', cycle: 1234 }))
    check()
    expect(scene.cycle).toBe(1234)
    expect(scene.writeAge.every((age) => age === AGE_MAX)).toBe(true)
  })
})

describe('ArenaScene: the glows', () => {
  it('ages every glow by the time between advances, then shows the new frame at age 0', () => {
    const scene = new ArenaScene()
    scene.advance(1000)
    scene.apply(frame({ writes: Uint16Array.of(1, 0x0101), execs: Uint16Array.of(1, 0) }))
    scene.advance(1016)
    expect([scene.writeAge[1], scene.execAge[1]]).toEqual([0, 0])
    scene.apply(frame({ writes: Uint16Array.of(2, 0x0101) }))
    scene.advance(1116)
    expect([scene.writeAge[1], scene.writeAge[2], scene.execAge[1]]).toEqual([100, 0, 100])
  })

  it('counts fractions of a ms until they add up to one', () => {
    const scene = new ArenaScene()
    scene.advance(0)
    scene.apply(frame({ writes: Uint16Array.of(1, 0x0101) }))
    scene.advance(0.4)
    scene.advance(0.8)
    expect(scene.writeAge[1]).toBe(0)
    scene.advance(1.2)
    expect(scene.writeAge[1]).toBe(1)
    scene.advance(17.2)
    expect(scene.writeAge[1]).toBe(17)
  })

  it('holds an age at AGE_MAX', () => {
    const scene = new ArenaScene()
    scene.advance(0)
    scene.apply(frame({ writes: Uint16Array.of(1, 0x0101) }))
    scene.advance(1)
    scene.advance(3000)
    expect(scene.writeAge[1]).toBe(2999)
    scene.advance(3000 + 70_000)
    expect(scene.writeAge[1]).toBe(AGE_MAX)
  })

  it('asks for images while a glow fades, one more once it is out, then none', () => {
    const scene = new ArenaScene()
    expect(scene.advance(0)).toBe(false)
    scene.apply(frame({ execs: Uint16Array.of(5, 0) }))
    expect(scene.advance(16)).toBe(true)
    expect(scene.advance(32)).toBe(true)
    expect(scene.advance(16 + GLOW_MS - 1)).toBe(true)
    expect(scene.advance(16 + GLOW_MS + 16)).toBe(true)
    expect(scene.advance(16 + GLOW_MS + 32)).toBe(false)
    expect(scene.execAge[5]).toBeGreaterThanOrEqual(GLOW_MS)
    expect(scene.advance(20_000)).toBe(false)
  })

  it('stops counting ages once every glow is out, and counts again after a touch', () => {
    const scene = new ArenaScene()
    scene.advance(0)
    scene.apply(frame({ writes: Uint16Array.of(1, 0x0101) }))
    scene.advance(10)
    scene.advance(10 + GLOW_MS + 1)
    const version = scene.ageVersion
    scene.advance(10 + GLOW_MS + 100)
    expect(scene.ageVersion).toBe(version)
    scene.apply(frame({ writes: Uint16Array.of(2, 0x0101) }))
    scene.advance(10 + GLOW_MS + 200)
    scene.advance(10 + GLOW_MS + 300)
    expect(scene.writeAge[2]).toBe(100)
    expect(scene.writeAge[1]).toBeGreaterThan(GLOW_MS)
  })

  it('starts over from a full frame: no glows, no effects', () => {
    const scene = new ArenaScene()
    scene.advance(0)
    scene.apply(
      frame({
        writes: Uint16Array.of(1, 0x0101),
        spawns: spawns([[0, 1]]),
        deaths: deaths([[1, 2]]),
      }),
    )
    scene.advance(16)
    expect(scene.effectCount).toBe(2)
    scene.apply(full([[1, 1]]))
    scene.advance(32)
    expect(scene.writeAge[1]).toBe(AGE_MAX)
    expect(scene.effectCount).toBe(0)
  })
})

describe('ArenaScene: ripples, pulses, and dead bots', () => {
  it('pulses at each spawn and ripples at each death, deaths last, starting now', () => {
    const scene = new ArenaScene(1000)
    scene.advance(1000)
    scene.apply(
      frame({
        spawns: spawns([[1, 0x0203]]),
        deaths: deaths([
          [0, 0xff01],
          [1, 0x0010],
        ]),
      }),
    )
    scene.advance(1016)
    expect(effects(scene)).toEqual([
      [PULSE, 1, 0x03, 0x02],
      [RIPPLE, 0, 0x01, 0xff],
      [RIPPLE, 1, 0x10, 0x00],
    ])
    expect(scene.effects[2]).toBe(16)
    expect(scene.time(1016)).toBe(16)
  })

  it(`keeps the newest ${EFFECT_CAPACITY}`, () => {
    const scene = new ArenaScene()
    scene.advance(0)
    const many = Array.from({ length: 300 }, (_, i): [number, number] => [0, i])
    scene.apply(frame({ spawns: spawns(many) }))
    scene.advance(1)
    expect(scene.effectCount).toBe(EFFECT_CAPACITY)
    const addresses = effects(scene).map(
      ([, , col, row]) => (row as number) * 256 + (col as number),
    )
    expect(addresses.sort((a, b) => a - b)).toEqual(Array.from({ length: 256 }, (_, i) => 44 + i))
  })

  it('fades a dead bot over BOT_FADE_MS, and a full frame shows it faded at once', () => {
    const scene = new ArenaScene()
    scene.advance(0)
    scene.apply(frame({ botDeaths: Uint32Array.of(9, 1, 0, 0) }))
    scene.advance(100)
    expect(scene.fade[2]).toBe(0)
    scene.advance(100 + BOT_FADE_MS / 2)
    expect(scene.fade[2]).toBeCloseTo(BOT_FADE / 2, 5)
    expect(scene.advance(100 + BOT_FADE_MS + 5)).toBe(true)
    expect(scene.fade[2]).toBeCloseTo(BOT_FADE, 5)
    expect(scene.advance(100 + BOT_FADE_MS + 30)).toBe(false)
    expect(scene.fade[1]).toBe(0)

    scene.apply(full([[1, 1]], [], [0]))
    scene.advance(5000)
    expect(scene.fade[1]).toBeCloseTo(BOT_FADE, 5)
    expect(scene.fade[2]).toBe(0)
  })

  it('with reduced motion: no ripples or pulses, and a dead bot fades at once', () => {
    const scene = new ArenaScene()
    scene.advance(0)
    scene.apply(frame({ spawns: spawns([[0, 1]]), botDeaths: Uint32Array.of(0, 0, 0, 0) }))
    scene.advance(16)
    expect(scene.effectCount).toBe(1)
    scene.reducedMotion = true
    expect(scene.effectCount).toBe(0)
    expect(scene.fade[1]).toBeCloseTo(BOT_FADE, 5)
    scene.apply(frame({ deaths: deaths([[1, 5]]), botDeaths: Uint32Array.of(0, 1, 0, 0) }))
    scene.advance(32)
    expect(scene.effectCount).toBe(0)
    expect(scene.fade[2]).toBeCloseTo(BOT_FADE, 5)
  })
})

function popcount(byte: number): number {
  let n = 0
  for (let b = byte; b !== 0; b >>= 1) n += b & 1
  return n
}
