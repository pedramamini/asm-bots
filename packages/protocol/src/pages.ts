/**
 * Pages as a link preview or a crawler reads them (PRODUCT_SPEC §10). The web app draws in the
 * browser, so a crawler that runs no script sees only index.html: the Worker writes each page's
 * `<head>` into it on the way out. This is what the two agree on: the tab title every route
 * shares, the manifest the web build writes of the pages it can describe without data, the head
 * tags, the share card's size, and the sitemap's XML.
 */
import { escapeXml } from '@asmbots/tourney'

/** The brand, as the header, the tab, and a share card show it. */
export const BRAND = 'ASM BOTS'

/** The tab title of a route: `ASM BOTS // ARENA`, and any detail after it: `… · replay 1a2b`. */
export function routeTitle(label: string, detail?: string): string {
  const title = `${BRAND} // ${label.toUpperCase()}`
  return detail === undefined ? title : `${title} · ${detail}`
}

/** Where the web build writes its pages' manifest, from the site's root. */
export const PAGES_MANIFEST = '/meta/pages.json'

/** A share card's size, px: Open Graph's 1.91:1. */
export const CARD_WIDTH = 1200
export const CARD_HEIGHT = 630

/** A page the web build describes: what its head says, and what its share card shows. */
export interface PageMeta {
  /** The tab title, as the route's `head` writes it: `ASM BOTS // DOCS · memory`. */
  readonly title: string
  /** A sentence or two for a link preview and a search result. */
  readonly description: string
  /** The card's label, after the brand (`docs`); empty for the brand alone. */
  readonly label: string
  /** The card's headline: `memory`. */
  readonly headline: string
  /** Kept out of search engines and the sitemap: an embed, the settings. */
  readonly noindex?: boolean | undefined
}

/** The web build's pages, by path: `/`, `/arena`, `/docs/machine/memory`. */
export interface PagesManifest {
  readonly pages: Readonly<Record<string, PageMeta>>
}

const isText = (value: unknown): value is string => typeof value === 'string'

/** `value` as a manifest, or null when it is not one: every page needs its four texts. */
export function readPagesManifest(value: unknown): PagesManifest | null {
  if (typeof value !== 'object' || value === null) return null
  const pages = (value as { pages?: unknown }).pages
  if (typeof pages !== 'object' || pages === null) return null
  for (const [path, page] of Object.entries(pages)) {
    if (!path.startsWith('/') || typeof page !== 'object' || page === null) return null
    const { title, description, label, headline } = page as Record<string, unknown>
    if (![title, description, label, headline].every(isText)) return null
  }
  return { pages: pages as PagesManifest['pages'] }
}

/** What a page's `<head>` tells link previews and crawlers. URLs are absolute. */
export interface PageHead {
  /** The tab title. */
  readonly title: string
  /** The title a link preview shows; the tab title when left out. */
  readonly cardTitle?: string | undefined
  readonly description: string
  /** The page's canonical URL: no query, no fragment. */
  readonly canonical: string
  /** The URL a preview links: the canonical one, or the one shared (an arena setup's query). */
  readonly url: string
  /** The share card: a PNG of `CARD_WIDTH` × `CARD_HEIGHT`. */
  readonly image: string
  readonly imageAlt: string
  readonly noindex?: boolean | undefined
}

/**
 * The tags of `head` but its title, one a line: the description, the canonical link, the robots
 * rule of a page kept out of search, and the Open Graph and Twitter card tags. Every value is
 * escaped.
 */
export function headTags(head: PageHead): string {
  const title = head.cardTitle ?? head.title
  const meta = (key: 'name' | 'property', name: string, content: string | number) =>
    `<meta ${key}="${name}" content="${escapeXml(String(content))}" />`
  return [
    meta('name', 'description', head.description),
    `<link rel="canonical" href="${escapeXml(head.canonical)}" />`,
    ...(head.noindex === true ? [meta('name', 'robots', 'noindex')] : []),
    meta('property', 'og:site_name', BRAND),
    meta('property', 'og:type', 'website'),
    meta('property', 'og:title', title),
    meta('property', 'og:description', head.description),
    meta('property', 'og:url', head.url),
    meta('property', 'og:image', head.image),
    meta('property', 'og:image:type', 'image/png'),
    meta('property', 'og:image:width', CARD_WIDTH),
    meta('property', 'og:image:height', CARD_HEIGHT),
    meta('property', 'og:image:alt', head.imageAlt),
    meta('name', 'twitter:card', 'summary_large_image'),
    meta('name', 'twitter:title', title),
    meta('name', 'twitter:description', head.description),
    meta('name', 'twitter:image', head.image),
    meta('name', 'twitter:image:alt', head.imageAlt),
  ].join('\n')
}

/** A page of the sitemap: its URL, and the day it last changed (`2026-09-24`) when known. */
export interface SitemapEntry {
  readonly loc: string
  readonly lastmod?: string | undefined
}

/** The `<url>` elements of `entries`, one a line. */
export function sitemapUrls(entries: readonly SitemapEntry[]): string {
  return entries
    .map(({ loc, lastmod }) => {
      const date = lastmod === undefined ? '' : `<lastmod>${escapeXml(lastmod)}</lastmod>`
      return `<url><loc>${escapeXml(loc)}</loc>${date}</url>`
    })
    .join('\n')
}

/** A sitemap of `entries` (sitemaps.org 0.9). */
export function sitemapXml(entries: readonly SitemapEntry[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...(entries.length === 0 ? [] : [sitemapUrls(entries)]),
    '</urlset>',
    '',
  ].join('\n')
}
