/** The Worker's bindings (`wrangler.jsonc`) and the Hono context they ride in. */
import type { ActiveSession } from './auth/session'
import type { LiveRoom } from './durable/live-room'
import type { Runner } from './durable/runner'

export interface Env {
  /** The web app's `dist`, with the single-page fallback. */
  ASSETS: Fetcher
  DB: D1Database
  /** Replays and bot binaries, content-addressed. */
  REPLAYS: R2Bucket
  /** Sessions, rate limits, hot caches. */
  KV: KVNamespace
  RUNNER: DurableObjectNamespace<Runner>
  LIVE_ROOM: DurableObjectNamespace<LiveRoom>
  ISA_VERSION: string
  APP_VERSION: string
  /** The one origin CORS lets in. */
  APP_ORIGIN: string
  /** Secrets (`.dev.vars`, `wrangler secret put`). Without all three, sign-in is off. */
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
  /** Signs the session cookie. */
  SESSION_SECRET?: string
  /**
   * `1`: sign-in skips GitHub and signs in a test user (`wrangler dev --var DEV_FAKE_AUTH:1`, the
   * e2e specs). Honored only for a request to localhost, so a production Worker never takes it.
   */
  DEV_FAKE_AUTH?: string
}

export interface AppEnv {
  Bindings: Env
  Variables: {
    /** Set by `hono/request-id`: the request's `X-Request-Id`, given or made. */
    requestId: string
    /** Set by `loadSession` on `/api/*`: the signed-in session, or null. */
    session: ActiveSession | null
  }
}

type Bindings = Env

// `cloudflare:test`'s `env` and `cloudflare:workers`' `env` read this.
declare global {
  namespace Cloudflare {
    interface Env extends Bindings {}
  }
}
