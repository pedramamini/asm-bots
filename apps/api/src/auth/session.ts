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
 */
import type { Context, MiddlewareHandler } from 'hono'
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie'
import type { CookieOptions } from 'hono/utils/cookie'
import type { AppEnv } from '../env'
import { errorResponse } from '../middleware'

/** `__Host-`: Secure, `Path=/`, and no `Domain`, so a subdomain cannot plant one. */
const SESSION_COOKIE = 'session'
const SESSION_PREFIX = 'host'
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60

/** The session as KV holds it. */
export interface Session {
  userId: string
  /** ISO 8601 UTC. */
  createdAt: string
  /** The User-Agent that signed in, for a future "your sessions" list. */
  ua: string
}

export interface ActiveSession extends Session {
  id: string
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export function sessionKey(id: string): string {
  return `sess:${id}`
}

/** Whether sign-in is set up: the GitHub app and the cookie secret. */
export function authConfigured(c: Context<AppEnv>): boolean {
  return Boolean(c.env.GITHUB_CLIENT_ID && c.env.GITHUB_CLIENT_SECRET && c.env.SESSION_SECRET)
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
  await c.env.KV.put(sessionKey(id), JSON.stringify(session), {
    expirationTtl: SESSION_TTL_SECONDS,
  })
  await setSignedCookie(c, SESSION_COOKIE, id, secret, {
    ...cookieOptions(SESSION_TTL_SECONDS),
    prefix: SESSION_PREFIX,
  })
  return { id, ...session }
}

/** Ends the request's session, if any, in KV and in the browser. */
export async function endSession(c: Context<AppEnv>): Promise<void> {
  const session = c.get('session')
  if (session) await c.env.KV.delete(sessionKey(session.id))
  c.set('session', null)
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true, prefix: SESSION_PREFIX })
}

/** Refuses a write sent from another origin (the header comment says why). */
export const sameOrigin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const origin = c.req.header('Origin')
  const allowed = origin === undefined || origin === c.env.APP_ORIGIN
  if (!allowed && origin !== new URL(c.req.url).origin) {
    return errorResponse(c, 'forbidden', `a write from ${origin} is not allowed`)
  }
  await next()
}

/**
 * Sets `session` from the cookie. A bad signature, an expired session, or a write with no `Origin`
 * leaves it null.
 */
export const loadSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set('session', null)
  const secret = c.env.SESSION_SECRET
  const trusted = SAFE_METHODS.has(c.req.method) || c.req.header('Origin') !== undefined
  if (secret && trusted) {
    const id = await getSignedCookie(c, secret, SESSION_COOKIE, SESSION_PREFIX)
    if (id) {
      const session = await c.env.KV.get<Session>(sessionKey(id), 'json')
      if (session) c.set('session', { id, ...session })
    }
  }
  await next()
}

/** 401 unless someone is signed in. */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get('session')) return errorResponse(c, 'unauthorized', 'sign in first')
  await next()
}
