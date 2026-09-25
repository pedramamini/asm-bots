/**
 * `pages.ts`: the tab title every route writes, the pages manifest the web build writes and the
 * Worker reads, a page's head tags, and the sitemap's XML.
 */
import { describe, expect, it } from 'bun:test'
import {
  BRAND,
  CARD_HEIGHT,
  CARD_WIDTH,
  entrantNames,
  headTags,
  type PageHead,
  readPagesManifest,
  routeTitle,
  sitemapUrls,
  sitemapXml,
} from '../src'

const PAGE = {
  title: 'ASM BOTS // DOCS · memory',
  description: 'one 64 KB ring.',
  label: 'docs',
  headline: 'memory',
}

describe('routeTitle', () => {
  it('is the brand, the label in capitals, and any detail after it', () => {
    expect(BRAND).toBe('ASM BOTS')
    expect(routeTitle('arena')).toBe('ASM BOTS // ARENA')
    expect(routeTitle('arena', 'replay 1a2b')).toBe('ASM BOTS // ARENA · replay 1a2b')
  })
})

describe('readPagesManifest', () => {
  it('reads a manifest whose every page has its four texts', () => {
    const manifest = {
      pages: { '/docs/machine/memory': PAGE, '/embed/arena': { ...PAGE, noindex: true } },
    }
    expect(readPagesManifest(manifest)).toEqual(manifest)
  })

  it('refuses anything else', () => {
    for (const value of [
      null,
      'pages',
      {},
      { pages: null },
      { pages: { memory: PAGE } },
      { pages: { '/': { ...PAGE, headline: 4 } } },
      { pages: { '/': null } },
    ]) {
      expect(readPagesManifest(value)).toBeNull()
    }
  })
})

describe('headTags', () => {
  const head: PageHead = {
    title: 'ASM BOTS // BOTS · b-1',
    cardTitle: '<b>&"\' by me',
    description: 'bombs "every" 4th byte & more',
    canonical: 'https://asmbots.io/bots/b-1',
    url: 'https://asmbots.io/arena?b=roster:dwarf&seed=1',
    image: 'https://asmbots.io/api/bots/b-1/og.png',
    imageAlt: 'ASM BOTS: <b>',
  }

  it('writes the description, the canonical link, and the card tags, each value escaped', () => {
    const tags = headTags(head)
    expect(tags).toContain(
      '<meta name="description" content="bombs &quot;every&quot; 4th byte &amp; more" />',
    )
    expect(tags).toContain('<link rel="canonical" href="https://asmbots.io/bots/b-1" />')
    expect(tags).toContain('<meta property="og:title" content="&lt;b&gt;&amp;&quot;&#39; by me" />')
    expect(tags).toContain(
      '<meta name="twitter:title" content="&lt;b&gt;&amp;&quot;&#39; by me" />',
    )
    expect(tags).toContain(
      '<meta property="og:url" content="https://asmbots.io/arena?b=roster:dwarf&amp;seed=1" />',
    )
    expect(tags).toContain(`<meta property="og:image:width" content="${CARD_WIDTH}" />`)
    expect(tags).toContain(`<meta property="og:image:height" content="${CARD_HEIGHT}" />`)
    expect(tags).toContain('<meta name="twitter:card" content="summary_large_image" />')
    expect(tags).toContain('<meta name="twitter:image:alt" content="ASM BOTS: &lt;b&gt;" />')
    expect(tags).not.toContain('robots')
    expect(tags).not.toContain('<title>')
  })

  it('takes the tab title for the card without one, and keeps a page out of search', () => {
    const tags = headTags({ ...head, cardTitle: undefined, noindex: true })
    expect(tags).toContain('<meta property="og:title" content="ASM BOTS // BOTS · b-1" />')
    expect(tags).toContain('<meta name="robots" content="noindex" />')
  })
})

describe('the sitemap', () => {
  it('lists each URL with its day, escaped', () => {
    expect(
      sitemapUrls([
        { loc: 'https://asmbots.io/a?b=1&c=2' },
        { loc: 'https://asmbots.io/bots/x', lastmod: '2026-09-24' },
      ]),
    ).toBe(
      '<url><loc>https://asmbots.io/a?b=1&amp;c=2</loc></url>\n<url><loc>https://asmbots.io/bots/x</loc><lastmod>2026-09-24</lastmod></url>',
    )
    const xml = sitemapXml([{ loc: 'https://asmbots.io/' }])
    expect(
      xml.startsWith(
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ),
    ).toBe(true)
    expect(xml.endsWith('</urlset>\n')).toBe(true)
    expect(sitemapXml([])).not.toContain('<url>')
  })
})

describe('entrantNames', () => {
  it('names each entrant once, with its owner where two share a name', () => {
    expect(
      entrantNames([
        { name: 'Dwarf', owner: 'alice' },
        { name: 'Imp', owner: 'alice' },
        { name: 'Dwarf', owner: 'bob' },
      ]),
    ).toEqual(['Dwarf (alice)', 'Imp', 'Dwarf (bob)'])
  })
})
