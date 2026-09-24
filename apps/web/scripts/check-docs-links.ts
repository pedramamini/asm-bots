/**
 * `bun run docs-links` checks every link of the docs' MDX (each page of `src/docs/nav.ts`),
 * prints each broken one as `file:line: message`, and exits 1 if there is any:
 *
 * - `/docs/<slug>` names a page of the tree, and its `#anchor` one of that page's `##`/`###`
 *   headings (the ids `text.ts` gives them, read as `gen-docs-index.ts` reads them); a bare
 *   `#anchor` one of this page's;
 * - any other app path (`/editor`, `/hills/<slug>`) matches a route of `src/routeTree.gen.ts`;
 * - an outside link is `https://` (or `mailto:`), well formed; the network is not asked;
 * - a relative path (`../x`) is an error: the router would read it against the page's URL;
 * - `<Fig src>` names a figure of `src/docs/figures/`, and `<Shot src>` a file of
 *   `public/docs-shots/`.
 *
 * `bun run check` runs it; `test/docs-links.test.ts` holds its rules to small pages.
 */
import { existsSync, readFileSync } from 'node:fs'
import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createProcessor } from '@mdx-js/mdx'
import { SHOT_PATH } from '../src/docs/blocks'
import { FIGURES } from '../src/docs/figures'
import { DOCS, type DocPage, docFile } from '../src/docs/nav'
import { REMARK_PLUGINS } from '../src/docs/remark'
import { pageFile, pageRecords } from './gen-docs-index'

const APP_DIR = fileURLToPath(new URL('../', import.meta.url))
const ROUTE_TREE = `${APP_DIR}src/routeTree.gen.ts`
const PUBLIC_DIR = `${APP_DIR}public`

/** A link that goes nowhere: where it is and why. */
export interface LinkProblem {
  file: string
  line: number
  message: string
}

/** One link of a page: its target, and where in the file it is. */
export interface PageLink {
  url: string
  line: number
  /** `Fig` or `Shot` for a picture's `src`; otherwise a link. */
  kind: 'link' | 'Fig' | 'Shot'
}

interface MdNode {
  type: string
  url?: string
  name?: string | null
  attributes?: { type: string; name?: string; value?: unknown }[]
  position?: { start: { line: number } }
  children?: MdNode[]
}

/** The string value of a JSX element's attribute `name`, when it is a plain string. */
function attribute(node: MdNode, name: string): string | undefined {
  const found = node.attributes?.find((a) => a.type === 'mdxJsxAttribute' && a.name === name)
  return typeof found?.value === 'string' ? found.value : undefined
}

/** Every link of an MDX page: Markdown links and images, JSX `href`s, and pictures' `src`. */
export function pageLinks(mdx: string): PageLink[] {
  const tree = createProcessor({ remarkPlugins: REMARK_PLUGINS }).parse(mdx) as MdNode
  const links: PageLink[] = []
  const visit = (node: MdNode) => {
    const line = node.position?.start.line ?? 0
    if ((node.type === 'link' || node.type === 'image' || node.type === 'definition') && node.url) {
      links.push({ url: node.url, line, kind: 'link' })
    } else if (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') {
      const src = attribute(node, 'src')
      if ((node.name === 'Fig' || node.name === 'Shot') && src !== undefined) {
        links.push({ url: src, line, kind: node.name })
      }
      for (const name of ['href', 'to']) {
        const url = attribute(node, name)
        if (url !== undefined) links.push({ url, line, kind: 'link' })
      }
    }
    for (const child of node.children ?? []) visit(child)
  }
  visit(tree)
  return links
}

/** The app's routes as patterns: `/hills/$slug` matches `/hills/core`, `/docs/$` any rest. */
export function appRoutes(tree = readFileSync(ROUTE_TREE, 'utf8')): RegExp[] {
  const block = /interface FileRoutesByTo \{([^}]*)\}/.exec(tree)?.[1]
  if (block === undefined) throw new Error('routeTree.gen.ts has no FileRoutesByTo')
  return [...block.matchAll(/'([^']+)':/g)].map(([, path]) => {
    const pattern = (path as string)
      .replace(/\/$/, '')
      .split('/')
      .map((part) => (part === '$' ? '.+' : part.startsWith('$') ? '[^/]+' : part))
      .join('/')
    return new RegExp(`^${pattern === '' ? '/' : pattern}/?$`)
  })
}

/** What the checker knows of the docs: each page's anchors, the routes, the pictures. */
export interface LinkContext {
  /** Each page's slug and its anchors (`''` is the page's top). */
  anchors: ReadonlyMap<string, ReadonlySet<string>>
  routes: readonly RegExp[]
  figures: ReadonlySet<string>
  hasShot: (name: string) => boolean
}

/** Why `link` of the page `slug` goes nowhere, or undefined when it lands. */
export function linkProblem(slug: string, link: PageLink, ctx: LinkContext): string | undefined {
  const { url } = link
  if (link.kind === 'Fig') {
    return ctx.figures.has(url) ? undefined : `<Fig src="${url}">: no such figure`
  }
  if (link.kind === 'Shot') {
    return ctx.hasShot(url) ? undefined : `<Shot src="${url}">: no ${SHOT_PATH}${url}.webp`
  }
  if (/^mailto:[^@\s]+@[^@\s]+$/.test(url)) return undefined
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
    if (!url.startsWith('https://')) return `${url}: an outside link must be https://`
    try {
      new URL(url)
      return undefined
    } catch {
      return `${url}: not a URL`
    }
  }
  const at = url.indexOf('#')
  const path = at < 0 ? url : url.slice(0, at)
  const hash = at < 0 ? undefined : decodeURIComponent(url.slice(at + 1))
  if (path !== '' && !path.startsWith('/')) {
    return `${url}: a relative link; write the path from the root (/docs/…)`
  }
  if (path === '' || path.startsWith('/docs/')) {
    const target = path === '' ? slug : path.slice('/docs/'.length).replace(/\/$/, '')
    const anchors = ctx.anchors.get(target)
    if (anchors === undefined) return `${url}: no docs page ${target}`
    if (hash !== undefined && !anchors.has(hash)) {
      return `${url}: ${target} has no heading #${hash}`
    }
    return undefined
  }
  if (!ctx.routes.some((route) => route.test(path))) return `${url}: no route matches ${path}`
  if (hash !== undefined && path.replace(/\/$/, '') === '/docs' && hash !== '') {
    return `${url}: the contents page has no headings to link to`
  }
  return undefined
}

/** Every broken link of the docs: `read` gives a page's MDX (the file on disk by default). */
export function checkDocsLinks(
  read: (page: DocPage) => string = (page) => readFileSync(pageFile(page), 'utf8'),
): LinkProblem[] {
  const pages = DOCS.flatMap((section) => section.pages)
  const sources = new Map(pages.map((page) => [page.slug, read(page)]))
  const context: LinkContext = {
    anchors: new Map(
      pages.map((page) => [
        page.slug,
        new Set(
          pageRecords(page.slug, page.title, sources.get(page.slug) ?? '').map((r) => r.anchor),
        ),
      ]),
    ),
    routes: appRoutes(),
    figures: new Set(Object.keys(FIGURES)),
    hasShot: (name) => existsSync(`${PUBLIC_DIR}${SHOT_PATH}${name}.webp`),
  }
  return pages.flatMap((page) =>
    pageLinks(sources.get(page.slug) ?? '').flatMap((link) => {
      const message = linkProblem(page.slug, link, context)
      return message === undefined
        ? []
        : [{ file: `${docFile(page)}.mdx`, line: link.line, message }]
    }),
  )
}

if (import.meta.main) {
  const problems = checkDocsLinks()
  const dir = relative(process.cwd(), fileURLToPath(new URL('../src/docs/', import.meta.url)))
  for (const { file, line, message } of problems)
    console.error(`${dir}/${file}:${line}: ${message}`)
  const count = DOCS.flatMap((s) => s.pages).reduce(
    (n, page) => n + pageLinks(readFileSync(pageFile(page), 'utf8')).length,
    0,
  )
  if (problems.length > 0) {
    console.error(`${problems.length} broken of ${count} links`)
    process.exit(1)
  }
  console.log(`docs links: ${count} checked, none broken`)
}
