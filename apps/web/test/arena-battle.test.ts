/**
 * The battle view's logic without a DOM (`src/features/arena/battle/`): the events log fed by a
 * real `ArenaSession`, the speed ladder, the file names, the replay file, the outcomes, the running
 * standings, the isolation, the hover tooltip's words, and a match's placement check.
 */
import { beforeEach, describe, expect, it } from 'bun:test'
import { fighter } from '@asmbots/bots'
import { Battle, type BattleConfigInput, type LoadedBot, simulate } from '@asmbots/engine'
import { matchResultHash, replayConfig, replayMatch } from '@asmbots/protocol'
import { newMatch, roundOrder, roundSeed, runMatch } from '@asmbots/tourney'
import { fileStem, replayName, screenshotName, slug } from '../src/features/arena/battle/files'
import { byteInfo } from '../src/features/arena/battle/HoverTip'
import {
  BattleLog,
  describe as describeEvent,
  HISTORY,
  killerText,
  type LogEvent,
  MAX_MINOR,
  reasonText,
} from '../src/features/arena/battle/log'
import { buildReplay } from '../src/features/arena/battle/replay'
import { runningStandings } from '../src/features/arena/battle/StandingsPanel'
import { faster, SPEED_STEPS, slower, speedLabel } from '../src/features/arena/battle/speed'
import { matchOutcome, roundOutcome } from '../src/features/arena/battle/Victory'
import { useArenaView } from '../src/features/arena/battle/view'
import { ArenaScene, NOT_SEEN } from '../src/features/arena/render/scene'
import { fightSeed, fits } from '../src/features/arena/setup/bots'
import type {
  ArenaMessage,
  ArenaRequest,
  EndedMessage,
} from '../src/features/arena/worker/protocol'
import { ArenaSession } from '../src/features/arena/worker/session'
import { emptyFrame } from './arena-frame'

/** Dwarf and Paper at seed 1: Paper splits throughout, Dwarf dies at 23,822. */
const DUEL: readonly LoadedBot[] = [fighter('dwarf'), fighter('paper')]
/** Dwarf kills Imp at seed 1 in cycle 16,140. */
const SHORT: readonly LoadedBot[] = [fighter('dwarf'), fighter('imp')]

/** A session whose messages go to `log`, as `ArenaClient` hands them on. */
function logged(bots: readonly LoadedBot[], config: BattleConfigInput, rounds = 1) {
  const session = new ArenaSession()
  const log = new BattleLog()
  const send = (request: ArenaRequest): ArenaMessage[] => {
    const messages = session.handle(request)
    for (const message of messages) {
      if (message.type === 'loaded') log.loaded(message)
      else if (message.type === 'frame') log.frame(message)
      else if (message.type === 'ended') log.ended(message)
    }
    return messages
  }
  send({ type: 'load', bots, config, rounds })
  return { session, log, send }
}

const kinds = (events: readonly LogEvent[]) => events.map((event) => event.kind)

describe('the events log', () => {
  it('starts each round with its round line', () => {
    const { log } = logged(DUEL, { seed: 1 })
    expect(log.names).toEqual(['Dwarf', 'Paper'])
    const [line] = log.events('all')
    expect(line).toMatchObject({ kind: 'round', cycle: 0, bot: null, round: 0, seed: 1 })
    expect(describeEvent(line as LogEvent, log.names, 1)).toBe('seed 1')
    expect(describeEvent(line as LogEvent, log.names, 3)).toBe('round 1 of 3 · seed 1')
  })

  it('logs spawns and deaths with their killers, the bot dead, first blood, and the end', () => {
    const { log, send } = logged(SHORT, { seed: 1 })
    for (let i = 0; i < 20; i++) send({ type: 'step', cycles: 1000 })
    const events = log.events('all')
    expect(kinds(events).slice(0, 4)).toEqual(['end', 'blood', 'dead', 'death'])
    const [end, blood, dead, death] = events as [LogEvent, LogEvent, LogEvent, LogEvent]
    const text = (event: LogEvent) => describeEvent(event, log.names, 1)
    expect(end).toMatchObject({ cycle: 16_141, standing: [0] })
    expect(text(end)).toBe('battle over · Dwarf wins')
    expect(text(blood)).toBe('first blood · Dwarf → Imp')
    expect(text(dead)).toBe('Imp dead · dat · by Dwarf')
    expect(text(death)).toMatch(/^Imp died @ 0x[0-9A-F]{4} · dat · by Dwarf$/)
    expect(log.deaths).toEqual([null, { cycle: 16_140, reason: 'dat', killer: 1 }])
    expect(log.botDeathMarks()).toEqual([{ bot: 1, cycle: 16_140 }])
    // Newest first, whatever kind.
    const cycles = events.map((event) => event.cycle)
    expect(cycles).toEqual([...cycles].sort((a, b) => b - a))
  })

  it('logs each cycle once: a seek back replays nothing new, a seek ahead backfills fates', () => {
    const { log, send } = logged(DUEL, { seed: 1 })
    send({ type: 'step', cycles: 3000 })
    const before = log.events('all').map((event) => event.id)
    send({ type: 'seek', cycle: 1000 })
    send({ type: 'step', cycles: 1500 })
    expect(log.events('all').map((event) => event.id)).toEqual(before)
    // Past the end without a frame on the way: the bot death and first blood still come in.
    send({ type: 'seek', cycle: 100_000 })
    const after = log.events('all')
    expect(kinds(after).filter((kind) => kind !== 'spawn' && kind !== 'death')).toEqual([
      'end',
      'dead',
      'blood',
      'round',
    ])
    expect(after.find((event) => event.kind === 'dead')).toMatchObject({ bot: 0, killer: 2 })
  })

  it('filters: deaths drops the spawns, bots keeps only the fates', () => {
    const { log, send } = logged(DUEL, { seed: 1 })
    send({ type: 'step', cycles: 30_000 })
    const all = new Set(kinds(log.events('all')))
    expect(all).toEqual(new Set(['round', 'spawn', 'death', 'blood', 'dead', 'end']))
    expect(new Set(kinds(log.events('deaths')))).toEqual(
      new Set(['round', 'death', 'blood', 'dead', 'end']),
    )
    expect(new Set(kinds(log.events('bots')))).toEqual(new Set(['round', 'blood', 'dead', 'end']))
  })

  it('keeps the newest spawns and deaths, and every fate', () => {
    const log = new BattleLog()
    const { session } = logged(DUEL, { seed: 1 })
    const [loaded] = session.handle({ type: 'setRound', round: 0 })
    log.loaded(loaded as Extract<ArenaMessage, { type: 'loaded' }>)
    const spawns = Uint32Array.from(
      Array.from({ length: 3 * MAX_MINOR }, (_, i) => [i, 1, 0, i]).flat(),
    )
    log.frame(emptyFrame({ cycle: 3 * MAX_MINOR, spawns, botDeaths: Uint32Array.of(5, 0, 1, 2) }))
    const events = log.events('all')
    expect(events.filter((event) => event.kind === 'spawn')).toHaveLength(MAX_MINOR)
    expect(events[0]).toMatchObject({ kind: 'spawn', cycle: 3 * MAX_MINOR - 1 })
    expect(events.filter((event) => event.kind === 'dead')).toHaveLength(1)
  })

  it('keeps each bot’s process count over the last 120 frames', () => {
    const { log, send } = logged(DUEL, { seed: 1 })
    for (let i = 0; i < HISTORY + 30; i++) send({ type: 'step', cycles: 50 })
    expect(log.history).toHaveLength(2)
    expect(log.history[1]).toHaveLength(HISTORY)
    const paper = new Battle(DUEL, { seed: 1 })
    paper.run((HISTORY + 30) * 50)
    expect(log.history[1]?.at(-1)).toBe(paper.bots[1]?.queue.size)
  })

  it('starts over with the next round', () => {
    const { log, send } = logged(SHORT, { seed: 1, maxCycles: 20_000 }, 2)
    send({ type: 'seek', cycle: 20_000 })
    expect(kinds(log.events('bots'))[0]).toBe('end')
    send({ type: 'setRound', round: 1 })
    expect(log.round).toBe(1)
    expect(kinds(log.events('all'))).toEqual(['round'])
    expect(log.deaths).toEqual([null, null])
    expect(describeEvent(log.events('all')[0] as LogEvent, log.names, 2)).toBe(
      'round 2 of 2 · seed 2',
    )
  })

  it('names reasons and killers in the log’s words', () => {
    expect(['undefined', 'dat', 'hlt', 'int3', 'div'].map((r) => reasonText(r as 'dat'))).toEqual([
      'bad opcode',
      'dat',
      'hlt',
      'int3',
      'divide error',
    ])
    expect(killerText(0, 1, ['A', 'B'])).toBe('empty core')
    expect(killerText(2, 1, ['A', 'B'])).toBe('self')
    expect(killerText(1, 1, ['A', 'B'])).toBe('by A')
  })
})

describe('the speed', () => {
  it('steps along 1-2-5 to 10,000, then max, and back', () => {
    expect(SPEED_STEPS.at(-1)).toBe('max')
    expect(faster(1)).toBe(2)
    expect(faster(137)).toBe(200)
    expect(faster(10_000)).toBe('max')
    expect(faster('max')).toBe('max')
    expect(slower('max')).toBe(10_000)
    expect(slower(137)).toBe(100)
    expect(slower(1)).toBe(1)
    expect(speedLabel(2000)).toBe('2,000/f')
    expect(speedLabel('max')).toBe('max')
  })
})

describe('the files', () => {
  it('names screenshots and replays by the bots, the seed, and the cycle', () => {
    expect(slug('Imp Ring 2!')).toBe('imp-ring-2')
    expect(fileStem(['Dwarf', 'Imp'], 1)).toBe('asmbots-dwarf-imp-1')
    expect(fileStem(['A', 'B', 'C', 'D'], 7)).toBe('asmbots-4-bots-7')
    expect(fileStem(['***'], 7)).toBe('asmbots-bot-7')
    expect(screenshotName(['Dwarf', 'Imp'], 1, 3527)).toBe('asmbots-dwarf-imp-1-3527.png')
    expect(replayName(['Dwarf', 'Imp'], 1)).toBe('asmbots-dwarf-imp-1.asmreplay.json')
  })
})

describe('the replay file', () => {
  it('holds the bots, their hashes and sources, the config, and the match', async () => {
    const config = { seed: 9, maxCycles: 20_000 }
    const match = runMatch(SHORT, config, 2)
    const bots = SHORT.map(({ name, bytes, meta }) => ({ name, bytes, meta }))
    const when = new Date('2026-09-23T12:00:00Z')
    const replay = await buildReplay(bots, ['; dwarf', ''], config, 2, match, when)
    expect(replay).toMatchObject({
      isa: 'x16c-v1',
      createdAt: '2026-09-23T12:00:00.000Z',
      config: { maxCycles: 20_000, maxProcesses: 64, minSpacing: 1024 },
      seed: 9,
      rounds: 2,
      result: {
        key: match.key,
        points: match.points,
        resultHash: matchResultHash(match.rounds),
        rounds: match.rounds,
      },
    })
    const [dwarf, imp] = replay.bots
    expect(dwarf?.source).toBe('; dwarf')
    expect(imp?.source).toBeUndefined()
    expect(Uint8Array.from(atob(dwarf?.bytes ?? ''), (c) => c.charCodeAt(0))).toEqual(
      SHORT[0]?.bytes as Uint8Array,
    )
    const digest = new Bun.CryptoHasher('sha256').update(SHORT[1]?.bytes as Uint8Array)
    expect(imp?.sha256).toBe(digest.digest('hex'))
    // Enough to play the match again.
    const again = runMatch(
      replay.bots.map((bot) => ({
        name: bot.name,
        bytes: Uint8Array.from(atob(bot.bytes), (c) => c.charCodeAt(0)),
      })),
      replayConfig(replay),
      replay.rounds,
    )
    expect(again).toEqual(replayMatch(replay))
  })
})

describe('the outcome', () => {
  it('names the last bot standing, a draw at the cycle cap, and nobody', () => {
    const win = simulate(SHORT, { seed: 1 })
    expect(roundOutcome(win, [0, 1], ['Dwarf', 'Imp'])).toEqual({
      kind: 'winner',
      winners: [0],
      headline: 'winner · Dwarf',
      detail: 'last bot standing · cycle 16,141',
    })
    // The same round fought in the other order: the result lists Imp first.
    const swapped = simulate([SHORT[1], SHORT[0]] as LoadedBot[], { seed: 1 })
    expect(roundOutcome(swapped, [1, 0], ['Dwarf', 'Imp']).winners).toEqual(
      swapped.survivors.map((j) => [1, 0][j]),
    )
    const spin = [fighter('spin'), { ...fighter('spin'), name: 'Spin 2' }]
    const draw = simulate(spin, { maxCycles: 500 })
    expect(roundOutcome(draw, [0, 1], ['Spin', 'Spin 2'])).toMatchObject({
      kind: 'draw',
      headline: 'draw · Spin, Spin 2',
      detail: 'time ran out · 2 bots standing · cycle 500',
    })
    const nobody = { ...draw, survivors: [], bots: draw.bots.map((b) => ({ ...b, alive: false })) }
    expect(roundOutcome(nobody, [0, 1], ['Spin', 'Spin 2'])).toMatchObject({
      kind: 'none',
      headline: 'no winner',
    })
  })

  it('crowns the most points over a match, or a draw between the best', () => {
    const match = runMatch(
      [fighter('dwarf'), fighter('imp'), fighter('stone')],
      { seed: 5, maxCycles: 20_000 },
      3,
    )
    const standings = runningStandings(match, 20_000, null).map((row) => ({
      entrant: row.bot,
      name: row.name,
      points: row.points,
      wins: row.wins,
      ties: row.ties,
      losses: row.losses,
      survival: [],
      histogram: [],
    }))
    const outcome = matchOutcome(match, standings)
    const top = Math.max(...match.points)
    expect(outcome.winners.every((bot) => match.points[bot] === top)).toBe(true)
    expect(outcome.detail).toContain(`${top} points`)
    const tied = { ...match, points: match.points.map(() => 4) }
    expect(
      matchOutcome(
        tied,
        standings.map((s) => ({ ...s, points: 4 })),
      ),
    ).toMatchObject({
      kind: 'draw',
      detail: '4 points each · 3 rounds',
    })
  })
})

describe('the running standings', () => {
  it('adds what the round in play would give each bot alive now', () => {
    const bots = [fighter('dwarf'), fighter('imp'), fighter('stone')]
    const match = runMatch(bots, { seed: 5, maxCycles: 20_000 }, 1)
    const partial = { ...match, of: 3 }
    const rows = runningStandings(partial, 20_000, [true, false, true])
    // Two of three alive: floor((9 - 1) / 2) = 4 each (ISA §5.5).
    expect(rows.map((row) => row.live).sort()).toEqual([0, 4, 4])
    const totals = rows.map((row) => row.points + row.live)
    expect(totals).toEqual([...totals].sort((a, b) => b - a))
    expect(runningStandings(newMatch(bots, {}, 3), 20_000, null).every((r) => r.live === 0)).toBe(
      true,
    )
  })
})

describe('isolation', () => {
  beforeEach(() => useArenaView.setState({ isolated: [] }))

  it('isolates one bot, a second replaces it, and the same one again clears', () => {
    const { isolate } = useArenaView.getState()
    isolate(2)
    expect(useArenaView.getState().isolated).toEqual([2])
    isolate(0)
    expect(useArenaView.getState().isolated).toEqual([0])
    isolate(0)
    expect(useArenaView.getState().isolated).toEqual([])
  })

  it('adds and removes with add (a shift-click), in order', () => {
    const { isolate, clearIsolation } = useArenaView.getState()
    isolate(3, true)
    isolate(1, true)
    expect(useArenaView.getState().isolated).toEqual([1, 3])
    isolate(3, true)
    expect(useArenaView.getState().isolated).toEqual([1])
    isolate(4)
    isolate(5, true)
    clearIsolation()
    expect(useArenaView.getState().isolated).toEqual([])
  })
})

describe('the hover tooltip', () => {
  it('reads a byte: its instruction, its owner, and when it was written', () => {
    const scene = new ArenaScene()
    const ownerDirty = new Uint8Array(0x10000)
    const bytesDirty = new Uint8Array(0x10000)
    // `add bx, 4` at 0x1A2F, Dwarf's.
    bytesDirty.set([0x83, 0xc3, 0x04], 0x1a2f)
    ownerDirty.fill(1, 0x1a2f, 0x1a32)
    scene.apply(emptyFrame({ ownerDirty, bytesDirty }))
    scene.advance(0)
    const names = ['Dwarf', 'Imp']
    expect(byteInfo(scene, 0x1a2f, names)).toEqual({
      address: 0x1a2f,
      byte: 0x83,
      instruction: 'add bx, 4',
      tag: 1,
      story: 'owned by Dwarf · loaded at cycle 0',
    })
    expect(byteInfo(scene, 0x2000, names).story).toBe('empty core')
    scene.apply(
      emptyFrame({
        cycle: 500,
        writes: Uint16Array.of(0x1a30, 0x0200 | 0xc3),
        writeCycles: Uint32Array.of(88),
      }),
    )
    scene.advance(16)
    expect(byteInfo(scene, 0x1a30, names).story).toBe('owned by Imp · written 412 cycles ago')
    expect(scene.writtenAt[0x1a31]).toBe(NOT_SEEN)
    scene.apply(emptyFrame({ cycle: 900, ownerDirty, bytesDirty }))
    scene.advance(32)
    expect(byteInfo(scene, 0x1a2f, names).story).toBe('owned by Dwarf · written before cycle 900')
  })
})

describe('a match’s placement', () => {
  // Eight bots 6,000 bytes apart place with seed 14 in the load's order, not rotated by one.
  const SIZES = [120, 60, 200, 40, 180, 90, 150, 30]

  it('checks every round: the order rotates and the seed steps', () => {
    expect(fits(SIZES, 6000, 14)).toBe(true)
    expect(fits(SIZES, 6000, 14, 2)).toBe(false)
    const rotated = roundOrder(8, 1).map((k) => SIZES[k] as number)
    expect(fits(rotated, 6000, roundSeed(14, 1))).toBe(false)
    expect(fightSeed(SIZES, 6000, 14, undefined, 2)).toBeNull()
    const seed = fightSeed(SIZES, 6000, null, undefined, 3) as number
    expect(fits(SIZES, 6000, seed, 3)).toBe(true)
  })
})

describe('an ended round', () => {
  it('carries the match with it, which runMatch agrees with', () => {
    const { send } = logged(SHORT, { seed: 1 }, 1)
    const messages = send({ type: 'seek', cycle: 100_000 })
    const ended = messages.find((m): m is EndedMessage => m.type === 'ended')
    expect(ended?.match).toEqual(runMatch(SHORT, { seed: 1 }, 1))
  })
})
