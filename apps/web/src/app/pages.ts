/**
 * The pages the server can describe without data (PRODUCT_SPEC §10): each one's tab title (as its
 * route's `head` writes it), the words a link preview shows, and its share card's label and
 * headline. The build writes them to `/meta/pages.json` (`vite.config.ts`), where the Worker reads
 * them to write each page's `<head>`, and writes the sitemap and `robots.txt` from them. The pages
 * of a replay, a bot, a hill, a tournament, or a profile the Worker describes from their data.
 */
import {
  headTags,
  type PageMeta,
  type PagesManifest,
  routeTitle,
  sitemapXml,
} from '@asmbots/protocol'
import { docEntries } from '../docs'

/** The site's canonical origin. The Worker's `SITE_URL` (apps/api/wrangler.jsonc) agrees. */
export const SITE_URL = 'https://asmbots.io'

/** The app's own pages, by path. */
const APP_PAGES: Readonly<Record<string, PageMeta>> = {
  '/': {
    title: routeTitle('home'),
    description:
      'A Core War arena for 8086 assembly: up to 16 bots share one 64 KB core, with an editor, a debugger, tournaments, and hills.',
    label: '',
    headline: 'Write 8086 assembly. Fight for 64 KB.',
  },
  '/arena': {
    title: routeTitle('arena'),
    description:
      'Load up to 16 bots into one 64 KB core and watch them fight live: every write, every process, every death.',
    label: 'arena',
    headline: 'the arena',
  },
  '/editor': {
    title: routeTitle('editor'),
    description:
      'Write a bot in x16c assembly. It assembles as you type, and the debugger steps it one instruction at a time against any opponent.',
    label: 'editor',
    headline: 'editor and debugger',
  },
  '/tournaments': {
    title: routeTitle('tournaments'),
    description:
      'Round robins, brackets, and melees: run one in your browser, or enter the weekly championship.',
    label: 'tournaments',
    headline: 'tournaments',
  },
  '/hills': {
    title: routeTitle('hills'),
    description:
      'King-of-the-hill ladders: submit a bot, the server fights it against every entry, and the board keeps the best.',
    label: 'hills',
    headline: 'the hills',
  },
  '/docs': {
    title: routeTitle('docs'),
    description:
      'The machine, the language, the strategy guide, tournaments and hills, and the tools: what it takes to write a bot that wins.',
    label: 'docs',
    headline: 'the docs',
  },
  '/settings': {
    title: routeTitle('settings'),
    description: 'Theme, arena effects, sound, keys, and your account.',
    label: 'settings',
    headline: 'settings',
    noindex: true,
  },
  '/embed/arena': {
    title: routeTitle('embed'),
    description: 'A battle in the ASM BOTS arena: 8086 bots fighting for 64 KB.',
    label: 'arena',
    headline: 'the arena',
    noindex: true,
  },
}

/** Every page the build describes: the app's, then each docs page by its sidebar title and blurb. */
export function pageManifest(): PagesManifest {
  const docs = docEntries().map(({ page }): [string, PageMeta] => [
    `/docs/${page.slug}`,
    {
      title: routeTitle('docs', page.title),
      description: page.blurb,
      label: 'docs',
      headline: page.title,
    },
  ])
  return { pages: { ...APP_PAGES, ...Object.fromEntries(docs) } }
}

/**
 * The build's sitemap: the pages of `manifest` search may index, on `site`. The Worker adds the
 * hills and the public bots when it serves it (`apps/api/src/site/sitemap.ts`).
 */
export function sitemap(site: string, manifest: PagesManifest): string {
  const paths = Object.entries(manifest.pages)
    .filter(([, page]) => page.noindex !== true)
    .map(([path]) => path)
  return sitemapXml(paths.map((path) => ({ loc: `${site}${path}` })))
}

/** `robots.txt`: every page may be crawled; the embeds say `noindex` in their heads. */
export function robotsTxt(site: string): string {
  return ['User-agent: *', 'Allow: /', '', `Sitemap: ${site}/sitemap.xml`, ''].join('\n')
}

/**
 * The tags index.html carries for a host that serves it as it is (`vite preview`, a static host):
 * the home page's. The Worker replaces them with each page's own.
 */
export function defaultHeadTags(site: string, manifest: PagesManifest): string {
  const home = manifest.pages['/'] as PageMeta
  return headTags({
    title: home.title,
    description: home.description,
    canonical: `${site}/`,
    url: `${site}/`,
    image: `${site}/api/pages/og.png?path=${encodeURIComponent('/')}`,
    imageAlt: `ASM BOTS: ${home.headline}`,
  })
}
