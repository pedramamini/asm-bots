/**
 * Rate limits (per user when signed in, else per IP), the audit log (`GET /api/me/audit`), and
 * account deletion (`DELETE /api/me`).
 */

import { env } from 'cloudflare:workers'
import {
  AuditList,
  HillDetail,
  ImportBotsResult,
  parse,
  SavedBot,
  type UpdateMe,
} from '@asmbots/protocol'
import { describe, expect, it } from 'vitest'
import { errorOf, HALT, me, SPIN, send, signIn } from './fake-auth'
import { Jar } from './jar'

const HILL_CONFIG = {
  coreSize: 65536,
  maxCycles: 100000,
  maxProcesses: 64,
  minSpacing: 512,
  maxBotBytes: 512,
}

/** Signs in `as` on a new jar (at `ip`, when given). */
async function signedIn(as: string, ip?: string): Promise<Jar> {
  const jar = new Jar(ip)
  await signIn(jar, as)
  return jar
}

async function makeBot(jar: Jar, source = SPIN) {
  const res = await send(jar, '/api/bots', { method: 'POST', body: { name: 'Spin', source } })
  expect(res.status).toBe(201)
  return parse(SavedBot, await res.json(), 'the bot')
}

async function audit(jar: Jar, query = '') {
  const res = await send(jar, `/api/me/audit${query}`)
  expect(res.status).toBe(200)
  return parse(AuditList, await res.json(), 'the audit').entries
}

async function userId(handle: string): Promise<string | undefined> {
  const row = await env.DB.prepare('SELECT id FROM users WHERE handle = ?')
    .bind(handle)
    .first<{ id: string }>()
  return row?.id
}

describe('rate limits', () => {
  it('answers the 31st assemble in a minute with 429 and Retry-After', async () => {
    const jar = new Jar()
    const assemble = () => send(jar, '/api/assemble', { method: 'POST', body: { source: SPIN } })
    for (let i = 0; i < 30; i++) {
      const res = await assemble()
      expect(res.status).toBe(200)
      expect(res.headers.get('X-RateLimit-Remaining')).toBe(String(29 - i))
    }
    const limited = await assemble()
    expect(limited.status).toBe(429)
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect(await errorOf(limited)).toMatchObject({ code: 'rate_limited' })
    // Another client has its own count.
    expect(
      (await send(new Jar(), '/api/assemble', { method: 'POST', body: { source: SPIN } })).status,
    ).toBe(200)
  })

  it('counts a signed-in user by user, not by IP', async () => {
    const ip = '10.9.9.9'
    const a = await signedIn('limit-a', ip)
    const b = await signedIn('limit-b', ip)
    const version = (jar: Jar) =>
      send(jar, '/api/bots/nope/versions', { method: 'POST', body: { source: SPIN } })
    // One `POST /api/bots` counts once, though two patterns cover `/api/bots`.
    const first = await send(a, '/api/bots', { method: 'POST', body: { name: 'A', source: SPIN } })
    expect(first.headers.get('X-RateLimit-Limit')).toBe('20')
    expect(first.headers.get('X-RateLimit-Remaining')).toBe('19')
    for (let i = 0; i < 19; i++) expect((await version(a)).status).toBe(404)
    const limited = await version(a)
    expect(limited.status).toBe(429)
    expect(limited.headers.get('Retry-After')).not.toBeNull()
    // Same IP, another user; and the IP signed out: each its own count.
    expect((await version(b)).status).toBe(404)
    const anon = await send(new Jar(ip), '/api/bots', { method: 'POST', body: {} })
    expect(anon.status).toBe(401)
    expect(anon.headers.get('X-RateLimit-Remaining')).toBe('19')
  })

  it('holds replays to 10 a minute and sign-in to 10 requests a minute', async () => {
    const replay = await send(new Jar(), '/api/replays', { method: 'POST', body: {} })
    expect(replay.status).toBe(400)
    expect(replay.headers.get('X-RateLimit-Limit')).toBe('10')
    const jar = new Jar()
    for (let i = 0; i < 10; i++) {
      expect((await send(jar, '/api/auth/github')).status).toBe(302)
    }
    const limited = await send(jar, '/api/auth/github')
    expect(limited.status).toBe(429)
    expect(await errorOf(limited)).toMatchObject({ code: 'rate_limited' })
  })
})

describe('GET /api/me/audit', () => {
  it('records bot create, update, version, and delete, newest first', async () => {
    const jar = await signedIn('auditor')
    const { bot } = await makeBot(jar)
    await send(jar, `/api/bots/${bot.id}`, { method: 'PATCH', body: { name: 'Spun' } })
    // The same bytes make no version, and no entry.
    await send(jar, `/api/bots/${bot.id}/versions`, { method: 'POST', body: { source: SPIN } })
    await send(jar, `/api/bots/${bot.id}/versions`, { method: 'POST', body: { source: HALT } })
    await send(jar, `/api/bots/${bot.id}`, { method: 'DELETE' })
    const entries = await audit(jar)
    expect(entries.map((e) => [e.action, e.target])).toEqual([
      ['bot.delete', bot.id],
      ['bot.version', `${bot.id}/v2`],
      ['bot.update', bot.id],
      ['bot.create', bot.id],
    ])
    expect((await audit(jar, '?limit=2')).map((e) => e.action)).toEqual([
      'bot.delete',
      'bot.version',
    ])
    expect((await send(jar, '/api/me/audit?limit=0')).status).toBe(400)
  })

  it('records one create per imported bot, and shows a user only their own', async () => {
    const jar = await signedIn('importer-audit')
    const res = await send(jar, '/api/bots/import', {
      method: 'POST',
      body: {
        bots: [
          { name: 'One', source: SPIN },
          { name: 'Bad', source: 'nope nope' },
          { name: 'Two', source: HALT },
        ],
      },
    })
    const { results } = parse(ImportBotsResult, await res.json(), 'the import')
    const made = results.flatMap((r) => (r.ok ? [r.bot.id] : []))
    expect(made).toHaveLength(2)
    const entries = await audit(jar)
    expect(entries.map((e) => e.action)).toEqual(['bot.create', 'bot.create'])
    expect(new Set(entries.map((e) => e.target))).toEqual(new Set(made))
    expect(await audit(await signedIn('someone-else'))).toEqual([])
    expect((await send(new Jar(), '/api/me/audit')).status).toBe(401)
  })
})

describe('DELETE /api/me', () => {
  it('deletes the user, their bots, their audit, and every session they have', async () => {
    const phone = await signedIn('leaver')
    const laptop = await signedIn('leaver')
    const id = await userId('leaver')
    const { bot } = await makeBot(phone)
    expect(await env.KV.list({ prefix: `usess:${id}:` })).toMatchObject({ keys: { length: 2 } })

    const res = await send(phone, '/api/me', { method: 'DELETE' })
    expect(res.status).toBe(204)
    expect(phone.cookies.size).toBe(0)
    expect((await send(phone, '/api/me')).status).toBe(401)
    expect((await send(laptop, '/api/me')).status).toBe(401)
    expect((await env.KV.list({ prefix: `usess:${id}:` })).keys).toEqual([])
    expect(await userId('leaver')).toBeUndefined()
    const left = (table: string, column: string, value: string) =>
      env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`)
        .bind(value)
        .first<{ n: number }>()
    expect(await left('bots', 'id', bot.id)).toEqual({ n: 0 })
    expect(await left('bot_versions', 'bot_id', bot.id)).toEqual({ n: 0 })
    expect(await left('audit', 'user_id', id ?? '')).toEqual({ n: 0 })

    // The GitHub account can sign up again, as a new user.
    const back = await signedIn('leaver')
    const again = await me(back)
    expect(again.onboarded).toBe(false)
    expect(again.user.id).not.toBe(id)
  })

  it('leaves hill entries in place, anonymized to [deleted]', async () => {
    const jar = await signedIn('hill-leaver')
    const { bot, version } = await makeBot(jar)
    const { bot: offHill } = await makeBot(jar, HALT)
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO hills (id, slug, name, size, rounds, config_json)
         VALUES ('h-gone', 'gone', 'Gone', 10, 1, ?)`,
      ).bind(JSON.stringify(HILL_CONFIG)),
      env.DB.prepare(
        `INSERT INTO hill_entries (hill_id, bot_version_id, rank) VALUES ('h-gone', ?, 1)`,
      ).bind(version.id),
    ])
    expect((await send(jar, '/api/me', { method: 'DELETE' })).status).toBe(204)

    const hill = await send(new Jar(), '/api/hills/gone')
    const { standings } = parse(HillDetail, await hill.json(), 'the hill')
    expect(standings.map((s) => s.bot)).toEqual([
      expect.objectContaining({
        botId: bot.id,
        name: '[deleted]',
        author: '[deleted]',
        owner: 'deleted',
      }),
    ])
    const kept = await env.DB.prepare('SELECT source FROM bot_versions WHERE id = ?')
      .bind(version.id)
      .first<{ source: string }>()
    expect(kept).toEqual({ source: '' })
    expect((await send(new Jar(), `/api/bots/${bot.id}`)).status).toBe(404)
    expect((await send(new Jar(), `/api/bots/${offHill.id}`)).status).toBe(404)
    expect(
      await env.DB.prepare('SELECT id FROM bots WHERE id = ?').bind(offHill.id).first(),
    ).toBeNull()
    // No one's profile, and no one's handle to take.
    expect((await send(new Jar(), '/api/users/deleted')).status).toBe(404)
    const other = await signedIn('would-be')
    const taken = await send(other, '/api/me', {
      method: 'PATCH',
      body: { handle: 'deleted' } satisfies UpdateMe,
    })
    expect(await errorOf(taken)).toMatchObject({ status: 400, message: 'deleted is reserved' })
  })

  it('is 401 signed out', async () => {
    expect((await send(new Jar(), '/api/me', { method: 'DELETE' })).status).toBe(401)
  })
})
