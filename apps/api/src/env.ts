/** The Worker's bindings (`wrangler.jsonc`) and the Hono context they ride in. */
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
}

export interface AppEnv {
  Bindings: Env
  Variables: {
    /** Set by `hono/request-id`: the request's `X-Request-Id`, given or made. */
    requestId: string
  }
}

type Bindings = Env

// `cloudflare:test`'s `env` and `cloudflare:workers`' `env` read this.
declare global {
  namespace Cloudflare {
    interface Env extends Bindings {}
  }
}
