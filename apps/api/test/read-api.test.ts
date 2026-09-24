/**
 * The public read API on the launch seed (`src/db/seed.ts`) of three small bots, plus rows that
 * test visibility: a private bot, an unlisted one, a draft tournament.
 */
import { env, exports } from 'cloudflare:workers'
import {
  BotDetail,
  BotVersionDetail,
  HillDetail,
  HillList,
  MatchList,
  parse,
  parseReplay,
  replayKey,
  TournamentDetail,
  TournamentList,
  UserDetail,
} from '@asmbots/protocol'
import { beforeAll, describe, expect, it } from 'vitest'
import { applySeed, buildSeed, SEED_HILLS, sqlScript } from '../src/db/seed'
import { botBytesKey, replayObjectKey } from '../src/storage'

const worker = exports.default

function get(path: string): Promise<Response> {
  return worker.fetch(new Request(`https://asmbots.test${path}`))
}

async function read<T>(path: string, schema: Parameters<typeof parse>[0]): Promise<T> {
  const res = await get(path)
  expect(res.status, path).toBe(200)
  return parse(schema, await res.json(), path) as T
}

async function errorOf(path: string): Promise<{ status: number; code: string }> {
  const res = await get(path)
  const body = (await res.json()) as { error: { code: string } }
  return { status: res.status, code: body.error.code }
}

const SOURCES = [
  {
    slug: 'spin',
    melee: true,
    source: '%name "Spin"\n%author "ASM Bots"\n%strategy "Jump to itself"\nstart: jmp $\n',
  },
  {
    slug: 'halt',
    melee: true,
    source: '%name "Halt"\n%author "ASM Bots"\nstart: hlt ; lint: allow hlt-in-code\n',
  },
  {
    slug: 'dwarf',
    melee: false,
    source: `%name "Dwarf"
%author "ASM Bots"
%strategy "Bomb every 4th byte, walking backward"
SIZE equ end - start
start:  call .here
.here:  pop bx
        sub bx, .here
lap:    mov di, bx
        mov cx, (0x10000 - SIZE) / 4
.bomb:  sub di, 4
        mov word [di], 0
        loop .bomb
        jmp lap
end:
`,
  },
]

const NOW = new Date('2026-09-24T12:00:00.000Z')

beforeAll(async () => {
  await applySeed(env, await buildSeed(SOURCES, { now: NOW }))
  const insert = (sql: string, ...values: unknown[]) => env.DB.prepare(sql).bind(...values)
  const config = JSON.stringify({ rounds: 3, seed: 1, battle: SEED_HILLS[0]?.config })
  await env.DB.batch([
    insert("INSERT INTO users (id, handle) VALUES ('u1', 'Pedram')"),
    insert(
      `INSERT INTO bots (id, owner_id, slug, name, visibility) VALUES
       ('secret', 'u1', 'secret', 'Secret', 'private'),
       ('quiet', 'u1', 'quiet', 'Quiet', 'unlisted'),
       ('open', 'u1', 'open', 'Open', 'public')`,
    ),
    insert(
      `INSERT INTO bot_versions (id, bot_id, version, source, bytes_sha256, size, isa) VALUES
       ('secret-v1', 'secret', 1, 'hlt', ?1, 1, 'x16c-v1'),
       ('quiet-v1', 'quiet', 1, 'nop', ?1, 1, 'x16c-v1')`,
      'ab'.repeat(32),
    ),
    insert(
      `INSERT INTO tournaments (id, slug, name, kind, status, config_json, owner_id, starts_at)
       VALUES ('t1', 'weekly-1', 'Weekly 1', 'roundrobin', 'finished', ?1, NULL, '2026-09-19T18:00:00Z'),
              ('t2', 'my-draft', 'My draft', 'melee', 'draft', ?1, 'u1', NULL)`,
      config,
    ),
    insert(
      `INSERT INTO tournament_entries (tournament_id, bot_version_id, seed) VALUES
       ('t1', 'roster-dwarf-v1', 2), ('t1', 'roster-spin-v1', 1)`,
    ),
  ])
})

describe('the seed', () => {
  it('seeds 3 hills, with the roster bots on them', async () => {
    const { hills } = await read<HillList>('/api/hills', HillList)
    expect(hills.map((h) => h.hill.slug)).toEqual(['main', 'melee', 'tiny'])
    const main = hills.find((h) => h.hill.slug === 'main')
    expect(main).toMatchObject({ entrants: 3, hill: { size: 32, rounds: 10 } })
    expect(main?.hill.config.maxBotBytes).toBe(512)
    expect(main?.king?.entry.rank).toBe(1)
    expect(main?.king?.bot.owner).toBe('system')
    const tiny = hills.find((h) => h.hill.slug === 'tiny')
    expect(tiny?.hill.config).toMatchObject({ maxBotBytes: 256, maxCycles: 50_000 })
    // The melee hill takes the bots marked for it only.
    expect(hills.find((h) => h.hill.slug === 'melee')?.entrants).toBe(2)
  })

  it('stores each bot version’s bytes in R2 under its SHA-256', async () => {
    const { version } = await read<BotVersionDetail>(
      '/api/bots/roster-spin/versions/1',
      BotVersionDetail,
    )
    const object = await env.REPLAYS.get(botBytesKey(version.bytesSha256))
    expect(new Uint8Array((await object?.arrayBuffer()) ?? new ArrayBuffer(0))).toHaveLength(
      version.size,
    )
    expect(version).toMatchObject({
      author: 'ASM Bots',
      strategy: 'Jump to itself',
      isa: 'x16c-v1',
    })
  })

  it('adds nothing when it runs again', async () => {
    const count = () =>
      env.DB.prepare('SELECT COUNT(*) AS n FROM matches').first<{ n: number }>('n')
    const before = await count()
    await applySeed(env, await buildSeed(SOURCES, { now: new Date() }))
    expect(await count()).toBe(before)
  })

  it('writes a SQL script with its values inlined and quoted', () => {
    const script = sqlScript([
      { sql: 'INSERT INTO t (a, b, c) VALUES (?, ?, ?)', params: ["it's ?", 3, null] },
    ])
    expect(script).toBe("INSERT INTO t (a, b, c) VALUES ('it''s ?', 3, NULL);\n")
  })
})

describe('GET /api/hills/:slug', () => {
  it('gives the standings, king first, each with its bot’s label', async () => {
    const { hill, standings } = await read<HillDetail>('/api/hills/main', HillDetail)
    expect(hill.slug).toBe('main')
    expect(standings.map((s) => s.entry.rank)).toEqual([1, 2, 3])
    expect(standings.map((s) => s.bot.name).sort()).toEqual(['Dwarf', 'Halt', 'Spin'])
    const scores = standings.map((s) => s.entry.score)
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
  })

  it('answers 404 for a hill that is not there, and 400 for a bad slug', async () => {
    expect(await errorOf('/api/hills/nope')).toEqual({ status: 404, code: 'not_found' })
    expect(await errorOf('/api/hills/Not_A_Slug')).toEqual({ status: 400, code: 'bad_request' })
  })
})

describe('GET /api/hills/:slug/matches', () => {
  it('lists the finished matches newest first, with each entrant’s label', async () => {
    const { matches } = await read<MatchList>('/api/hills/main/matches', MatchList)
    // Three bots: one match per pair.
    expect(matches).toHaveLength(3)
    const times = matches.map((m) => m.match.finishedAt ?? '')
    expect(times).toEqual([...times].sort().reverse())
    for (const { match, bots } of matches) {
      expect(bots.map((b) => b?.versionId)).toEqual(match.participants)
      expect(match.replayKey).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it('takes one bot version’s matches, and a limit', async () => {
    const spin = await read<MatchList>('/api/hills/main/matches?bot=roster-spin-v1', MatchList)
    expect(spin.matches).toHaveLength(2)
    expect(spin.matches.every((m) => m.match.participants.includes('roster-spin-v1'))).toBe(true)
    const one = await read<MatchList>('/api/hills/main/matches?limit=1', MatchList)
    expect(one.matches).toHaveLength(1)
    expect(await errorOf('/api/hills/main/matches?limit=0')).toEqual({
      status: 400,
      code: 'bad_request',
    })
  })
})

describe('GET /api/replays/:key', () => {
  it('serves a seeded match’s replay from R2, immutable, and it checks out', async () => {
    const { matches } = await read<MatchList>('/api/hills/melee/matches', MatchList)
    const key = matches[0]?.match.replayKey ?? ''
    const res = await get(`/api/replays/${key}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
    expect(res.headers.get('Content-Type')).toContain('application/json')
    const replay = parseReplay(await res.json())
    expect(await replayKey(replay)).toBe(key)
    expect(replay.bots.map((b) => b.name)).toEqual(['Spin', 'Halt'])
    expect(replay.result.points).toEqual(matches[0]?.match.result?.points)
  })

  it('round trips a replay put in R2', async () => {
    const { matches } = await read<MatchList>('/api/hills/tiny/matches', MatchList)
    const stored = parseReplay(
      await (await get(`/api/replays/${matches[0]?.match.replayKey}`)).json(),
    )
    const copy = { ...stored, createdAt: '2026-01-01T00:00:00.000Z' }
    const key = await replayKey(copy)
    expect(key).toBe(matches[0]?.match.replayKey)
    const other = { ...copy, seed: 99 }
    const otherKey = await replayKey(other)
    await env.REPLAYS.put(replayObjectKey(otherKey), JSON.stringify(other))
    const back = parseReplay(await (await get(`/api/replays/${otherKey}`)).json())
    expect(back).toEqual(other)
  })

  it('answers 404 for a key it does not have, and 400 for a malformed one', async () => {
    expect(await errorOf(`/api/replays/${'0'.repeat(64)}`)).toEqual({
      status: 404,
      code: 'not_found',
    })
    expect(await errorOf('/api/replays/abc')).toEqual({ status: 400, code: 'bad_request' })
  })
})

describe('GET /api/bots/:id', () => {
  it('gives the bot, its owner, its versions without sources, and its places', async () => {
    const detail = await read<BotDetail>('/api/bots/roster-dwarf', BotDetail)
    expect(detail.bot).toMatchObject({ name: 'Dwarf', slug: 'dwarf', visibility: 'public' })
    expect(detail.owner.handle).toBe('system')
    expect(detail.versions.map((v) => v.version)).toEqual([1])
    expect(detail.versions[0]?.source).toBeUndefined()
    expect(detail.placements.map((p) => p.hill.slug).sort()).toEqual(['main', 'tiny'])
  })

  it('shows a public bot’s source', async () => {
    const { version } = await read<BotVersionDetail>(
      '/api/bots/roster-dwarf/versions/1',
      BotVersionDetail,
    )
    expect(version.source).toBe(SOURCES[2]?.source)
  })

  it('shows an unlisted bot to anyone with its id, but not its source', async () => {
    expect((await read<BotDetail>('/api/bots/quiet', BotDetail)).bot.name).toBe('Quiet')
    const { version } = await read<BotVersionDetail>('/api/bots/quiet/versions/1', BotVersionDetail)
    expect(version.source).toBeUndefined()
  })

  it('answers 404 for a private bot, as for a missing one', async () => {
    expect(await errorOf('/api/bots/secret')).toEqual({ status: 404, code: 'not_found' })
    expect(await errorOf('/api/bots/secret/versions/1')).toEqual({
      status: 404,
      code: 'not_found',
    })
    expect(await errorOf('/api/bots/nope')).toEqual({ status: 404, code: 'not_found' })
    expect(await errorOf('/api/bots/roster-dwarf/versions/2')).toEqual({
      status: 404,
      code: 'not_found',
    })
    expect(await errorOf('/api/bots/roster-dwarf/versions/x')).toEqual({
      status: 400,
      code: 'bad_request',
    })
  })
})

describe('GET /api/users/:handle', () => {
  it('gives the user and their public bots, whatever the handle’s case', async () => {
    const { user, bots } = await read<UserDetail>('/api/users/PEDRAM', UserDetail)
    expect(user.handle).toBe('Pedram')
    expect(bots.map((b) => b.id)).toEqual(['open'])
    const system = await read<UserDetail>('/api/users/system', UserDetail)
    expect(system.bots).toHaveLength(3)
    expect(await errorOf('/api/users/nobody')).toEqual({ status: 404, code: 'not_found' })
  })

  it('gives their best place on each hill and their championship results', async () => {
    const pedram = await read<UserDetail>('/api/users/pedram', UserDetail)
    expect(pedram.hills).toEqual([])
    expect(pedram.championships).toEqual([])
    const system = await read<UserDetail>('/api/users/system', UserDetail)
    expect(system.hills.map((h) => [h.hill.slug, h.entry.rank])).toEqual([
      ['main', 1],
      ['melee', 1],
      ['tiny', 1],
    ])
    const results = system.championships.map((r) => [r.tournament.slug, r.bot.name, r.wins])
    expect(results.sort()).toEqual([
      ['weekly-1', 'Dwarf', 0],
      ['weekly-1', 'Spin', 0],
    ])
  })
})

describe('GET /api/tournaments', () => {
  it('lists tournaments, leaving drafts out', async () => {
    const { tournaments } = await read<TournamentList>('/api/tournaments', TournamentList)
    expect(tournaments.map((s) => s.tournament.id)).toEqual(['t1'])
    // A finished round robin of 2: its one match not stored here, its champion not written.
    expect(tournaments[0]).toMatchObject({ entrants: 2, done: 0, of: 1, champion: null })
  })

  it('gives a tournament with its entrants by seed and its matches', async () => {
    const detail = await read<TournamentDetail>('/api/tournaments/t1', TournamentDetail)
    expect(detail.tournament.name).toBe('Weekly 1')
    expect(detail.entrants.map((e) => e.name)).toEqual(['Spin', 'Dwarf'])
    expect(detail.matches).toEqual([])
    expect(await errorOf('/api/tournaments/t2')).toEqual({ status: 404, code: 'not_found' })
  })
})
