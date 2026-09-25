/** The Worker's bindings (`wrangler.jsonc`) and the Hono context they ride in. */
import type { ActiveSession } from './auth/session'
import type { LiveRoom } from './do/live-room'
import type { Runner } from './do/runner'

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
  /** Workers Analytics Engine: a data point per match a `Runner` plays (`analytics.ts`). */
  MATCH_ANALYTICS?: AnalyticsEngineDataset
  ISA_VERSION: string
  APP_VERSION: string
  /**
   * The running version's id, tag, and upload time (`version_metadata`): `/api/health`'s uptime
   * counts from the upload. `wrangler dev` makes one at its start.
   */
  CF_VERSION_METADATA?: WorkerVersionMetadata
  /**
   * The site's canonical origin, `https://asmbots.io`: what page heads link to and share cards
   * sign, whichever host served them (a preview, `wrangler dev`).
   */
  SITE_URL: string
  /** The one origin CORS lets in. */
  APP_ORIGIN: string
  /**
   * The handles that may read `GET /api/admin/stats`, split on commas or spaces, any case. Empty
   * or unset: nobody.
   */
  ADMIN_HANDLES?: string
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
  /**
   * How long a `Runner` waits between its alarms, ms; 0 when unset. The API tests set an hour, so
   * no alarm fires on its own, and step the alarms with `runDurableObjectAlarm`.
   */
  RUNNER_ALARM_DELAY_MS?: string
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
