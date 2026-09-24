import { DurableObject } from 'cloudflare:workers'
import type { Env } from '../env'

/**
 * One per tournament or hill: fans `LiveMessage`s out to spectators over WebSockets (ARCHITECTURE
 * §7). Declared now so the binding and its migration exist; 3.3 fills it in.
 */
export class LiveRoom extends DurableObject<Env> {
  override async fetch(): Promise<Response> {
    return new Response('not implemented', { status: 501 })
  }
}
