import type { Context } from 'hono'
import type { AppEnv } from './env'

/**
 * The id of the user who sent `c`, or null when nobody is signed in: then a private bot and a
 * draft tournament show to nobody.
 */
export function viewerId(c: Context<AppEnv>): string | null {
  return c.get('session')?.userId ?? null
}
