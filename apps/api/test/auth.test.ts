/**
 * GitHub sign-in and sessions, with GitHub's token endpoint and REST API stubbed out: the Worker
 * runs in this isolate, so a spy on `fetch` sees its outbound calls.
 */
import { env, exports } from 'cloudflare:workers'
import { isAllowedHandle } from '@asmbots/protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleCandidates } from '../src/auth/handle'
import { Jar } from './jar'

const worker = exports.default
const SITE = 'https://asmbots.test'

interface GithubAccount {
  id: number
  login: string
  avatar_url: string
  email: string
}

const OCTO: GithubAccount = {
  id: 4242,
  login: 'Octo-Cat',
  avatar_url: 'https://avatars.example/4242',
  email: 'octo@example.com',
}

/** What the stubbed GitHub knows: the account each code signs in, and every call made to it. */
let accounts: Map<string, GithubAccount>
let githubCalls: string[]

beforeEach(() => {
  accounts = new Map()
  githubCalls = []
  const real = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    if (url.hostname !== 'github.com' && url.hostname !== 'api.github.com') return real(input, init)
    githubCalls.push(`${request.method} ${url.origin}${url.pathname}`)
    if (url.href === 'https://github.com/login/oauth/access_token') {
      const code = String((await request.formData()).get('code') ?? '')
      if (!accounts.has(code)) {
        return Response.json({ error: 'bad_verification_code', error_description: 'bad code' })
      }
      return Response.json({ access_token: `token-${code}`, token_type: 'bearer', scope: '' })
    }
    const code = request.headers.get('Authorization')?.replace('Bearer token-', '') ?? ''
    const account = accounts.get(code)
    if (!account) return new Response('{"message":"Bad credentials"}', { status: 401 })
    if (url.pathname === '/user') {
      const { id, login, avatar_url } = account
      return Response.json({ id, login, avatar_url })
    }
    if (url.pathname === '/user/emails') {
      return Response.json([
        { email: 'old@example.com', primary: false, verified: true },
        { email: account.email, primary: true, verified: true },
      ])
    }
    return new Response('not found', { status: 404 })
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function send(
  jar: Jar,
  path: string,
  { method = 'GET', origin }: { method?: string; origin?: string } = {},
): Promise<Response> {
  const headers = new Headers({
    Cookie: jar.header(),
    'User-Agent': 'auth-test',
    'CF-Connecting-IP': jar.ip,
  })
  if (origin) headers.set('Origin', origin)
  const request = new Request(`${SITE}${path}`, { method, headers, redirect: 'manual' })
  const res = await worker.fetch(request)
  jar.take(res)
  return res
}

/** Starts a sign-in, then comes back from GitHub with `code`. Returns the callback's response. */
async function signIn(jar: Jar, code: string, returnTo?: string): Promise<Response> {
  const query = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''
  const start = await send(jar, `/api/auth/github${query}`)
  expect(start.status).toBe(302)
  const state = new URL(start.headers.get('Location') ?? '').searchParams.get('state')
  return send(jar, `/api/auth/github/callback?code=${code}&state=${state}`)
}

async function me(jar: Jar): Promise<Response> {
  return send(jar, '/api/me')
}

async function userRow(githubId: number) {
  return env.DB.prepare('SELECT * FROM users WHERE github_id = ?')
    .bind(githubId)
    .first<{ id: string; handle: string; avatar_url: string; email: string }>()
}

describe('GET /api/auth/github', () => {
  it('sends the browser to GitHub with a state it keeps in a short-lived cookie', async () => {
    const jar = new Jar()
    const res = await send(jar, '/api/auth/github?returnTo=/editor')
    expect(res.status).toBe(302)
    const to = new URL(res.headers.get('Location') ?? '')
    expect(to.origin + to.pathname).toBe('https://github.com/login/oauth/authorize')
    expect(to.searchParams.get('client_id')).toBe('test-client-id')
    expect(to.searchParams.get('scope')).toBe('read:user user:email')
    expect(to.searchParams.get('state')).toBe(jar.cookies.get('oauth_state'))
    expect(jar.cookies.get('oauth_return_to')).toBe('%2Feditor')
    const state = res.headers.getSetCookie().find((l) => l.startsWith('oauth_state=')) ?? ''
    expect(state).toMatch(/Max-Age=600/)
    expect(state).toMatch(/Path=\/api\/auth/)
    expect(state).toMatch(/HttpOnly/)
    expect(state).toMatch(/Secure/)
    expect(state).toMatch(/SameSite=Lax/)
  })

  it('will not return to another site', async () => {
    for (const returnTo of ['//evil.test/x', 'https://evil.test', '/\\evil.test']) {
      const jar = new Jar()
      await send(jar, `/api/auth/github?returnTo=${encodeURIComponent(returnTo)}`)
      expect(jar.cookies.has('oauth_return_to')).toBe(false)
    }
  })
})

describe('GET /api/auth/github/callback', () => {
  it('makes the user and a session, then returns to the page that asked', async () => {
    accounts.set('code-1', OCTO)
    const jar = new Jar()
    const res = await signIn(jar, 'code-1', '/editor')
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('/editor')
    expect(githubCalls).toEqual([
      'POST https://github.com/login/oauth/access_token',
      'GET https://api.github.com/user',
      'GET https://api.github.com/user/emails',
    ])

    const row = await userRow(4242)
    expect(row).toMatchObject({
      handle: 'octo-cat',
      avatar_url: OCTO.avatar_url,
      email: 'octo@example.com',
    })

    const cookie = res.headers.getSetCookie().find((l) => l.startsWith('__Host-session=')) ?? ''
    expect(cookie).toMatch(/Max-Age=2592000/)
    expect(cookie).toMatch(/Path=\//)
    expect(cookie).toMatch(/HttpOnly/)
    expect(cookie).toMatch(/Secure/)
    expect(cookie).toMatch(/SameSite=Lax/)
    const hint = res.headers.getSetCookie().find((l) => l.startsWith('signed_in=')) ?? ''
    expect(hint).toMatch(/^signed_in=1;/)
    expect(hint).not.toMatch(/HttpOnly/)
    // The sign-in cookies are spent.
    expect(jar.cookies.has('oauth_state')).toBe(false)
    expect(jar.cookies.has('oauth_return_to')).toBe(false)

    const id = decodeURIComponent(jar.cookies.get('__Host-session') ?? '').split('.')[0]
    const session = await env.KV.get<{ userId: string; ua: string }>(`sess:${id}`, 'json')
    expect(session).toMatchObject({ userId: row?.id, ua: 'auth-test' })
  })

  it('replaces the session the browser already had', async () => {
    accounts.set('twice', { ...OCTO, id: 8, login: 'twice-in' })
    const jar = new Jar()
    await signIn(jar, 'twice')
    const first = new Jar()
    first.cookies.set('__Host-session', jar.cookies.get('__Host-session') ?? '')
    await signIn(jar, 'twice')
    expect((await me(jar)).status).toBe(200)
    expect((await me(first)).status).toBe(401)
  })

  it('lands on /?signed-in=1 when nothing asked', async () => {
    accounts.set('code-2', { ...OCTO, id: 7, login: 'seven-x' })
    const res = await signIn(new Jar(), 'code-2')
    expect(res.headers.get('Location')).toBe('/?signed-in=1')
  })

  it('signs the same GitHub account into the same user, refreshing its avatar', async () => {
    accounts.set('first', { ...OCTO, id: 9, login: 'nine-lives' })
    accounts.set('again', { ...OCTO, id: 9, login: 'nine-lives', avatar_url: 'https://new/9' })
    await signIn(new Jar(), 'first')
    const before = await userRow(9)
    await signIn(new Jar(), 'again')
    const after = await userRow(9)
    expect(after?.id).toBe(before?.id)
    expect(after?.avatar_url).toBe('https://new/9')
    const { count } = (await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM users WHERE github_id = 9',
    ).first<{ count: number }>()) ?? { count: 0 }
    expect(count).toBe(1)
  })

  it('gives a new user a free handle when their login is taken or reserved', async () => {
    accounts.set('dup-a', { ...OCTO, id: 11, login: 'twin' })
    accounts.set('dup-b', { ...OCTO, id: 12, login: 'TWIN' })
    accounts.set('admin', { ...OCTO, id: 13, login: 'admin' })
    await signIn(new Jar(), 'dup-a')
    await signIn(new Jar(), 'dup-b')
    await signIn(new Jar(), 'admin')
    expect((await userRow(11))?.handle).toBe('twin')
    expect((await userRow(12))?.handle).toMatch(/^twin-[0-9a-f]{4}$/)
    expect((await userRow(13))?.handle).toMatch(/^admin-[0-9a-f]{4}$/)
  })

  it('refuses a state that does not match, and makes nobody', async () => {
    accounts.set('code-x', { ...OCTO, id: 21, login: 'forged' })
    const jar = new Jar()
    await send(jar, '/api/auth/github')
    const res = await send(jar, '/api/auth/github/callback?code=code-x&state=not-the-state')
    expect(res.status).toBe(400)
    expect(await userRow(21)).toBeNull()
    expect(githubCalls).toEqual([])
  })

  it('refuses a callback with no state cookie (a sign-in started elsewhere)', async () => {
    accounts.set('code-y', { ...OCTO, id: 22, login: 'no-cookie' })
    const res = await send(new Jar(), '/api/auth/github/callback?code=code-y&state=abc')
    expect(res.status).toBe(400)
    expect(await userRow(22)).toBeNull()
  })

  it('answers 400 when GitHub refuses the code', async () => {
    const res = await signIn(new Jar(), 'unknown-code')
    expect(res.status).toBe(400)
    const { error } = (await res.json()) as { error: { code: string; message: string } }
    expect(error.code).toBe('bad_request')
    expect(error.message).toMatch(/bad_verification_code/)
  })

  it('goes back signed out when the user says no on GitHub', async () => {
    const jar = new Jar()
    await send(jar, '/api/auth/github?returnTo=/arena')
    const res = await send(jar, '/api/auth/github/callback?error=access_denied&state=x')
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('/arena')
    expect(jar.cookies.has('__Host-session')).toBe(false)
  })
})

describe('GET /api/me', () => {
  it('is the signed-in user', async () => {
    accounts.set('me-code', { ...OCTO, id: 31, login: 'me-myself' })
    const jar = new Jar()
    await signIn(jar, 'me-code')
    const res = await me(jar)
    expect(res.status).toBe(200)
    const { user } = (await res.json()) as { user: Record<string, unknown> }
    expect(user).toMatchObject({ handle: 'me-myself', avatarUrl: OCTO.avatar_url })
    expect(user).not.toHaveProperty('email')
    expect(user).not.toHaveProperty('githubId')
  })

  it('is 401 for nobody, and for a cookie whose signature is wrong', async () => {
    expect((await me(new Jar())).status).toBe(401)
    const jar = new Jar()
    jar.cookies.set('__Host-session', 'deadbeef.bm90LWEtc2lnbmF0dXJl')
    const res = await me(jar)
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: { code: 'unauthorized', message: 'sign in first' } })
  })

  it('lets a signed-in user see their own private bots', async () => {
    accounts.set('owner', { ...OCTO, id: 41, login: 'owner-one' })
    const jar = new Jar()
    await signIn(jar, 'owner')
    const row = await userRow(41)
    await env.DB.prepare(
      `INSERT INTO bots (id, owner_id, slug, name, visibility)
       VALUES ('b-41', ?, 'secret', 'Secret', 'private')`,
    )
      .bind(row?.id)
      .run()
    const mine = (await (await send(jar, '/api/users/owner-one')).json()) as { bots: unknown[] }
    const theirs = (await (await send(new Jar(), '/api/users/owner-one')).json()) as {
      bots: unknown[]
    }
    expect(mine.bots).toHaveLength(1)
    expect(theirs.bots).toHaveLength(0)
  })
})

describe('POST /api/auth/logout', () => {
  it('ends the session: the cookie is cleared and the old one no longer works', async () => {
    accounts.set('bye', { ...OCTO, id: 51, login: 'leaver' })
    const jar = new Jar()
    await signIn(jar, 'bye')
    const stolen = new Jar()
    stolen.cookies.set('__Host-session', jar.cookies.get('__Host-session') ?? '')

    const res = await send(jar, '/api/auth/logout', { method: 'POST', origin: SITE })
    expect(res.status).toBe(204)
    expect(jar.cookies.has('__Host-session')).toBe(false)
    expect(jar.cookies.has('signed_in')).toBe(false)
    expect((await me(jar)).status).toBe(401)
    // The session is gone from KV, not just from this browser.
    expect((await me(stolen)).status).toBe(401)
  })

  it('refuses a write from another origin and keeps the session', async () => {
    accounts.set('csrf', { ...OCTO, id: 52, login: 'target' })
    const jar = new Jar()
    await signIn(jar, 'csrf')
    const res = await send(jar, '/api/auth/logout', { method: 'POST', origin: 'https://evil.test' })
    expect(res.status).toBe(403)
    expect((await me(jar)).status).toBe(200)
  })

  it('lets the app origin write, and ignores the cookie on a write with no Origin', async () => {
    accounts.set('dev', { ...OCTO, id: 53, login: 'dev-user' })
    const jar = new Jar()
    await signIn(jar, 'dev')
    const session = jar.cookies.get('__Host-session') ?? ''

    const blind = await send(jar, '/api/auth/logout', { method: 'POST' })
    expect(blind.status).toBe(204)
    // No Origin, so the cookie carried no authority: the session in KV is untouched.
    jar.cookies.set('__Host-session', session)
    expect((await me(jar)).status).toBe(200)

    const app = await send(jar, '/api/auth/logout', { method: 'POST', origin: env.APP_ORIGIN })
    expect(app.status).toBe(204)
    expect((await me(jar)).status).toBe(401)
  })
})

describe('handles', () => {
  it('keeps a valid login and suffixes the rest', () => {
    expect(handleCandidates('Octo-Cat')[0]).toBe('octo-cat')
    expect(handleCandidates('ab')[0]).toMatch(/^ab-[0-9a-f]{4}$/)
    expect(handleCandidates('a'.repeat(30))[0]).toBe('a'.repeat(24))
    expect(handleCandidates('system')[0]).toMatch(/^system-[0-9a-f]{4}$/)
    for (const login of ['x', 'trailing-', `${'b'.repeat(23)}-c`, '--weird--', 'Roster']) {
      for (const handle of handleCandidates(login)) expect(isAllowedHandle(handle)).toBe(true)
    }
  })
})
