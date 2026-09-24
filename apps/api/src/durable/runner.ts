import { DurableObject } from 'cloudflare:workers'
import type { Env } from '../env'

/**
 * Plays a hill's or a tournament's matches, one per alarm, and writes each result to D1 as it
 * lands (ARCHITECTURE §7). Declared now so the binding and its migration exist; 3.3 fills it in.
 */
export class Runner extends DurableObject<Env> {
  override async fetch(): Promise<Response> {
    return new Response('not implemented', { status: 501 })
  }
}
