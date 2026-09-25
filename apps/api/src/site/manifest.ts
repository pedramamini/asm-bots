/**
 * The web build's pages manifest (`PAGES_MANIFEST`, `apps/web/src/app/pages.ts`): each page it can
 * describe without data. Read from the static assets once an isolate; a deploy starts new
 * isolates, so it is never older than the assets. A read that fails is tried again next time.
 */
import { PAGES_MANIFEST, type PagesManifest, readPagesManifest } from '@asmbots/protocol'
import type { Env } from '../env'
import { log } from '../middleware'

let kept: PagesManifest | null = null

/** The manifest, or null when the assets have none (a web build from before it, a test site). */
export async function pagesManifest(env: Env, origin: string): Promise<PagesManifest | null> {
  if (kept !== null) return kept
  try {
    const res = await env.ASSETS.fetch(new Request(new URL(PAGES_MANIFEST, origin)))
    // No such file: a 404, or the single-page fallback's index.html.
    if (!res.ok || !res.headers.get('Content-Type')?.includes('json')) return null
    const manifest = readPagesManifest(await res.json())
    if (manifest === null) log('warn', 'pages manifest is malformed', { path: PAGES_MANIFEST })
    kept = manifest
    return manifest
  } catch (error) {
    log('warn', 'pages manifest did not load', { error: String(error) })
    return null
  }
}
