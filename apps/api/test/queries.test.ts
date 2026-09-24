import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  getBot,
  getBotVersionRow,
  getHillBySlug,
  getTournament,
  getUserByHandle,
  listBotsByOwner,
  listBotVersions,
  listHillEntries,
  listHillMatches,
  listHills,
  listTournamentMatches,
  listTournaments,
  toBotVersion,
} from '../src/db/queries'

const SHA = 'ab'.repeat(32)
const CONFIG = { cycles: 100000, maxProcs: 64, spacing: 512 }
const T = '2026-09-24T12:00:00.000Z'

beforeAll(async () => {
  const insert = (sql: string, ...values: unknown[]) => env.DB.prepare(sql).bind(...values)
  await env.DB.batch([
    insert("INSERT INTO users (id, handle) VALUES ('u1', 'Pedram')"),
    insert(
      `INSERT INTO bots (id, owner_id, slug, name, visibility, updated_at) VALUES
       ('b1', 'u1', 'imp', 'Imp', 'public', ?), ('b2', 'u1', 'secret', 'Secret', 'private', ?)`,
      T,
      '2026-09-25T00:00:00.000Z',
    ),
    insert(
      `INSERT INTO bot_versions (id, bot_id, version, source, bytes_sha256, size, isa) VALUES
       ('v1', 'b1', 1, 'mov', ?, 4, 'x16c-v1'), ('v2', 'b1', 2, 'mov mov', ?, 8, 'x16c-v1'),
       ('v3', 'b2', 1, 'jmp', ?, 2, 'x16c-v1')`,
      SHA,
      SHA,
      SHA,
    ),
    insert(
      `INSERT INTO hills (id, slug, name, size, rounds, config_json) VALUES
       ('h1', 'main', 'Main', 32, 10, ?)`,
      JSON.stringify(CONFIG),
    ),
    insert(
      `INSERT INTO hill_entries (hill_id, bot_version_id, score, rank) VALUES
       ('h1', 'v2', 150, 1), ('h1', 'v3', 90, 2)`,
    ),
    insert(
      `INSERT INTO matches (id, hill_id, participants_json, rounds, seed, result_json, finished_at)
       VALUES ('m1', 'h1', '["v2","v3"]', 10, 7, ?, ?),
              ('m2', 'h1', '["v3","v1"]', 10, 8, NULL, ?),
              ('m3', 'h1', '["v1","v3"]', 10, 9, NULL, NULL)`,
      JSON.stringify({ points: [3, 0], survivors: [0], resultHash: '0123456789abcdef' }),
      T,
      '2026-09-24T13:00:00.000Z',
    ),
    insert(
      `INSERT INTO tournaments (id, slug, name, kind, status, config_json, starts_at) VALUES
       ('t1', 'weekly-1', 'Weekly 1', 'roundrobin', 'finished', ?, '2026-09-19T18:00:00Z'),
       ('t2', 'weekly-2', 'Weekly 2', 'bracket', 'running', ?, '2026-09-26T18:00:00Z')`,
      JSON.stringify({ rounds: 5, seed: 1, battle: CONFIG }),
      JSON.stringify({ rounds: 5, seed: 2, battle: CONFIG }),
    ),
    insert(
      `INSERT INTO matches (id, tournament_id, participants_json, rounds, seed) VALUES
       ('m4', 't2', '["v1","v2"]', 5, 1)`,
    ),
  ])
})

describe('the schema', () => {
  it('has the §7 indexes', async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    ).all<{ name: string }>()
    expect(results.map((r) => r.name)).toEqual([
      'bot_versions_bot_version',
      'bots_owner',
      'hill_entries_rank',
      'matches_hill_finished',
      'matches_tournament',
      'tournaments_starts',
    ])
  })

  it('refuses a bad visibility, a duplicate version, and a dangling owner', async () => {
    const fails = (sql: string) => expect(env.DB.prepare(sql).run()).rejects.toThrow()
    await fails(
      "INSERT INTO bots (id, owner_id, slug, name, visibility) VALUES ('x', 'u1', 'x', 'X', 'secret')",
    )
    await fails(
      `INSERT INTO bot_versions (id, bot_id, version, source, bytes_sha256, size, isa)
       VALUES ('x', 'b1', 1, '', '${SHA}', 1, 'x16c-v1')`,
    )
    await fails("INSERT INTO bots (id, owner_id, slug, name) VALUES ('x', 'nobody', 'x', 'X')")
  })
})

describe('query helpers', () => {
  it('finds a user by handle in any case', async () => {
    const user = await getUserByHandle(env.DB, 'pedram')
    expect(user).toMatchObject({ id: 'u1', handle: 'Pedram', avatarUrl: null })
    expect(user?.createdAt).toMatch(/^\d{4}-\d\d-\d\dT/)
  })

  it('reads bots, public only for strangers, newest change first', async () => {
    expect(await getBot(env.DB, 'b1')).toMatchObject({ slug: 'imp', visibility: 'public' })
    expect(await getBot(env.DB, 'nope')).toBeNull()
    expect((await listBotsByOwner(env.DB, 'u1', false)).map((b) => b.id)).toEqual(['b2', 'b1'])
    expect((await listBotsByOwner(env.DB, 'u1', true)).map((b) => b.id)).toEqual(['b1'])
  })

  it('shows a version source only when asked', async () => {
    const row = await getBotVersionRow(env.DB, 'b1', 2)
    expect(row && toBotVersion(row, true).source).toBe('mov mov')
    expect(row && 'source' in toBotVersion(row, false)).toBe(false)
    const versions = await listBotVersions(env.DB, 'b1')
    expect(versions.map((v) => v.version)).toEqual([2, 1])
    expect(versions.every((v) => v.source === undefined)).toBe(true)
  })

  it('reads hills with their config and standings king first', async () => {
    expect((await listHills(env.DB)).map((h) => h.slug)).toEqual(['main'])
    expect((await getHillBySlug(env.DB, 'main'))?.config).toEqual(CONFIG)
    expect(await getHillBySlug(env.DB, 'nope')).toBeNull()
    const standings = await listHillEntries(env.DB, 'h1')
    expect(standings.map((e) => [e.botVersionId, e.rank, e.rating])).toEqual([
      ['v2', 1, 1500],
      ['v3', 2, 1500],
    ])
  })

  it('lists a hill’s finished matches newest first, or one bot’s', async () => {
    expect((await listHillMatches(env.DB, 'h1')).map((m) => m.id)).toEqual(['m2', 'm1'])
    const v2 = await listHillMatches(env.DB, 'h1', { botVersionId: 'v2' })
    expect(v2.map((m) => m.id)).toEqual(['m1'])
    expect(v2[0]).toMatchObject({ participants: ['v2', 'v3'], result: { points: [3, 0] } })
    expect(await listHillMatches(env.DB, 'h1', { limit: 1 })).toHaveLength(1)
  })

  it('reads tournaments, running first, with their matches', async () => {
    expect((await listTournaments(env.DB)).map((t) => t.id)).toEqual(['t2', 't1'])
    const t2 = await getTournament(env.DB, 't2')
    expect(t2).toMatchObject({ kind: 'bracket', bracket: null, ownerId: null })
    expect(t2?.config.seed).toBe(2)
    const matches = await listTournamentMatches(env.DB, 't2')
    expect(matches).toEqual([
      {
        id: 'm4',
        tournamentId: 't2',
        hillId: null,
        participants: ['v1', 'v2'],
        rounds: 5,
        seed: 1,
        result: null,
        replayKey: null,
        finishedAt: null,
      },
    ])
  })
})
