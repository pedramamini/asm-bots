import type { PageMeta } from '@asmbots/protocol'
import { type Context, Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { AppEnv } from '../env'
import { pageCard } from '../og/page'
import { CARD_TTL, type CardFormat, cardHost, sendCard } from '../og/send'
import { HOME } from '../site/heads'
import { pagesManifest } from '../site/manifest'

/** The manifest page at `path`, or the home page's words for `/` when there is no manifest. */
async function pageAt(c: Context<AppEnv>, path: string): Promise<PageMeta | undefined> {
  const manifest = await pagesManifest(c.env, new URL(c.req.url).origin)
  return manifest?.pages[path] ?? (path === '/' ? HOME : undefined)
}

/** The share card of the page `?path=` names in `format`; it changes only with a deploy. */
const card = (format: CardFormat) => async (c: Context<AppEnv>) => {
  const path = c.req.query('path') ?? '/'
  const page = await pageAt(c, path)
  if (page === undefined) throw new HTTPException(404, { message: `no page ${path}` })
  return sendCard(c, pageCard(page, cardHost(c.env)), format, CARD_TTL)
}

/**
 * `GET /api/pages/og.svg?path=` and `og.png`: the share card (`og/page.ts`) of a page the web
 * build describes (`/meta/pages.json`): the home page, the arena, a docs page. Another path is a
 * 404, so the card of a page is only ever the words the build wrote.
 */
export const pages = new Hono<AppEnv>().get('/og.svg', card('svg')).get('/og.png', card('png'))
