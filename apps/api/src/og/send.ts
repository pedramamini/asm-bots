/**
 * A share card as a response: its SVG as it is, or its PNG (`png.ts`), which KV keeps a day under
 * the hash of the SVG. A card that changes (a hill's standings) makes a new SVG, so a PNG is never
 * stale, and cards alike share one.
 */
import { sha256Hex } from '@asmbots/protocol'
import type { Context } from 'hono'
import type { AppEnv } from '../env'
import { pngCacheKey } from '../storage'
import { svgToPng } from './png'

/** How long KV keeps a card, seconds: a day. */
export const CARD_TTL = 24 * 60 * 60

/** How long a browser or a crawler may keep a card that can change, seconds: an hour. */
export const LIVE_CARD_AGE = 60 * 60

export type CardFormat = 'svg' | 'png'

/** The host a card signs: the site's, whichever host drew it. */
export function cardHost(env: AppEnv['Bindings']): string {
  return new URL(env.SITE_URL).host
}

/** The PNG of `svg`, from KV when it was drawn in the last day. */
export async function cardPng(kv: KVNamespace, svg: string): Promise<Uint8Array<ArrayBuffer>> {
  const key = pngCacheKey(await sha256Hex(new TextEncoder().encode(svg)))
  const kept = await kv.get(key, 'arrayBuffer')
  if (kept !== null) return new Uint8Array(kept)
  const png = await svgToPng(svg)
  await kv.put(key, png, { expirationTtl: CARD_TTL })
  return png
}

/** `svg` as a card response in `format`, which clients may keep `maxAge` seconds. */
export async function sendCard(
  c: Context<AppEnv>,
  svg: string,
  format: CardFormat,
  maxAge: number,
): Promise<Response> {
  const cache = { 'Cache-Control': `public, max-age=${maxAge}` }
  if (format === 'svg') {
    return c.body(svg, 200, {
      ...cache,
      'Content-Type': 'image/svg+xml; charset=utf-8',
      // An SVG opened as a page runs no script and loads nothing.
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    })
  }
  const png = await cardPng(c.env.KV, svg)
  return c.body(png, 200, { ...cache, 'Content-Type': 'image/png' })
}
