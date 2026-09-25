/**
 * Personal API tokens: how a script or an AI agent signs in (`Authorization: Bearer asmb_...`).
 * A token is `asmb_` and 64 hex digits (32 random bytes). D1 keeps its SHA-256 and its first 12
 * characters, never the token: the token is shown once, when it is made (`POST /api/me/tokens`).
 * A token acts as its user, but for what only a person on the site may do (`refuseToken` in
 * `session.ts`): its own tokens, deleting the account, sign-out, and the admin routes.
 */
import { API_TOKEN, sha256Hex } from '@asmbots/protocol'
import type { Context } from 'hono'
import { getApiTokenByHash, touchApiToken } from '../db/queries'
import type { AppEnv } from '../env'
import { log } from '../middleware'
import type { ActiveSession } from './session'

/** What every token starts with, so a leaked one is easy to spot in a log or a repo. */
export const TOKEN_PREFIX = 'asmb_'

/** How much of a token D1 keeps to show: `asmb_` and 7 hex digits. */
export const SHOWN_PREFIX = 12

/** How often a token's `last_used_at` moves at most: an hour. */
const TOUCH_EVERY_MS = 60 * 60 * 1000

/** The SHA-256 of `token`, lowercase hex: what D1 looks a token up by. */
export function hashToken(token: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(token))
}

/** A new token: the token itself (the secret), its hash, and the prefix to show. */
export async function newToken(): Promise<{ secret: string; hash: string; prefix: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const secret = `${TOKEN_PREFIX}${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`
  return { secret, hash: await hashToken(secret), prefix: secret.slice(0, SHOWN_PREFIX) }
}

/** The token in an `Authorization` header, or null when it says no `Bearer` at all. */
export function bearerToken(header: string | undefined): string | null {
  const match = header?.match(/^Bearer(?:\s+(.*))?$/i)
  return match ? (match[1] ?? '').trim() : null
}

/**
 * The session `token` signs in: its user, as `token:<token id>`; null for a token that is not one
 * or was revoked. Marks the token used, at most once an hour, after the response.
 */
export async function tokenSession(
  c: Context<AppEnv>,
  token: string,
): Promise<ActiveSession | null> {
  if (!API_TOKEN.test(token)) return null
  const row = await getApiTokenByHash(c.env.DB, await hashToken(token))
  if (row === null) return null
  const now = Date.now()
  const last = row.last_used_at === null ? 0 : Date.parse(row.last_used_at)
  if (!(now - last < TOUCH_EVERY_MS)) {
    const touch = touchApiToken(c.env.DB, row.id, new Date(now).toISOString()).catch((err) => {
      log('warn', 'api token not marked used', {
        requestId: c.get('requestId'),
        error: err instanceof Error ? err.message : String(err),
      })
    })
    c.executionCtx.waitUntil(touch)
  }
  return {
    id: `token:${row.id}`,
    userId: row.user_id,
    createdAt: row.created_at,
    ua: (c.req.header('User-Agent') ?? '').slice(0, 256),
    via: 'token',
  }
}
