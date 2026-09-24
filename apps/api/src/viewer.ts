import type { Context } from 'hono'
import type { AppEnv } from './env'

/**
 * The id of the user who sent `c`, or null. Nobody signs in before EXEC 3.2's sessions, so every
 * reader is anyone: a private bot and a draft tournament show to nobody.
 */
export function viewerId(_c: Context<AppEnv>): string | null {
  return null
}
