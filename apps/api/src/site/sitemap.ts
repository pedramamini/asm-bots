/**
 * `GET /sitemap.xml`: the web build's sitemap (`apps/web/src/app/pages.ts`: the app's pages and
 * the docs) with what only the database knows added: each hill, and each public bot, the latest
 * change first. A crawler reads it seldom; clients may keep it an hour.
 */
import { type SitemapEntry, sitemapUrls, sitemapXml } from '@asmbots/protocol'
import type { Context } from 'hono'
import { listHills, listPublicBotPages } from '../db/queries'
import type { AppEnv } from '../env'
import { siteOrigin } from './heads'

/** A sitemap holds 50,000 URLs: the build's pages and the hills leave room for this many bots. */
export const SITEMAP_BOTS = 45_000

export async function sitemap(c: Context<AppEnv>): Promise<Response> {
  const site = siteOrigin(c.env)
  const res = await c.env.ASSETS.fetch(new Request(new URL('/sitemap.xml', c.req.url)))
  const built =
    res.ok && (res.headers.get('Content-Type') ?? '').includes('xml')
      ? await res.text()
      : sitemapXml([])
  const [hills, bots] = await Promise.all([
    listHills(c.env.DB),
    listPublicBotPages(c.env.DB, SITEMAP_BOTS),
  ])
  const entries: SitemapEntry[] = [
    ...hills.map((hill) => ({ loc: `${site}/hills/${hill.slug}` })),
    ...bots.map((bot) => ({ loc: `${site}/bots/${bot.id}`, lastmod: bot.updatedAt.slice(0, 10) })),
  ]
  const body =
    entries.length === 0 ? built : built.replace('</urlset>', `${sitemapUrls(entries)}\n</urlset>`)
  return c.body(body, 200, {
    'Content-Type': 'application/xml; charset=utf-8',
    'Cache-Control': 'public, max-age=3600',
  })
}
