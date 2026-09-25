/**
 * The site as crawlers and link previews read it (`src/app/pages.ts`, written at build by
 * `vite.config.ts`): the pages manifest the Worker writes each page's head from, whose titles are
 * the ones the routes' own `head`s write; the sitemap; `robots.txt`; and index.html's own tags.
 */
import { describe, expect, it } from 'bun:test'
import { rosterImage } from '@asmbots/bots'
import { readPagesManifest, routeTitle } from '@asmbots/protocol'
import {
  defaultHeadTags,
  pageManifest,
  ROBOTS_IMP,
  robotsTxt,
  SITE_URL,
  sitemap,
} from '../src/app/pages'
import { docEntries } from '../src/docs'
import { Route as ArenaRoute } from '../src/routes/arena/index'
import { Route as DocsRoute } from '../src/routes/docs'
import { Route as DocRoute } from '../src/routes/docs/$'
import { Route as EditorRoute } from '../src/routes/editor/index'
import { Route as EmbedRoute } from '../src/routes/embed/arena/index'
import { Route as HillsRoute } from '../src/routes/hills/index'
import { Route as HomeRoute } from '../src/routes/index'
import { Route as SettingsRoute } from '../src/routes/settings'
import { Route as TournamentsRoute } from '../src/routes/tournaments/index'

/** The tab title a route's `head` writes. */
function titleOf(route: { options: { head?: unknown } }, params: object = {}): string | undefined {
  const head = route.options.head as
    | ((context: object) => { meta?: { title?: string }[] })
    | undefined
  return head?.({ params })?.meta?.find((meta) => meta.title !== undefined)?.title
}

const manifest = pageManifest()

describe('the pages manifest', () => {
  it('is a manifest the Worker reads', () => {
    expect(readPagesManifest(JSON.parse(JSON.stringify(manifest)))).toEqual(manifest)
  })

  it('titles each app page as its route’s head does', () => {
    const routes = {
      '/': HomeRoute,
      '/arena': ArenaRoute,
      '/editor': EditorRoute,
      '/tournaments': TournamentsRoute,
      '/hills': HillsRoute,
      '/docs': DocsRoute,
      '/settings': SettingsRoute,
      '/embed/arena': EmbedRoute,
    }
    for (const [path, route] of Object.entries(routes)) {
      expect(manifest.pages[path]?.title, path).toBe(titleOf(route) as string)
    }
    expect(manifest.pages['/']?.headline).toBe('Write 8086 assembly. Fight for 64 KB.')
    expect(manifest.pages['/']?.label).toBe('')
  })

  it('has every docs page, by its sidebar title and blurb, titled as its route’s head does', () => {
    const entries = docEntries()
    expect(entries.length).toBeGreaterThan(40)
    for (const { page } of entries) {
      const meta = manifest.pages[`/docs/${page.slug}`]
      expect(meta, page.slug).toEqual({
        title: routeTitle('docs', page.title),
        description: page.blurb,
        label: 'docs',
        headline: page.title,
      })
      expect(meta?.title).toBe(titleOf(DocRoute, { _splat: page.slug }) as string)
    }
  })

  it('keeps the embed and the settings out of search', () => {
    const hidden = Object.entries(manifest.pages).filter(([, page]) => page.noindex === true)
    expect(hidden.map(([path]) => path).sort()).toEqual(['/embed/arena', '/settings'])
  })
})

describe('what the build writes', () => {
  it('a sitemap of every page search may index, on the site', () => {
    const xml = sitemap(SITE_URL, manifest)
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
    expect(locs[0]).toBe('https://asmbots.io/')
    expect(locs).toContain('https://asmbots.io/arena')
    expect(locs).toContain('https://asmbots.io/docs/machine/memory')
    expect(locs).not.toContain('https://asmbots.io/settings')
    expect(locs).not.toContain('https://asmbots.io/embed/arena')
    expect(locs).toHaveLength(Object.keys(manifest.pages).length - 2)
  })

  it('robots.txt: every page may be crawled, and where the sitemap is', () => {
    expect(robotsTxt(SITE_URL)).toBe(
      `${ROBOTS_IMP}\nUser-agent: *\nAllow: /\n\nSitemap: https://asmbots.io/sitemap.xml\n`,
    )
  })

  it("robots.txt: a one-line ASCII imp, in a comment, walking on its own loop's bytes", () => {
    expect(ROBOTS_IMP.startsWith('# ')).toBe(true)
    expect(ROBOTS_IMP).not.toContain('\n')
    expect(/^[\x20-\x7e]+$/.test(ROBOTS_IMP)).toBe(true)
    // The roster's imp ends in its loop: `movsw`, `nop`.
    const word = [...rosterImage('imp').bytes.slice(-2)]
      .map((b) => b.toString(16).toUpperCase().padStart(2, '0'))
      .join(' ')
    expect(word).toBe('A5 90')
    expect(ROBOTS_IMP).toContain(`# ${Array(8).fill(word).join(' ')} }:>`)
  })

  it('index.html’s tags: the home page’s, with its card', () => {
    const tags = defaultHeadTags(SITE_URL, manifest)
    expect(tags).toContain('<meta property="og:title" content="ASM BOTS // HOME" />')
    expect(tags).toContain(
      '<meta property="og:image" content="https://asmbots.io/api/pages/og.png?path=%2F" />',
    )
    expect(tags).toContain('<link rel="canonical" href="https://asmbots.io/" />')
    expect(tags).toContain('<meta name="twitter:card" content="summary_large_image" />')
  })
})
