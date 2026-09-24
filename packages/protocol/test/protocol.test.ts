import { describe, expect, it } from 'bun:test'
import type { LoadedBot } from '@asmbots/engine'
import { runMatch } from '@asmbots/tourney'
import {
  ApiError,
  apiError,
  Bot,
  BotVersion,
  buildReplay,
  bytesProblem,
  canonicalJson,
  decodeReplayFragment,
  decodeShare,
  decodeSources,
  encodeReplayFragment,
  encodeShare,
  encodeSources,
  fromBase64,
  fromBase64Url,
  Hill,
  HillEntry,
  HillEvent,
  HillSubmission,
  HillSubmitRequest,
  type LiveMessage,
  liveRoomName,
  Match,
  matchResultHash,
  ProtocolError,
  parse,
  parseLiveMessage,
  parseReplay,
  Replay,
  type Replay as ReplayType,
  RunnerJob,
  replayBots,
  replayConfig,
  replayKey,
  replayMatch,
  runnerJobId,
  type ShareLink,
  SubmissionDetail,
  sha256Hex,
  Tournament,
  toBase64,
  toBase64Url,
  User,
} from '../src/index'

/** `jmp short $`: lives until the cycle cap. */
const LOOP: LoadedBot = {
  name: 'Loop',
  bytes: Uint8Array.from([0xeb, 0xfe]),
  meta: { author: 'a' },
}
/** `dat`: dies on its first instruction. */
const DAT: LoadedBot = { name: 'Dat', bytes: Uint8Array.from([0x00, 0x00]) }
const CONFIG = { maxCycles: 200, seed: 7 }

async function duel(rounds = 2): Promise<ReplayType> {
  const match = runMatch([LOOP, DAT], CONFIG, rounds)
  return buildReplay({
    bots: [
      { ...LOOP, source: 'jmp short $' },
      { ...DAT, source: '' },
    ],
    config: CONFIG,
    rounds,
    match,
    createdAt: new Date(0),
  })
}

/** `value` with its keys in reverse order, all the way down. */
function reversed(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reversed)
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([k, v]) => [k, reversed(v)]),
    )
  }
  return value
}

function problem(value: unknown): string {
  try {
    parseReplay(value)
  } catch (error) {
    if (error instanceof ProtocolError) return error.message
    throw error
  }
  throw new Error('it parsed')
}

describe('bytes', () => {
  it('round trip base64, base64url, and hash with SHA-256', async () => {
    const bytes = Uint8Array.from({ length: 70_000 }, (_, i) => (i * 7) & 0xff)
    expect(fromBase64(toBase64(bytes))).toEqual(bytes)
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes)
    expect(toBase64Url(Uint8Array.from([0xfb, 0xff]))).toBe('-_8')
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
})

describe('canonicalJson', () => {
  it('sorts keys, drops undefined fields, and keeps array order', () => {
    expect(canonicalJson({ b: [3, { d: 1, c: undefined, a: 2 }], a: 'x' })).toBe(
      '{"a":"x","b":[3,{"a":2,"d":1}]}',
    )
    expect(canonicalJson([undefined, Number.NaN])).toBe('[null,null]')
  })
})

describe('replays', () => {
  it('round trip through JSON, sources and all', async () => {
    const replay = await duel()
    expect(replay.isa).toBe('x16c-v1')
    expect(replay.seed).toBe(7)
    expect(replay.config).not.toHaveProperty('seed')
    expect(replay.bots.map((bot) => bot.source)).toEqual(['jmp short $', undefined])
    expect(parseReplay(JSON.parse(JSON.stringify(replay)))).toEqual(replay)
    expect(await bytesProblem(replay)).toBeNull()
  })

  it('give back what they were made from', async () => {
    const replay = await duel(3)
    const match = runMatch([LOOP, DAT], CONFIG, 3)
    expect(replayMatch(replay)).toEqual(match)
    expect(replayBots(replay)).toEqual([LOOP, DAT])
    expect(replayConfig(replay)).toMatchObject(CONFIG)
    expect(replay.result.resultHash).toBe(matchResultHash(match.rounds))
    expect(replay.result.survivors).toEqual(match.rounds[2]?.survivors ?? [])
    // The engine plays the replay's own inputs the same.
    expect(runMatch(replayBots(replay), replayConfig(replay), replay.rounds)).toEqual(match)
  })

  it('have a key of their inputs alone, whatever the order of their fields', async () => {
    const replay = await duel()
    const key = await replayKey(replay)
    expect(key).toMatch(/^[0-9a-f]{64}$/)
    expect(await replayKey(reversed(replay) as ReplayType)).toBe(key)
    const { source: _, ...bare } = replay.bots[0] as ReplayType['bots'][0]
    expect(
      await replayKey({
        ...replay,
        createdAt: 'later',
        bots: [bare, replay.bots[1] as ReplayType['bots'][0]],
      }),
    ).toBe(key)
    expect(await replayKey({ ...replay, seed: 8 })).not.toBe(key)
    expect(await replayKey({ ...replay, rounds: 3 })).not.toBe(key)
    expect(await replayKey({ ...replay, config: { ...replay.config, maxCycles: 201 } })).not.toBe(
      key,
    )
  })

  it('say what is wrong with one they do not accept', async () => {
    const replay = await duel()
    const [loop, dat] = replay.bots as [ReplayType['bots'][0], ReplayType['bots'][0]]
    expect(problem(null)).toBe('the replay is not well formed')
    expect(problem({ ...replay, isa: 'x86-64' })).toBe('isa is not well formed')
    expect(problem({ ...replay, seed: undefined })).toBe('seed is missing')
    expect(problem({ ...replay, rounds: 11 })).toBe('rounds must be a whole number in 1..10')
    expect(problem({ ...replay, config: { ...replay.config, maxCycles: 2_000_000 } })).toBe(
      'maxCycles must be a whole number in 1..1,000,000',
    )
    expect(problem({ ...replay, bots: [loop] })).toBe('it has 1 bot, and a battle has 2 to 16')
    expect(problem({ ...replay, bots: [loop, { ...dat, bytes: 'not base64!' }] })).toBe(
      'bots[1].bytes is not well formed',
    )
    expect(problem({ ...replay, bots: [loop, { ...dat, sha256: 'abc' }] })).toBe(
      'bots[1].sha256 is not well formed',
    )
    const round = replay.result.rounds[0] as ReplayType['result']['rounds'][0]
    const result = (change: object) =>
      problem({ ...replay, result: { ...replay.result, ...change } })
    expect(result({ rounds: [round] })).toBe('it records 1 of its 2 rounds')
    expect(result({ rounds: [round, { ...round, round: 0 }] })).toBe('round 2 is out of order')
    expect(result({ rounds: [{ ...round, order: [0, 0] }, round] })).toBe(
      "round 1's order is not the 2 bots",
    )
    expect(result({ points: [1] })).toBe('the match points name 1 bot, not 2')
  })

  it('know bytes that are not the bytes their SHA-256 names', async () => {
    const replay = await duel()
    const [loop, dat] = replay.bots as [ReplayType['bots'][0], ReplayType['bots'][0]]
    const flipped = toBase64(Uint8Array.from([0x01, 0x00]))
    expect(await bytesProblem({ ...replay, bots: [loop, { ...dat, bytes: flipped }] })).toBe(
      "Dat's bytes do not match their SHA-256",
    )
  })
})

describe('share links', () => {
  it('round trip an arena setup with the sources of its local bots', () => {
    const link: ShareLink = {
      bots: ['roster:dwarf', 'local:3f2a'],
      seed: 42,
      cycles: 100_000,
      rounds: 3,
      procs: 64,
      spacing: 1024,
      sources: [{ id: '3f2a', source: 'mov ax, 1 ; é\n'.repeat(40) }],
    }
    const href = encodeShare(link)
    expect(href).toMatch(
      /^\/arena\?b=roster:dwarf,local:3f2a&seed=42&cycles=100000&rounds=3&procs=64&spacing=1024#src=[A-Za-z0-9_-]+$/,
    )
    expect(decodeShare(href)).toEqual(link)
    expect(decodeShare(`https://asmbots.dev${href}`)).toEqual(link)
    expect(encodeShare({ bots: [] })).toBe('/arena')
  })

  it('carry a replay with its bytes inline, and play the same from it', async () => {
    const replay = await duel()
    const href = encodeShare({ bots: [], replay })
    expect(href.startsWith(`/arena/${replay.result.key}#r=`)).toBe(true)
    const read = decodeShare(href).replay
    if (read === undefined) throw new Error('no replay')
    expect(read.bots.every((bot) => bot.source === undefined)).toBe(true)
    expect(read.bots.map((bot) => bot.bytes)).toEqual(replay.bots.map((bot) => bot.bytes))
    expect(await replayKey(read)).toBe(await replayKey(replay))
    expect(replayBots(read)).toEqual([LOOP, DAT])
    expect(await bytesProblem(read)).toBeNull()
    expect(Replay.safeParse(read).success).toBe(true)
  })

  it('leave out what does not parse, and say why a replay fragment is broken', async () => {
    const link = decodeShare(
      '/arena?b=roster:dwarf,bogus,local:x!&seed=99999999999&cycles=abc&rounds=2',
    )
    expect(link).toEqual({ bots: ['roster:dwarf'], rounds: 2 })
    expect(decodeSources('#src=!!!')).toEqual([])
    expect(decodeSources('')).toEqual([])
    expect(decodeSources(encodeSources([{ id: 'a', source: 'x' }]))).toEqual([
      { id: 'a', source: 'x' },
    ])
    expect(decodeReplayFragment('#src=abc')).toBeNull()
    const cut = encodeReplayFragment(await duel()).slice(0, -40)
    expect(() => decodeReplayFragment(cut)).toThrow(
      'it does not decode, so the link may be cut short',
    )
    expect(() => decodeReplayFragment(`r=${'A'.repeat((1 << 20) + 4)}`)).toThrow(
      'it is longer than any replay link',
    )
    expect(() => decodeShare(`/arena/x#r=${toBase64Url(new TextEncoder().encode('{}'))}`)).toThrow(
      ProtocolError,
    )
  })
})

describe('records', () => {
  const at = '2026-09-24T00:00:00.000Z'
  const config = {
    coreSize: 65_536,
    maxCycles: 80_000,
    maxProcesses: 64,
    minSpacing: 1024,
    maxBotBytes: 512,
  }
  const sha = 'a'.repeat(64)

  it('round trip through JSON', () => {
    const records = [
      [User, { id: 'u1', handle: 'pedram', avatarUrl: null, createdAt: at }],
      [
        Bot,
        {
          id: 'b1',
          ownerId: 'u1',
          slug: 'dwarf',
          name: 'Dwarf',
          visibility: 'public',
          createdAt: at,
          updatedAt: at,
        },
      ],
      [
        BotVersion,
        {
          id: 'v1',
          botId: 'b1',
          version: 1,
          source: 'dat',
          bytesSha256: sha,
          size: 2,
          author: null,
          strategy: 'bomber',
          isa: 'x16c-v1',
          createdAt: at,
        },
      ],
      [
        Hill,
        {
          id: 'h1',
          slug: 'main',
          name: 'Main',
          description: '',
          size: 20,
          rounds: 10,
          config,
          scoring: 'duel',
          createdAt: at,
        },
      ],
      [
        HillSubmission,
        {
          id: 's1',
          hillId: 'h1',
          botVersionId: 'v1',
          status: 'finished',
          score: 112,
          rank: null,
          needed: 131,
          createdAt: at,
        },
      ],
      [
        HillEvent,
        {
          id: 'e1',
          hillId: 'h1',
          submissionId: 's1',
          kind: 'entered',
          botVersionId: 'v1',
          rank: 5,
          score: 152,
          delta: 3,
          at,
        },
      ],
      [
        HillEntry,
        {
          hillId: 'h1',
          botVersionId: 'v1',
          score: 101.5,
          rating: 1500,
          wins: 3,
          ties: 1,
          losses: 0,
          age: 4,
          enteredAt: at,
          rank: 1,
        },
      ],
      [
        Tournament,
        {
          id: 't1',
          slug: 'weekly-1',
          name: 'Weekly',
          kind: 'bracket',
          status: 'scheduled',
          config: { rounds: 3, seed: 1, battle: config },
          bracket: null,
          ownerId: null,
          startsAt: at,
          createdAt: at,
        },
      ],
      [
        Match,
        {
          id: 'm1',
          tournamentId: 't1',
          hillId: null,
          participants: ['v1', 'v2'],
          rounds: 1,
          seed: 5,
          result: { points: [3, 0], survivors: [0], resultHash: '0123456789abcdef' },
          replayKey: sha,
          finishedAt: at,
        },
      ],
      [ApiError, apiError('not_found', 'no such bot')],
    ] as const
    for (const [schema, value] of records) {
      expect(schema.parse(JSON.parse(JSON.stringify(value)))).toEqual(value as never)
    }
    expect(Bot.safeParse({ ...records[1][1], visibility: 'secret' }).success).toBe(false)
    expect(User.safeParse({ ...records[0][1], handle: '-bad' }).success).toBe(false)
    expect(Hill.safeParse({ ...records[3][1], scoring: 'swiss' }).success).toBe(false)
    expect(HillSubmission.safeParse({ ...records[4][1], status: 'paused' }).success).toBe(false)
    expect(HillEvent.safeParse({ ...records[5][1], kind: 'crowned' }).success).toBe(false)
  })

  it('read a submission as the hill page polls it, and a submit request', () => {
    const label = {
      botId: 'b1',
      versionId: 'v1',
      slug: 'dwarf',
      name: 'Dwarf',
      version: 1,
      owner: 'pedram',
      author: null,
    }
    const detail = {
      submission: {
        id: 's1',
        hillId: 'h1',
        botVersionId: 'v1',
        status: 'running',
        score: null,
        rank: null,
        needed: null,
        createdAt: at,
      },
      bot: label,
      progress: { done: 24, of: 32, next: [label, null] },
      matches: [],
      events: [],
    }
    expect(parse(SubmissionDetail, JSON.parse(JSON.stringify(detail)), 'it')).toEqual(detail)
    expect(parse(HillSubmitRequest, { botVersionId: 'v1' }, 'the request')).toEqual({
      botVersionId: 'v1',
    })
    expect(() => parse(HillSubmitRequest, {}, 'the request')).toThrow('botVersionId is missing')
    expect(() => parse(HillSubmitRequest, { botVersionId: '' }, 'the request')).toThrow(
      ProtocolError,
    )
  })

  it('read LiveRoom messages and refuse others', () => {
    const messages: LiveMessage[] = [
      { type: 'hello', protocol: 1, room: { kind: 'hill', id: 'h1' }, now: at },
      { type: 'matchStarted', match: { id: 'm1', participants: ['v1', 'v2'], rounds: 3, seed: 9 } },
      {
        type: 'matchFinished',
        match: {
          id: 'm1',
          tournamentId: null,
          hillId: 'h1',
          participants: ['v1', 'v2'],
          rounds: 1,
          seed: 9,
          result: null,
          replayKey: null,
          finishedAt: null,
        },
      },
      {
        type: 'standings',
        entries: [{ botVersionId: 'v1', rank: 1, score: 3, wins: 1, ties: 0, losses: 0 }],
      },
      { type: 'progress', job: 'hill:main:s1', status: 'running', done: 24, of: 32 },
      { type: 'ping', t: 12 },
    ]
    for (const message of messages)
      expect(parseLiveMessage(JSON.stringify(message))).toEqual(message)
    expect(() => parseLiveMessage('{"type":"shout"}')).toThrow(ProtocolError)
    expect(() => parseLiveMessage('not json')).toThrow('the message is missing')
    expect(() =>
      parseLiveMessage('{"type":"progress","job":"j","status":"paused","done":0,"of":1}'),
    ).toThrow(ProtocolError)
  })
})

describe('runner jobs', () => {
  it('read a hill job and a tournament job, and name their runners and rooms', () => {
    const hill = parse(
      RunnerJob,
      { kind: 'hill', hill: 'main', submissionId: 's-1', botVersionId: 'v1' },
      'the job',
    )
    expect(runnerJobId(hill)).toBe('hill:main:s-1')
    const tournament = parse(RunnerJob, { kind: 'tournament', tournamentId: 't_1' }, 'the job')
    expect(runnerJobId(tournament)).toBe('tournament:t_1')
    expect(liveRoomName({ kind: 'hill', id: 'hill-main' })).toBe('hill:hill-main')
  })

  it('refuse a job whose ids would not make a job id or a match id', () => {
    const job = { kind: 'hill', hill: 'main', submissionId: 's1', botVersionId: 'v1' }
    expect(RunnerJob.safeParse({ ...job, submissionId: 'a:b' }).success).toBe(false)
    expect(RunnerJob.safeParse({ ...job, submissionId: 'x'.repeat(49) }).success).toBe(false)
    expect(RunnerJob.safeParse({ ...job, hill: 'Main' }).success).toBe(false)
    expect(RunnerJob.safeParse({ kind: 'hill', tournamentId: 't1' }).success).toBe(false)
    expect(RunnerJob.safeParse({ ...job, kind: 'melee' }).success).toBe(false)
  })
})
