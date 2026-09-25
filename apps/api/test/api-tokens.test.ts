/**
 * Personal API tokens (`/api/me/tokens`, `src/auth/token.ts`): a user makes one on the site, and
 * a script or an AI agent then signs in with `Authorization: Bearer asmb_...` and no `Origin`, as
 * the CLI does. It can make bots and submit them to hills; it cannot make or revoke tokens,
 * delete the account, sign out, or read the admin stats. A revoked or made-up token is a 401.
 */
import { env } from 'cloudflare:workers'
import {
  API_TOKEN,
  ApiTokenList,
  AuditList,
  CreatedApiToken,
  HillSubmitted,
  MAX_API_TOKENS,
  Me,
  MyBotList,
  parse,
  SavedBot,
  sha256Hex,
} from '@asmbots/protocol'
import { beforeAll, describe, expect, it } from 'vitest'
import { type ApiTokenRow, getUserRow } from '../src/db/queries'
import { applySeed, buildSeed } from '../src/db/seed'
import worker from '../src/index'
import { errorOf, FAKE, HALT, LOCAL, me, SPIN, send, signIn } from './fake-auth'
import { Jar } from './jar'

/** Each request's `waitUntil` work, so a test can wait for a token to be marked used. */
const pending: Promise<unknown>[] = []
const CTX = {
  waitUntil: (p: Promise<unknown>) => pending.push(p),
  passThroughOnException: () => {},
  props: {},
} as unknown as ExecutionContext

async function settled(): Promise<void> {
  await Promise.all(pending.splice(0))
}

/** A request as a script sends it: the token, no cookie, no `Origin`. */
async function bearer(
  token: string,
  path: string,
  { method = 'GET', body }: { method?: string; body?: unknown } = {},
): Promise<Response> {
  const headers = new Headers({
    Authorization: `Bearer ${token}`,
    'User-Agent': 'asmbots-cli/test',
  })
  if (body !== undefined) headers.set('Content-Type', 'application/json')
  const request = new Request(`${LOCAL}${path}`, {
    method,
    headers,
    ...(body !== undefined && { body: JSON.stringify(body) }),
  })
  return worker.fetch(request, FAKE, CTX)
}

/** A signed-in user `as`. */
async function user(as: string): Promise<Jar> {
  const jar = new Jar()
  await signIn(jar, as)
  return jar
}

/** Makes a token named `name` for the jar's user and expects the 201. */
async function makeToken(jar: Jar, name = 'agent'): Promise<CreatedApiToken> {
  const res = await send(jar, '/api/me/tokens', { method: 'POST', body: { name } })
  expect(res.status).toBe(201)
  return parse(CreatedApiToken, await res.json(), 'the token')
}

async function tokens(jar: Jar): Promise<ApiTokenList['tokens']> {
  const res = await send(jar, '/api/me/tokens')
  expect(res.status).toBe(200)
  return parse(ApiTokenList, await res.json(), 'the tokens').tokens
}

async function actions(jar: Jar): Promise<string[]> {
  const res = await send(jar, '/api/me/audit')
  return parse(AuditList, await res.json(), 'the audit').entries.map((e) => e.action)
}

describe('POST /api/me/tokens', () => {
  it('makes a token, shown once; D1 keeps only its hash and its prefix', async () => {
    const jar = await user('token-maker')
    const { token, secret } = await makeToken(jar, '  my laptop  ')
    expect(secret).toMatch(API_TOKEN)
    expect(token.name).toBe('my laptop')
    expect(token.prefix).toBe(secret.slice(0, 12))
    expect(token.lastUsedAt).toBeNull()
    const row = await env.DB.prepare('SELECT * FROM api_tokens WHERE id = ?')
      .bind(token.id)
      .first<ApiTokenRow>()
    expect(row?.hash).toBe(await sha256Hex(new TextEncoder().encode(secret)))
    expect(JSON.stringify(row)).not.toContain(secret)
    expect(await actions(jar)).toContain('token.create')
  })

  it('refuses a name that is empty once trimmed, or longer than 40', async () => {
    const jar = await user('token-namer')
    for (const name of ['   ', 'x'.repeat(41)]) {
      const res = await send(jar, '/api/me/tokens', { method: 'POST', body: { name } })
      expect(await errorOf(res)).toEqual({
        status: 400,
        code: 'bad_request',
        message: 'a token name is 1..40 characters',
      })
    }
  })

  it(`holds ${MAX_API_TOKENS} tokens an account: 409 past that`, async () => {
    const jar = await user('token-hoarder')
    for (let n = 0; n < MAX_API_TOKENS; n++) await makeToken(jar, `t${n}`)
    const res = await send(jar, '/api/me/tokens', { method: 'POST', body: { name: 'one more' } })
    expect(await errorOf(res)).toMatchObject({ status: 409, code: 'conflict' })
    expect(await tokens(jar)).toHaveLength(MAX_API_TOKENS)
  })

  it('is 401 signed out', async () => {
    const res = await send(new Jar(), '/api/me/tokens', { method: 'POST', body: { name: 'x' } })
    expect(res.status).toBe(401)
  })
})

describe('GET /api/me/tokens', () => {
  it('lists the tokens, newest first, never a secret or a hash, and when each was used', async () => {
    const jar = await user('token-lister')
    const first = await makeToken(jar, 'first')
    const second = await makeToken(jar, 'second')
    const listed = await tokens(jar)
    expect(listed.map((t) => t.name)).toEqual(['second', 'first'])
    const raw = JSON.stringify(listed)
    expect(raw).not.toContain(first.secret)
    expect(raw).not.toContain('hash')
    expect((await bearer(first.secret, '/api/me')).status).toBe(200)
    await settled()
    const used = await tokens(jar)
    expect(used.find((t) => t.id === first.token.id)?.lastUsedAt).not.toBeNull()
    expect(used.find((t) => t.id === second.token.id)?.lastUsedAt).toBeNull()
  })
})

describe('a request with a token', () => {
  beforeAll(async () => {
    const hill = {
      slug: 'agents',
      name: 'agents',
      description: '',
      size: 5,
      rounds: 2,
      config: {
        coreSize: 0x10000,
        maxCycles: 20_000,
        maxProcesses: 64,
        minSpacing: 1024,
        maxBotBytes: 512,
      },
      scoring: 'duel' as const,
    }
    await applySeed(
      env,
      await buildSeed([{ slug: 'spin', source: SPIN, melee: false }], { hills: [hill] }),
    )
  })

  it('reads GET /api/me as its user', async () => {
    const jar = await user('token-reader')
    const { secret } = await makeToken(jar)
    const res = await bearer(secret, '/api/me')
    expect(res.status).toBe(200)
    expect(parse(Me, await res.json(), 'me').user.handle).toBe('token-reader')
  })

  it('makes a bot with no Origin, and adds a version to it', async () => {
    const jar = await user('token-pusher')
    const { secret } = await makeToken(jar)
    const made = await bearer(secret, '/api/bots', {
      method: 'POST',
      body: { name: 'Pushed', source: SPIN, visibility: 'public' },
    })
    expect(made.status).toBe(201)
    const saved = parse(SavedBot, await made.json(), 'the bot')
    expect(saved.bot.ownerId).toBe((await me(jar)).user.id)
    const next = await bearer(secret, `/api/bots/${saved.bot.id}/versions`, {
      method: 'POST',
      body: { source: HALT },
    })
    expect(next.status).toBe(201)
    const mine = await bearer(secret, '/api/me/bots')
    const list = parse(MyBotList, await mine.json(), 'the bots').bots
    expect(list.map((b) => [b.bot.name, b.latest?.version])).toEqual([['Pushed', 2]])
  })

  it('submits a version to a hill', async () => {
    const jar = await user('token-submitter')
    const { secret } = await makeToken(jar)
    const made = await bearer(secret, '/api/bots', {
      method: 'POST',
      body: { name: 'Halter', source: HALT },
    })
    const { version } = parse(SavedBot, await made.json(), 'the bot')
    const res = await bearer(secret, '/api/hills/agents/submit', {
      method: 'POST',
      body: { botVersionId: version.id },
    })
    expect(res.status).toBe(201)
    parse(HillSubmitted, await res.json(), 'the answer')
    expect(await actions(jar)).toContain('hill.submit')
  })

  it('may not make, list, or revoke tokens, delete the account, sign out, or see the admin stats', async () => {
    const jar = await user('token-bound')
    const { secret, token } = await makeToken(jar)
    const refused = [
      await bearer(secret, '/api/me/tokens'),
      await bearer(secret, '/api/me/tokens', { method: 'POST', body: { name: 'more' } }),
      await bearer(secret, `/api/me/tokens/${token.id}`, { method: 'DELETE' }),
      await bearer(secret, '/api/me', { method: 'DELETE' }),
      await bearer(secret, '/api/auth/logout', { method: 'POST' }),
      await bearer(secret, '/api/admin/stats'),
    ]
    for (const res of refused) {
      expect(await errorOf(res)).toEqual({
        status: 403,
        code: 'forbidden',
        message: 'sign in on the site to do this',
      })
    }
    expect((await me(jar)).user.handle).toBe('token-bound')
    expect(await tokens(jar)).toHaveLength(1)
  })

  it('is 401 for a token never made, or one that is not a token', async () => {
    for (const bad of [`asmb_${'0'.repeat(64)}`, 'not-a-token', '']) {
      const res = await bearer(bad, '/api/me')
      expect(await errorOf(res)).toEqual({
        status: 401,
        code: 'unauthorized',
        message: 'the api token is not valid',
      })
    }
    // A bad token is refused, not taken for nobody: even a read anyone may make.
    expect((await bearer(`asmb_${'1'.repeat(64)}`, '/api/hills')).status).toBe(401)
  })
})

describe('DELETE /api/me/tokens/:id', () => {
  it('revokes the token: 204, and it is 401 from then on', async () => {
    const jar = await user('token-revoker')
    const { secret, token } = await makeToken(jar)
    expect((await bearer(secret, '/api/me')).status).toBe(200)
    const res = await send(jar, `/api/me/tokens/${token.id}`, { method: 'DELETE' })
    expect(res.status).toBe(204)
    expect((await bearer(secret, '/api/me')).status).toBe(401)
    expect(await tokens(jar)).toEqual([])
    expect(await actions(jar)).toContain('token.delete')
  })

  it("is 404 for another user's token, which keeps working", async () => {
    const owner = await user('token-owner')
    const { secret, token } = await makeToken(owner)
    const other = await user('token-thief')
    const res = await send(other, `/api/me/tokens/${token.id}`, { method: 'DELETE' })
    expect(await errorOf(res)).toMatchObject({ status: 404, code: 'not_found' })
    expect((await bearer(secret, '/api/me')).status).toBe(200)
    expect(await actions(other)).not.toContain('token.delete')
  })
})

describe('DELETE /api/me', () => {
  it("takes the account's tokens with it", async () => {
    const jar = await user('token-leaver')
    const { secret } = await makeToken(jar)
    const { user: gone } = await me(jar)
    expect((await send(jar, '/api/me', { method: 'DELETE' })).status).toBe(204)
    expect(await getUserRow(env.DB, gone.id)).toBeNull()
    const left = await env.DB.prepare('SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = ?')
      .bind(gone.id)
      .first<{ n: number }>()
    expect(left?.n).toBe(0)
    expect((await bearer(secret, '/api/me')).status).toBe(401)
  })
})
