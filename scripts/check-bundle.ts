/**
 * `bun run bundle` builds the web app (Vite alone: `check` type-checks first) and checks
 * `apps/web/dist` against its budgets (web README "Budgets", PRODUCT_SPEC §11). `bun run check`
 * runs it, and CI runs it on its own ahead of `check`, so a miss fails CI. It checks:
 *
 * - each page's cold JS: what a browser fetches before the page draws, the entry's static imports
 *   and the page's route chunk's, from the build's manifest (`dist/.vite/manifest.json`),
 *   gzipped at level 9 (the CDN's brotli is smaller). `/arena`, engine + renderer + shell: 250 KB;
 * - what a page loads after its first paint (the home demo), and the Workers (the arena's loads at
 *   the first fight);
 * - that CodeMirror and the editor load with the editor's pages only, and the docs' pages with the
 *   docs';
 * - the fonts: 120 KB in all;
 * - the static files' `Cache-Control` (`dist/_headers`): the hashed files under /assets are kept a
 *   year, so every file there must carry its hash; and the manifest stays off the deploy.
 *
 * KB here is 1,024 bytes. It exits 1 and names what is over.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

/** The web build. */
export const DIST = fileURLToPath(new URL('../apps/web/dist/', import.meta.url))

const KB = 1024

/**
 * A page's cold JS budget in KB: its route file, as the manifest names its chunk, and the layout
 * route's around it, whose chunk loads with it.
 */
export interface PageBudget {
  readonly page: string
  readonly route: string
  readonly layout?: string
  readonly kb: number
}

/** What a page loads after its first paint, beyond its cold JS: a dynamic entry's closure. */
export interface AfterPaintBudget {
  readonly label: string
  readonly page: string
  readonly src: string
  readonly kb: number
}

/** A Worker, by the name the build gives its file (`assets/<name>-<hash>.js`). */
export interface WorkerBudget {
  readonly label: string
  readonly name: string
  readonly kb: number
}

export interface Budgets {
  readonly pages: readonly PageBudget[]
  /** The shell, which every page loads: the entry and its static imports. */
  readonly shellKb: number
  readonly afterPaint: readonly AfterPaintBudget[]
  readonly workers: readonly WorkerBudget[]
  /** Every font file, as shipped (woff2 is compressed already). */
  readonly fontsKb: number
}

/**
 * The pages and their budgets. `/arena`'s is PRODUCT_SPEC §11's; each other sits about 5% over
 * what the page loads now, so a change that adds to it is a choice, made in the README too.
 */
const PAGE_BUDGETS: readonly PageBudget[] = [
  { page: '/', route: 'src/routes/index.tsx', kb: 185 },
  { page: '/arena', route: 'src/routes/arena/index.tsx', kb: 250 },
  { page: '/arena/$replayId', route: 'src/routes/arena/$replayId.tsx', kb: 250 },
  { page: '/editor', route: 'src/routes/editor/index.tsx', kb: 440 },
  { page: '/editor/$botId', route: 'src/routes/editor/$botId.tsx', kb: 440 },
  { page: '/tournaments', route: 'src/routes/tournaments/index.tsx', kb: 235 },
  { page: '/tournaments/$id', route: 'src/routes/tournaments/$id.tsx', kb: 275 },
  { page: '/hills', route: 'src/routes/hills/index.tsx', kb: 180 },
  { page: '/hills/$slug', route: 'src/routes/hills/$slug.tsx', kb: 200 },
  { page: '/bots/$id', route: 'src/routes/bots/$id.tsx', kb: 195 },
  { page: '/u/$handle', route: 'src/routes/u/$handle.tsx', kb: 180 },
  { page: '/docs', route: 'src/routes/docs/index.tsx', layout: 'src/routes/docs.tsx', kb: 180 },
  { page: '/docs/$', route: 'src/routes/docs/$.tsx', layout: 'src/routes/docs.tsx', kb: 190 },
  { page: '/settings', route: 'src/routes/settings.tsx', kb: 195 },
  { page: '/embed/arena', route: 'src/routes/embed/arena/index.tsx', kb: 225 },
]

/** The web app's budgets (web README "Budgets"). */
export const BUDGETS: Budgets = {
  pages: PAGE_BUDGETS,
  shellKb: 175,
  afterPaint: [
    {
      label: '/ home demo, after paint',
      page: '/',
      src: 'src/features/arena/demo/HomeDemo.tsx',
      kb: 40,
    },
  ],
  workers: [
    { label: 'arena Worker, at the first fight', name: 'arena.worker', kb: 20 },
    { label: 'assembler Worker, with the editor', name: 'asm.worker', kb: 20 },
  ],
  fontsKb: 120,
}

/** What the hashed files must say, and how a hashed file's name ends. */
export const IMMUTABLE = 'public, max-age=31536000, immutable'
const HASHED = /-[\w-]{8}\.[a-z0-9]+$/

/** The chunks only the editor's pages may load, and only the docs'. */
const EDITOR_SRC = /^src\/(routes|features)\/editor\//
const DOCS_SRC = /^src\/(routes\/docs|docs\/)/

/** A chunk of the build's manifest, by the key the manifest gives it. */
export interface ManifestChunk {
  readonly file: string
  readonly src?: string
  readonly name?: string
  readonly isEntry?: boolean
  readonly isDynamicEntry?: boolean
  readonly imports?: readonly string[]
  readonly dynamicImports?: readonly string[]
}
export type Manifest = Readonly<Record<string, ManifestChunk>>

/** A line of the report: what was measured against its budget. */
export interface Row {
  readonly label: string
  readonly kb: number
  readonly budget: number
}

export interface Report {
  readonly rows: readonly Row[]
  /** Each miss, in words; empty when the build is within every budget. */
  readonly problems: readonly string[]
}

const round = (bytes: number) => Math.round((bytes / KB) * 10) / 10

/** The static imports of `keys`, and theirs: what loads with them. */
export function closure(manifest: Manifest, keys: readonly string[]): Set<string> {
  const seen = new Set<string>()
  const stack = [...keys]
  for (let key = stack.pop(); key !== undefined; key = stack.pop()) {
    if (seen.has(key)) continue
    seen.add(key)
    stack.push(...(manifest[key]?.imports ?? []))
  }
  return seen
}

/**
 * The `_headers` rules: each path pattern's headers. A pattern is a line of its own; its headers
 * are the indented `Name: value` lines under it; `#` starts a comment.
 */
export function parseHeaders(text: string): Map<string, Map<string, string>> {
  const rules = new Map<string, Map<string, string>>()
  let current: Map<string, string> | null = null
  for (const line of text.split('\n')) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    if (!/^\s/.test(line)) {
      current = new Map()
      rules.set(line.trim(), current)
      continue
    }
    const colon = line.indexOf(':')
    if (current !== null && colon > 0) {
      current.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim())
    }
  }
  return rules
}

/** Checks the build in `dist` against `budgets`. */
export function checkBundle(dist: string, budgets: Budgets = BUDGETS): Report {
  const rows: Row[] = []
  const problems: string[] = []
  const measure = (label: string, bytes: number, budget: number) => {
    rows.push({ label, kb: round(bytes), budget })
    if (bytes > budget * KB) problems.push(`${label}: ${round(bytes)} KB, over ${budget} KB`)
  }
  const manifestPath = join(dist, '.vite/manifest.json')
  if (!existsSync(manifestPath)) {
    const where = relative(process.cwd(), manifestPath)
    return {
      rows,
      problems: [`no ${where}: build the web app (bun run --filter @asmbots/web build)`],
    }
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest
  const sizes = new Map<string, number>()
  const gzipped = (file: string): number => {
    const known = sizes.get(file)
    if (known !== undefined) return known
    const size: number = gzipSync(readFileSync(join(dist, file)), { level: 9 }).length
    sizes.set(file, size)
    return size
  }
  const bytesOf = (keys: Iterable<string>) => {
    let sum = 0
    for (const key of keys) {
      const file = manifest[key]?.file
      if (file?.endsWith('.js')) sum += gzipped(file)
    }
    return sum
  }
  const lazyMisses = (label: string, keys: Iterable<string>, editor: boolean, docs: boolean) => {
    for (const key of keys) {
      const chunk = manifest[key]
      const src = chunk?.src ?? ''
      if (!editor && (chunk?.name === 'editor' || EDITOR_SRC.test(src))) {
        problems.push(`${label} loads the editor's ${chunk?.file}: the editor must stay lazy`)
      }
      if (!docs && DOCS_SRC.test(src)) {
        problems.push(`${label} loads the docs' ${chunk?.file}: the docs must stay lazy`)
      }
    }
  }

  const entries = Object.keys(manifest).filter((key) => manifest[key]?.isEntry === true)
  const shell = closure(manifest, entries)
  measure('shell, every page', bytesOf(shell), budgets.shellKb)
  lazyMisses('the shell', shell, false, false)

  const cold = new Map<string, Set<string>>()
  for (const { page, route, layout, kb } of budgets.pages) {
    const chunks = [route, ...(layout === undefined ? [] : [layout])].map(
      (file) => `${file}?tsr-split=component`,
    )
    const gone = chunks.filter((key) => manifest[key] === undefined)
    if (gone.length > 0) {
      problems.push(`${page}: the build has no chunk ${gone.join(', ')}; update the budgets`)
      continue
    }
    const keys = new Set([...shell, ...closure(manifest, chunks)])
    cold.set(page, keys)
    measure(page, bytesOf(keys), kb)
    lazyMisses(page, keys, page.startsWith('/editor'), page.startsWith('/docs'))
  }

  for (const { label, page, src, kb } of budgets.afterPaint) {
    const before = cold.get(page) ?? shell
    if (manifest[src] === undefined) {
      problems.push(`${label}: the build has no chunk ${src}; update the budgets`)
      continue
    }
    const after = [...closure(manifest, [src])].filter((key) => !before.has(key))
    measure(label, bytesOf(after), kb)
  }

  const assets = existsSync(join(dist, 'assets')) ? readdirSync(join(dist, 'assets')) : []
  for (const { label, name, kb } of budgets.workers) {
    const file = assets.find((f) => f.startsWith(`${name}-`) && f.endsWith('.js'))
    if (file === undefined) problems.push(`${label}: no assets/${name}-*.js in the build`)
    else measure(label, gzipped(`assets/${file}`), kb)
  }

  const fonts = assets.filter((f) => f.endsWith('.woff2'))
  const fontBytes = fonts.reduce((sum, f) => sum + readFileSync(join(dist, 'assets', f)).length, 0)
  measure(`fonts, ${fonts.length} files`, fontBytes, budgets.fontsKb)

  const headersPath = join(dist, '_headers')
  const rule = existsSync(headersPath)
    ? parseHeaders(readFileSync(headersPath, 'utf8')).get('/assets/*')
    : undefined
  if (rule?.get('cache-control') !== IMMUTABLE) {
    problems.push(`_headers: /assets/* must say Cache-Control: ${IMMUTABLE}`)
  }
  const unhashed = assets.filter((f) => !HASHED.test(f))
  if (unhashed.length > 0) {
    problems.push(
      `assets/ holds files with no hash in their name, kept a year: ${unhashed.join(', ')}`,
    )
  }
  const ignorePath = join(dist, '.assetsignore')
  const ignored = existsSync(ignorePath) ? readFileSync(ignorePath, 'utf8').split('\n') : []
  if (!ignored.some((line) => line.trim() === '.vite')) {
    problems.push('.assetsignore must list .vite: the manifest is no file to deploy')
  }
  return { rows, problems }
}

/** The report as lines: each measure against its budget, then what is over. */
export function formatReport(report: Report): string[] {
  const width = Math.max(0, ...report.rows.map((r) => r.label.length))
  const lines = report.rows.map((r) => {
    const mark = r.kb > r.budget ? 'OVER' : 'ok'
    return `  ${r.label.padEnd(width)}  ${r.kb.toFixed(1).padStart(6)} / ${String(r.budget).padStart(3)} KB  ${mark}`
  })
  if (report.problems.length === 0) return [...lines, 'bundle: every budget holds']
  return [...lines, ...report.problems.map((p) => `✗ ${p}`)]
}

if (import.meta.main) {
  const report = checkBundle(DIST)
  console.log(`bundle budgets: ${relative(process.cwd(), DIST) || '.'} (gzip -9, KB = 1,024 B)`)
  for (const line of formatReport(report)) console.log(line)
  process.exit(report.problems.length === 0 ? 0 : 1)
}
