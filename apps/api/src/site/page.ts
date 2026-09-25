/**
 * A page of the web app: its file from the static assets, and when it is HTML (a route's
 * `index.html`, by the single-page fallback), the page's own `<head>` in it (`heads.ts`).
 */
import type { Context } from 'hono'
import type { AppEnv } from '../env'
import { pageHead } from './heads'
import { isPage, withHead } from './html'

export async function servePage(c: Context<AppEnv>): Promise<Response> {
  const res = await c.env.ASSETS.fetch(c.req.raw)
  if (c.req.method !== 'GET' || !isPage(res)) return res
  return withHead(res, await pageHead(c))
}
