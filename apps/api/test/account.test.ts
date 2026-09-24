/**
 * The account routes (`PATCH /api/me`, `POST /api/bots/import`) and the test sign-in that e2e
 * runs on (`DEV_FAKE_AUTH`). The Worker's own module takes each request, with that variable set,
 * so a sign-in needs no stub of GitHub.
 */

import { env } from 'cloudflare:workers'
import { ImportBotsResult, MAX_BOTS_PER_USER, Me, parse, UserDetail } from '@asmbots/protocol'
import { describe, expect, it } from 'vitest'
import { botBytesKey } from '../src/storage'
import { errorOf, HALT, me, SPIN, send, signIn } from './fake-auth'
import { Jar } from './jar'

describe('DEV_FAKE_AUTH', () => {
  it('signs in the test user without GitHub, on localhost', async () => {
    const jar = new Jar()
    const res = await signIn(jar, 'fake-one')
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('/editor')
    const { user, onboarded } = await me(jar)
    expect(user.handle).toBe('fake-one')
    expect(onboarded).toBe(false)
  })

  it('signs in e2e-tester when nothing names a login, the same user each time', async () => {
    const a = new Jar()
    const b = new Jar()
    await signIn(a, '')
    await signIn(b, 'NOT_A_LOGIN')
    expect((await me(a)).user.handle).toBe('e2e-tester')
    expect((await me(b)).user.id).toBe((await me(a)).user.id)
  })

  it('is off for any other host, and when the variable is not 1', async () => {
    const remote = await send(new Jar(), '/api/auth/github', { site: 'https://asmbots.test' })
    expect(remote.headers.get('Location')).toMatch(/^https:\/\/github\.com\/login\/oauth\//)
    const unset = await send(new Jar(), '/api/auth/github', { vars: env })
    expect(unset.headers.get('Location')).toMatch(/^https:\/\/github\.com\/login\/oauth\//)
  })
})

describe('PATCH /api/me', () => {
  it('sets the handle, lowercased, and marks the user onboarded', async () => {
    const jar = new Jar()
    await signIn(jar, 'patch-me')
    const res = await send(jar, '/api/me', { method: 'PATCH', body: { handle: ' New-Name ' } })
    expect(res.status).toBe(200)
    const body = parse(Me, await res.json(), 'me')
    expect(body.user.handle).toBe('new-name')
    expect(body.onboarded).toBe(true)
    expect((await me(jar)).user.handle).toBe('new-name')
    expect((await send(jar, '/api/users/new-name')).status).toBe(200)
    expect((await send(jar, '/api/users/patch-me')).status).toBe(404)
  })

  it('keeps the handle it has when asked for it again', async () => {
    const jar = new Jar()
    await signIn(jar, 'keeper')
    const res = await send(jar, '/api/me', { method: 'PATCH', body: { handle: 'keeper' } })
    expect(res.status).toBe(200)
    expect(parse(Me, await res.json(), 'me')).toMatchObject({ onboarded: true })
  })

  it('refuses a handle someone else has, in any case', async () => {
    await signIn(new Jar(), 'first-come')
    const jar = new Jar()
    await signIn(jar, 'second-come')
    const res = await send(jar, '/api/me', { method: 'PATCH', body: { handle: 'FIRST-COME' } })
    expect(await errorOf(res)).toEqual({
      status: 409,
      code: 'conflict',
      message: 'first-come is taken',
    })
    expect((await me(jar)).user.handle).toBe('second-come')
  })

  it('refuses a handle that breaks the rules', async () => {
    const jar = new Jar()
    await signIn(jar, 'rule-bound')
    const cases: [unknown, string][] = [
      ['ab', 'a handle is 3 to 24 characters'],
      ['a'.repeat(25), 'a handle is 3 to 24 characters'],
      ['under_score', 'a handle takes a-z, 0-9, and -'],
      ['-edge', 'a hyphen goes between two letters or digits'],
      ['dou--ble', 'a hyphen goes between two letters or digits'],
      ['admin', 'admin is reserved'],
      ['Arena', 'arena is reserved'],
    ]
    for (const [handle, message] of cases) {
      const res = await send(jar, '/api/me', { method: 'PATCH', body: { handle } })
      expect(await errorOf(res), String(handle)).toEqual({
        status: 400,
        code: 'bad_request',
        message,
      })
    }
    const res = await send(jar, '/api/me', { method: 'PATCH', body: { name: 'x' } })
    expect(res.status).toBe(400)
    expect((await me(jar)).onboarded).toBe(false)
  })

  it('is 401 signed out', async () => {
    const res = await send(new Jar(), '/api/me', { method: 'PATCH', body: { handle: 'nobody' } })
    expect(res.status).toBe(401)
  })
})

describe('POST /api/bots/import', () => {
  it('makes each bot at version 1, private, with its bytes in R2', async () => {
    const jar = new Jar()
    await signIn(jar, 'importer')
    const res = await send(jar, '/api/bots/import', {
      method: 'POST',
      body: {
        bots: [
          { name: 'Spin', source: SPIN },
          { name: 'Spin', source: SPIN, visibility: 'public' },
          { name: 'Halt!', source: HALT },
        ],
      },
    })
    expect(res.status).toBe(201)
    const { results } = parse(ImportBotsResult, await res.json(), 'the import')
    const made = results.map((r) => (r.ok ? r : null))
    expect(made.map((r) => [r?.bot.slug, r?.bot.visibility, r?.version.version])).toEqual([
      ['spin', 'private', 1],
      ['spin-2', 'public', 1],
      ['halt', 'private', 1],
    ])
    const spin = made[0]
    expect(spin?.version).toMatchObject({ author: 'Tester', strategy: 'Jump to itself' })
    expect(spin?.version.source).toBe(SPIN)
    const bytes = await env.REPLAYS.get(botBytesKey(spin?.version.bytesSha256 ?? ''))
    expect(bytes?.size).toBe(spin?.version.size)

    const profile = await send(jar, '/api/users/importer')
    const { bots } = parse(UserDetail, await profile.json(), 'the profile')
    expect(bots.map((b) => b.name).sort()).toEqual(['Halt!', 'Spin', 'Spin'])
    const theirs = await send(new Jar(), '/api/users/importer')
    const { bots: shown } = parse(UserDetail, await theirs.json(), 'the profile')
    expect(shown.map((b) => b.slug)).toEqual(['spin-2'])
  })

  it('refuses a bot that does not assemble or is over the size cap, and makes the rest', async () => {
    const jar = new Jar()
    await signIn(jar, 'mixed-bag')
    const big = `%name "Huge"\nstart:\n${'  nop\n'.repeat(600)}  jmp start\n`
    const res = await send(jar, '/api/bots/import', {
      method: 'POST',
      body: {
        bots: [
          { name: 'Broken', source: '%name "Broken"\nstart: frob ax\n' },
          { name: 'Good', source: SPIN },
          { name: 'Huge', source: big },
        ],
      },
    })
    expect(res.status).toBe(201)
    const { results } = parse(ImportBotsResult, await res.json(), 'the import')
    expect(results.map((r) => r.ok)).toEqual([false, true, false])
    const codes = results.map((r) => (r.ok ? [] : r.diagnostics.map((d) => d.code)))
    expect(results[0]).toMatchObject({ ok: false, message: 'it does not assemble' })
    expect(codes[0]).toContain('unknown-mnemonic')
    expect(results[2]).toMatchObject({ ok: false, message: 'it does not assemble' })
    expect(codes[2]).toEqual(['size-over-cap'])
    const rows = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM bots b JOIN users u ON u.id = b.owner_id WHERE u.handle = ?',
    )
      .bind('mixed-bag')
      .first<{ n: number }>()
    expect(rows?.n).toBe(1)
  })

  it('is 409 when the account would hold too many bots', async () => {
    const jar = new Jar()
    await signIn(jar, 'hoarder')
    const { user } = await me(jar)
    const fill = Array.from({ length: MAX_BOTS_PER_USER - 1 }, (_, i) =>
      env.DB.prepare('INSERT INTO bots (id, owner_id, slug, name) VALUES (?, ?, ?, ?)').bind(
        `hoard-${i}`,
        user.id,
        `hoard-${i}`,
        `Hoard ${i}`,
      ),
    )
    await env.DB.batch(fill)
    const two = {
      bots: [
        { name: 'A', source: SPIN },
        { name: 'B', source: SPIN },
      ],
    }
    const res = await send(jar, '/api/bots/import', { method: 'POST', body: two })
    expect(await errorOf(res)).toEqual({
      status: 409,
      code: 'conflict',
      message: 'an account holds 200 bots: there is room for 1 more',
    })
    const one = { bots: [{ name: 'A', source: SPIN }] }
    expect((await send(jar, '/api/bots/import', { method: 'POST', body: one })).status).toBe(201)
  })

  it('is 401 signed out and 400 for a body that is not an import', async () => {
    const body = { bots: [{ name: 'Spin', source: SPIN }] }
    expect((await send(new Jar(), '/api/bots/import', { method: 'POST', body })).status).toBe(401)
    const jar = new Jar()
    await signIn(jar, 'bad-body')
    for (const bad of [{ bots: [] }, { bots: [{ name: '', source: SPIN }] }, { name: 'Spin' }]) {
      const res = await send(jar, '/api/bots/import', { method: 'POST', body: bad })
      expect(res.status, JSON.stringify(bad)).toBe(400)
    }
  })
})

describe('GET /api/users/:handle championships', () => {
  it('counts W/T/L over the matches a bot played, and a champion won the last one', async () => {
    const jar = new Jar()
    await signIn(jar, 'champ')
    const imported = await send(jar, '/api/bots/import', {
      method: 'POST',
      body: { bots: [{ name: 'Spin', source: SPIN }] },
    })
    const { results } = parse(ImportBotsResult, await imported.json(), 'the import')
    const mine = results[0]?.ok ? results[0].version.id : ''
    await signIn(new Jar(), 'rival')
    const rival = await env.DB.prepare("SELECT id FROM users WHERE handle = 'rival'").first<{
      id: string
    }>()
    const insert = (sql: string, ...values: unknown[]) => env.DB.prepare(sql).bind(...values)
    const outcome = (points: number[]) =>
      JSON.stringify({ points, survivors: [0, 0], resultHash: '0'.repeat(16) })
    await env.DB.batch([
      insert(
        `INSERT INTO bots (id, owner_id, slug, name) VALUES ('rb', ?, 'rb', 'Rival');`,
        rival?.id,
      ),
      insert(
        `INSERT INTO bot_versions (id, bot_id, version, source, bytes_sha256, size, isa)
         VALUES ('rb-v1', 'rb', 1, 'hlt', ?, 1, 'x16c-v1')`,
        'cd'.repeat(32),
      ),
      insert(
        `INSERT INTO tournaments (id, slug, name, kind, status, config_json, owner_id, starts_at)
         VALUES ('cup', 'cup-1', 'Cup 1', 'bracket', 'finished', '{}', NULL, '2026-09-19T18:00:00Z')`,
      ),
      insert(
        `INSERT INTO tournament_entries (tournament_id, bot_version_id) VALUES
         ('cup', ?), ('cup', 'rb-v1')`,
        mine,
      ),
      ...[
        [[3, 0], '2026-09-19T18:01:00Z'],
        [[1, 1], '2026-09-19T18:02:00Z'],
        [[0, 3], '2026-09-19T18:03:00Z'],
        [[3, 0], '2026-09-19T18:04:00Z'],
      ].map(([points, at], i) =>
        insert(
          `INSERT INTO matches (id, tournament_id, participants_json, rounds, seed, result_json, finished_at)
           VALUES (?, 'cup', ?, 3, 1, ?, ?)`,
          `cup-m${i}`,
          JSON.stringify([mine, 'rb-v1']),
          outcome(points as number[]),
          at,
        ),
      ),
    ])
    const res = await send(new Jar(), '/api/users/champ')
    const { championships } = parse(UserDetail, await res.json(), 'the profile')
    expect(championships).toEqual([
      {
        tournament: { id: 'cup', slug: 'cup-1', name: 'Cup 1', startsAt: '2026-09-19T18:00:00Z' },
        bot: expect.objectContaining({ name: 'Spin', owner: 'champ' }),
        wins: 2,
        ties: 1,
        losses: 1,
        champion: true,
      },
    ])
    const rivalRes = await send(new Jar(), '/api/users/rival')
    const theirs = parse(UserDetail, await rivalRes.json(), 'the profile').championships
    expect(theirs.map((r) => [r.wins, r.ties, r.losses, r.champion])).toEqual([[1, 1, 2, false]])
  })
})
