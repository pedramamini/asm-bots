import { afterAll, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BUDGETS,
  type Budgets,
  checkBundle,
  closure,
  formatReport,
  IMMUTABLE,
  type Manifest,
  parseHeaders,
} from './check-bundle'

const DIR = mkdtempSync(join(tmpdir(), 'asmbots-bundle-'))
afterAll(() => rmSync(DIR, { recursive: true, force: true }))

const GOOD_HEADERS = `# the rules\n/assets/*\n  Cache-Control: ${IMMUTABLE}\n`

/** A chunk file of the fake build: its manifest key, and its file under assets/. */
const chunk = (name: string) => `assets/${name}-${name.padEnd(8, 'x').slice(0, 8)}.js`

/**
 * The fake build: a shell (entry and vendor), `/arena` (with a chunk it shares with `/editor`),
 * `/editor` (with CodeMirror's chunk), `/docs` in its layout, a home page with a demo after paint,
 * and a Worker. Random bytes do not compress, so each file's KB is its gzip size, near enough.
 */
const MANIFEST: Manifest = {
  'index.html': { file: chunk('entry'), isEntry: true, imports: ['_vendor.js'] },
  '_vendor.js': { file: chunk('vendor'), name: 'vendor' },
  'src/routes/index.tsx?tsr-split=component': {
    file: chunk('home'),
    src: 'src/routes/index.tsx?tsr-split=component',
    isDynamicEntry: true,
    imports: ['_vendor.js'],
    dynamicImports: ['src/features/arena/demo/HomeDemo.tsx'],
  },
  'src/features/arena/demo/HomeDemo.tsx': {
    file: chunk('demo'),
    src: 'src/features/arena/demo/HomeDemo.tsx',
    isDynamicEntry: true,
    imports: ['_vendor.js', '_shared.js'],
  },
  'src/routes/arena/index.tsx?tsr-split=component': {
    file: chunk('arena'),
    src: 'src/routes/arena/index.tsx?tsr-split=component',
    isDynamicEntry: true,
    imports: ['_vendor.js', '_shared.js'],
  },
  '_shared.js': { file: chunk('shared'), name: 'shared' },
  'src/routes/editor/index.tsx?tsr-split=component': {
    file: chunk('edit'),
    src: 'src/routes/editor/index.tsx?tsr-split=component',
    isDynamicEntry: true,
    imports: ['_editor.js', '_shared.js'],
  },
  '_editor.js': { file: chunk('editor'), name: 'editor' },
  'src/routes/docs.tsx?tsr-split=component': {
    file: chunk('docsframe'),
    src: 'src/routes/docs.tsx?tsr-split=component',
    isDynamicEntry: true,
  },
  'src/routes/docs/index.tsx?tsr-split=component': {
    file: chunk('docs'),
    src: 'src/routes/docs/index.tsx?tsr-split=component',
    isDynamicEntry: true,
  },
  '../../packages/ui/src/fonts/a.woff2': { file: 'assets/a-aaaaaaaa.woff2' },
}

/** Each file's size, KB. */
const SIZES: Record<string, number> = {
  [chunk('entry')]: 10,
  [chunk('vendor')]: 20,
  [chunk('home')]: 2,
  [chunk('demo')]: 5,
  [chunk('arena')]: 8,
  [chunk('shared')]: 4,
  [chunk('edit')]: 6,
  [chunk('editor')]: 30,
  [chunk('docsframe')]: 3,
  [chunk('docs')]: 1,
  'assets/arena.worker-wwwwwwww.js': 6,
  'assets/a-aaaaaaaa.woff2': 12,
}

/** Budgets that the fake build meets, each by a KB or more. */
const FITS: Budgets = {
  pages: [
    { page: '/', route: 'src/routes/index.tsx', kb: 34 },
    { page: '/arena', route: 'src/routes/arena/index.tsx', kb: 44 },
    { page: '/editor', route: 'src/routes/editor/index.tsx', kb: 72 },
    { page: '/docs', route: 'src/routes/docs/index.tsx', layout: 'src/routes/docs.tsx', kb: 36 },
  ],
  shellKb: 32,
  afterPaint: [{ label: 'demo', page: '/', src: 'src/features/arena/demo/HomeDemo.tsx', kb: 11 }],
  workers: [{ label: 'arena Worker', name: 'arena.worker', kb: 8 }],
  fontsKb: 13,
}

let builds = 0

/** Writes a fake build and returns its directory. */
function fakeBuild({
  manifest = MANIFEST,
  sizes = SIZES,
  headers = GOOD_HEADERS as string | null,
  ignore = '# the manifest\n.vite\n' as string | null,
} = {}): string {
  const dist = join(DIR, `dist-${++builds}`)
  mkdirSync(join(dist, 'assets'), { recursive: true })
  mkdirSync(join(dist, '.vite'))
  writeFileSync(join(dist, '.vite/manifest.json'), JSON.stringify(manifest))
  for (const [file, kb] of Object.entries(sizes)) {
    writeFileSync(join(dist, file), crypto.getRandomValues(new Uint8Array(kb * 1024)))
  }
  if (headers !== null) writeFileSync(join(dist, '_headers'), headers)
  if (ignore !== null) writeFileSync(join(dist, '.assetsignore'), ignore)
  return dist
}

/** Each row's KB, rounded to whole KB: gzip adds a few bytes to random ones. */
function kbs(report: ReturnType<typeof checkBundle>): Record<string, number> {
  return Object.fromEntries(report.rows.map((r) => [r.label, Math.round(r.kb)]))
}

describe('check-bundle: a build within its budgets', () => {
  it('measures each page as the shell and its route chunk, each shared chunk once', () => {
    const report = checkBundle(fakeBuild(), FITS)
    expect(report.problems).toEqual([])
    expect(kbs(report)).toEqual({
      'shell, every page': 30,
      '/': 32,
      '/arena': 42,
      '/editor': 70,
      '/docs': 34,
      demo: 9,
      'arena Worker': 6,
      'fonts, 1 files': 12,
    })
    expect(formatReport(report).at(-1)).toBe('bundle: every budget holds')
  })

  it('counts what loads after the paint beyond what the page has: the demo, not its vendor', () => {
    const report = checkBundle(fakeBuild(), FITS)
    // The demo's own 5 KB and the shared chunk's 4: the vendor is the shell's.
    expect(kbs(report).demo).toBe(9)
  })
})

describe('check-bundle: misses', () => {
  it('names a page over its budget, by how much', () => {
    const tight = {
      ...FITS,
      pages: [{ page: '/arena', route: 'src/routes/arena/index.tsx', kb: 40 }],
    }
    const report = checkBundle(fakeBuild(), tight)
    expect(report.problems).toEqual([expect.stringMatching(/^\/arena: 42(\.\d)? KB, over 40 KB$/)])
    expect(formatReport(report)).toContainEqual(expect.stringMatching(/\/arena .* OVER$/))
  })

  it('names the shell, a Worker, the fonts, and what loads after the paint, over theirs', () => {
    const report = checkBundle(fakeBuild(), {
      ...FITS,
      shellKb: 29,
      workers: [{ label: 'arena Worker', name: 'arena.worker', kb: 5 }],
      fontsKb: 11,
      afterPaint: [{ ...(FITS.afterPaint[0] as Budgets['afterPaint'][number]), kb: 8 }],
    })
    expect(report.problems.map((p) => p.split(':')[0])).toEqual([
      'shell, every page',
      'demo',
      'arena Worker',
      'fonts, 1 files',
    ])
  })

  it('refuses the editor or the docs in a page that is not theirs', () => {
    const manifest: Manifest = {
      ...MANIFEST,
      'src/routes/arena/index.tsx?tsr-split=component': {
        file: chunk('arena'),
        imports: ['_vendor.js', '_editor.js', 'src/routes/docs/index.tsx?tsr-split=component'],
      },
    }
    const report = checkBundle(fakeBuild({ manifest }), {
      ...FITS,
      pages: [{ page: '/arena', route: 'src/routes/arena/index.tsx', kb: 200 }],
    })
    expect([...report.problems].sort()).toEqual([
      `/arena loads the docs' ${chunk('docs')}: the docs must stay lazy`,
      `/arena loads the editor's ${chunk('editor')}: the editor must stay lazy`,
    ])
  })

  it('says when a page, a dynamic entry, or a Worker is not in the build', () => {
    const report = checkBundle(fakeBuild(), {
      ...FITS,
      pages: [{ page: '/gone', route: 'src/routes/gone.tsx', kb: 1 }],
      afterPaint: [{ label: 'nothing', page: '/', src: 'src/nothing.tsx', kb: 1 }],
      workers: [{ label: 'a Worker', name: 'nobody.worker', kb: 1 }],
    })
    expect(report.problems).toEqual([
      '/gone: the build has no chunk src/routes/gone.tsx?tsr-split=component; update the budgets',
      'nothing: the build has no chunk src/nothing.tsx; update the budgets',
      'a Worker: no assets/nobody.worker-*.js in the build',
    ])
  })

  it('holds the static files to their Cache-Control and their hashed names', () => {
    const report = checkBundle(
      fakeBuild({
        headers: '/assets/*\n  Cache-Control: public, max-age=3600\n',
        sizes: { ...SIZES, 'assets/logo.svg': 1 },
        ignore: null,
      }),
      FITS,
    )
    expect(report.problems).toEqual([
      `_headers: /assets/* must say Cache-Control: ${IMMUTABLE}`,
      'assets/ holds files with no hash in their name, kept a year: logo.svg',
      '.assetsignore must list .vite: the manifest is no file to deploy',
    ])
    expect(checkBundle(fakeBuild({ headers: null }), FITS).problems).toEqual([
      `_headers: /assets/* must say Cache-Control: ${IMMUTABLE}`,
    ])
  })

  it('asks for a build when there is none', () => {
    expect(checkBundle(join(DIR, 'nothing'), FITS).problems).toEqual([
      expect.stringMatching(/manifest\.json: build the web app/),
    ])
  })
})

describe('check-bundle: parts', () => {
  it('follows static imports, not dynamic ones', () => {
    expect([...closure(MANIFEST, ['src/routes/index.tsx?tsr-split=component'])].sort()).toEqual([
      '_vendor.js',
      'src/routes/index.tsx?tsr-split=component',
    ])
  })

  it('reads _headers: patterns, their headers, and comments', () => {
    const rules = parseHeaders(
      '# a comment\n/assets/*\n  Cache-Control: a, b\n  X-Two: 2\n\n/favicon.svg\n  cache-control: c\n',
    )
    expect([...rules.keys()]).toEqual(['/assets/*', '/favicon.svg'])
    expect(Object.fromEntries(rules.get('/assets/*') ?? [])).toEqual({
      'cache-control': 'a, b',
      'x-two': '2',
    })
    expect(rules.get('/favicon.svg')?.get('cache-control')).toBe('c')
  })
})

describe('check-bundle: the budgets', () => {
  it("hold /arena to PRODUCT_SPEC §11's 250 KB, the fonts to 120 KB", () => {
    expect(BUDGETS.pages.find((p) => p.page === '/arena')?.kb).toBe(250)
    expect(BUDGETS.fontsKb).toBe(120)
  })

  it('are the ones the web README lists', () => {
    const readme = readFileSync(join(import.meta.dir, '../apps/web/README.md'), 'utf8')
    const section = readme.slice(readme.indexOf('## Budgets'))
    const rows = [
      ['shell, every page', BUDGETS.shellKb],
      ...BUDGETS.pages.map((p) => [`\`${p.page}\``, p.kb]),
      ...BUDGETS.afterPaint.map((a) => [a.label, a.kb]),
      ...BUDGETS.workers.map((w) => [w.label, w.kb]),
      ['fonts', BUDGETS.fontsKb],
    ] as const
    for (const [label, kb] of rows) {
      const line = section.split('\n').find((l) => l.startsWith(`| ${label}`))
      expect(line, String(label)).toBeDefined()
      expect(line, String(label)).toContain(`| ${kb} KB |`)
    }
  })
})
