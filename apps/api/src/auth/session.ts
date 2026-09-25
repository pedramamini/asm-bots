/**
 * Sessions (ARCHITECTURE §7, Auth): a random id in a signed cookie (HttpOnly, Secure,
 * SameSite=Lax, 30 days), the session itself in KV at `sess:<id>` with the same lifetime.
 *
 * CSRF: no token, because two checks cover it.
 * 1. SameSite=Lax: a browser sends the cookie on a cross-site request only for a top-level GET
 *    navigation, so a form or `fetch` from another site carries no session. No GET changes state.
 * 2. `Origin`: every browser sends it on a POST, PUT, PATCH, or DELETE, same-origin ones too.
 *    `sameOrigin` refuses a write whose `Origin` is neither this site nor `APP_ORIGIN`, which
 *    covers a sibling subdomain (same site, so Lax lets the cookie through). A write with no
 *    `Origin` is not refused, since the CLI and scripts send none, but its cookie counts for
 *    nothing: only a browser holds the cookie, and a browser always says where it came from.
 * A double-submit token would add nothing to either.
 *
 * API tokens (`token.ts`): a script or an AI agent signs in with `Authorization: Bearer asmb_...`,
 * and that counts on a write with no `Origin`, unlike the cookie. The reasoning above still holds:
 * a browser never sends an `Authorization` header on its own, as it sends a cookie, and a page on
 * another site cannot set one on a request here (CORS allows only `Content-Type`), so no other
 * site can make a request that carries someone's token.
 */
import type { Context, MiddlewareHandler } from 'hono'
import { deleteCookie, getSignedCookie, setCookie, setSignedCookie } from 'hono/cookie'
import type { CookieOptions } from 'hono/utils/cookie'
import type { AppEnv } from '../env'
import { errorResponse } from '../middleware'
import { bearerToken, tokenSession } from './token'

/** `__Host-`: Secure, `Path=/`, and no `Domain`, so a subdomain cannot plant one. */
const SESSION_COOKIE = 'session'
const SESSION_PREFIX = 'host'
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60
/**
 * Beside the session, a cookie the page can read (not HttpOnly) that says only "signed in": the
 * web app asks `GET /api/me` when it is there, so a signed-out visit makes no request and logs no
 * 401. It proves nothing; the session cookie does.
 */
export const SIGNED_IN_COOKIE = 'signed_in'

/** The session as KV holds it. */
export interface Session {
  userId: string
  /** ISO 8601 UTC. */
  createdAt: string
  /** The User-Agent that signed in, for a future "your sessions" list. */
  ua: string
}

/**
 * The request's session: a cookie's (`id` its KV key's) or an API token's (`id` is
 * `token:<token id>`, `createdAt` when the token was made, nothing in KV).
 */
export interface ActiveSession extends Session {
  id: string
  /** How it signed in: the site's cookie, or an API token. */
  via?: 'cookie' | 'token'
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export function sessionKey(id: string): string {
  return `sess:${id}`
}

/**
 * Beside each session, an empty key per user that names it, so `endAllSessions` can find a user's
 * sessions by prefix. It lives as long as the session.
 */
function userSessionKey(userId: string, id: string): string {
  return `usess:${userId}:${id}`
}

/** Deletes session `id` of `userId` from KV: the session and its entry in the user's list. */
export async function dropSession(kv: KVNamespace, userId: string, id: string): Promise<void> {
  await Promise.all([kv.delete(sessionKey(id)), kv.delete(userSessionKey(userId, id))])
}

/**
 * Deletes every session of `userId` from KV (a deleted account). KV lists are eventually
 * consistent, so a session started elsewhere in the last minute can be missed; it then names a
 * user who is gone, and `GET /api/me` ends it.
 */
export async function endAllSessions(kv: KVNamespace, userId: string): Promise<number> {
  const prefix = `usess:${userId}:`
  let ended = 0
  let cursor: string | undefined
  do {
    const page = await kv.list({ prefix, ...(cursor !== undefined && { cursor }) })
    await Promise.all(page.keys.map((k) => dropSession(kv, userId, k.name.slice(prefix.length))))
    ended += page.keys.length
    cursor = page.list_complete ? undefined : page.cursor
  } while (cursor !== undefined)
  return ended
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** Whether sign-in skips GitHub for a test user: `DEV_FAKE_AUTH=1`, on localhost only. */
export function fakeAuth(c: Context<AppEnv>): boolean {
  return c.env.DEV_FAKE_AUTH === '1' && LOCAL_HOSTS.has(new URL(c.req.url).hostname)
}

/** Whether sign-in is set up: the cookie secret, and the GitHub app unless `fakeAuth`. */
export function authConfigured(c: Context<AppEnv>): boolean {
  const github = Boolean(c.env.GITHUB_CLIENT_ID && c.env.GITHUB_CLIENT_SECRET)
  return Boolean(c.env.SESSION_SECRET) && (github || fakeAuth(c))
}

/** Hex of `n` random bytes. */
export function randomHex(n: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(n))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** The cookie attributes every auth cookie shares. */
export function cookieOptions(maxAge: number, path = '/'): CookieOptions {
  return { httpOnly: true, secure: true, sameSite: 'Lax', path, maxAge }
}

/** Starts a session for `userId` and sets its cookie on the response. */
export async function startSession(c: Context<AppEnv>, userId: string): Promise<ActiveSession> {
  const secret = c.env.SESSION_SECRET
  if (!secret) throw new Error('SESSION_SECRET is not set')
  const id = randomHex(32)
  const session: Session = {
    userId,
    createdAt: new Date().toISOString(),
    ua: (c.req.header('User-Agent') ?? '').slice(0, 256),
  }
  await Promise.all([
    c.env.KV.put(sessionKey(id), JSON.stringify(session), { expirationTtl: SESSION_TTL_SECONDS }),
    c.env.KV.put(userSessionKey(userId, id), '', { expirationTtl: SESSION_TTL_SECONDS }),
  ])
  await setSignedCookie(c, SESSION_COOKIE, id, secret, {
    ...cookieOptions(SESSION_TTL_SECONDS),
    prefix: SESSION_PREFIX,
  })
  setCookie(c, SIGNED_IN_COOKIE, '1', { ...cookieOptions(SESSION_TTL_SECONDS), httpOnly: false })
  return { id, ...session }
}

/**
 * Ends the request's session, if any, in KV and in the browser. An API token's has neither: it
 * ends only for this request (the token stays until its user revokes it).
 */
export async function endSession(c: Context<AppEnv>): Promise<void> {
  const session = c.get('session')
  c.set('session', null)
  if (session?.via === 'token') return
  if (session) await dropSession(c.env.KV, session.userId, session.id)
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true, prefix: SESSION_PREFIX })
  deleteCookie(c, SIGNED_IN_COOKIE, { path: '/', secure: true })
}

/** Whether a request from `origin` may go on: none (the CLI, a script), this site, or `APP_ORIGIN`. */
export function originAllowed(c: Context<AppEnv>, origin: string | undefined): boolean {
  return origin === undefined || origin === c.env.APP_ORIGIN || origin === new URL(c.req.url).origin
}

/** Refuses a write sent from another origin (the header comment says why). */
export const sameOrigin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const origin = c.req.header('Origin')
  if (!originAllowed(c, origin)) {
    return errorResponse(c, 'forbidden', `a write from ${origin} is not allowed`)
  }
  await next()
}

/**
 * Sets `session` from the cookie. A bad signature, an expired session, or a write with no `Origin`
 * leaves it null. With no cookie session, an `Authorization: Bearer` API token signs its user in
 * (`tokenSession`); a token that is not one, or was revoked, is 401 then and there, not a
 * request from nobody, so a script with a bad token hears so.
 */
export const loadSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set('session', null)
  const secret = c.env.SESSION_SECRET
  const trusted = SAFE_METHODS.has(c.req.method) || c.req.header('Origin') !== undefined
  if (secret && trusted) {
    const id = await getSignedCookie(c, secret, SESSION_COOKIE, SESSION_PREFIX)
    if (id) {
      const session = await c.env.KV.get<Session>(sessionKey(id), 'json')
      if (session) c.set('session', { id, ...session, via: 'cookie' })
    }
  }
  const token = c.get('session') === null ? bearerToken(c.req.header('Authorization')) : null
  if (token !== null) {
    const session = await tokenSession(c, token)
    if (session === null) return errorResponse(c, 'unauthorized', 'the api token is not valid')
    c.set('session', session)
  }
  await next()
}

/**
 * 403 for a request an API token signed in: what only a person on the site may do (the tokens
 * themselves, deleting the account, sign-out, the admin routes). A leaked token cannot make more
 * tokens, nor lock its user out.
 */
export const refuseToken: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get('session')?.via === 'token') {
    return errorResponse(c, 'forbidden', 'sign in on the site to do this')
  }
  await next()
}

/** 401 unless someone is signed in. */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get('session')) return errorResponse(c, 'unauthorized', 'sign in first')
  await next()
}
