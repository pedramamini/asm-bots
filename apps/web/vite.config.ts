import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { THEMES } from '@asmbots/ui/themes'
import mdx from '@mdx-js/rollup'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { PAGES_MANIFEST } from '../../packages/protocol/src/pages'
// The token parser alone: the kit's index would pull React into the config.
import { parseTokenRules, themeTokens } from '../../packages/ui/src/css-tokens'
import { readReleases, releaseOf } from '../../scripts/changelog'
import { textImport } from '../../scripts/text-import'
import { getVersion } from '../../scripts/version'
import { defaultHeadTags, pageManifest, robotsTxt, SITE_URL, sitemap } from './src/app/pages'
import { themeBootScript } from './src/app/theme-boot'
import { REMARK_PLUGINS } from './src/docs/remark'

const PACKAGES = fileURLToPath(new URL('../../packages/', import.meta.url))

/** The workspace packages the app imports by name, each to its source entry (no build step). */
const WORKSPACE = ['asm', 'bots', 'codec', 'engine', 'protocol', 'tourney'] as const

/** The weights of the first paint: body and data (400), ticker, brand, and nav (500). */
const PRELOAD_WEIGHTS = [400, 500] as const

/** The tokens of a theme swatch: its surfaces, a hairline, its text, and its accent as text. */
const SWATCH_TOKENS = [
  '--bg',
  '--panel',
  '--border',
  '--text',
  '--text-muted',
  '--accent-fg',
] as const

/**
 * `/api` goes to `wrangler dev` (`apps/api`, port 8787): the page calls its own origin. `ws`
 * carries the live rooms' sockets (`/api/live/:room`) too. `API_ORIGIN` names another Worker: the
 * e2e preview's is the seeded one on :8788 (playwright.config.ts).
 */
const API_PROXY = {
  // No `changeOrigin`: the live sockets' handshake wants Host to match Origin (the page's own).
  '/api': { target: process.env.API_ORIGIN ?? 'http://localhost:8787', ws: true },
}

/** The build's version stamp, and its release's name from CHANGELOG.md: the version chip's. */
const VERSION = getVersion()

export default defineConfig({
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    // The docs pages: MDX compiles to JSX before React's plugin sees it.
    { enforce: 'pre', ...mdx({ remarkPlugins: REMARK_PLUGINS }) },
    react({ include: /\.(mdx|tsx?|jsx?)$/ }),
    tailwindcss(),
    themeBoot(),
    preloadFonts(),
    inlineStylesheet(),
    // The roster's `.asm` sources and the docs' figures, imported as text.
    textImport((file) => file.endsWith('.svg') && file.startsWith(FIGURES)),
    sitePages(),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(VERSION),
    __APP_RELEASE__: JSON.stringify(releaseOf(VERSION, readReleases())),
    __THEME_SWATCHES__: JSON.stringify(themeSwatches()),
  },
  resolve: {
    // React from the app's own dependencies wherever the importer is: the changelog page is the
    // repository's CHANGELOG.md, and its compiled JSX imports `react/jsx-runtime` from the root.
    dedupe: ['react'],
    alias: WORKSPACE.map((name) => ({
      find: new RegExp(`^@asmbots/${name}$`),
      replacement: `${PACKAGES}${name}/src/index.ts`,
    })),
  },
  worker: { format: 'es' },
  server: { port: 5173, strictPort: true, proxy: API_PROXY },
  preview: { port: 4173, strictPort: true, proxy: API_PROXY },
  build: {
    target: 'es2022',
    // One stylesheet for the app, in index.html (`inlineStylesheet`): no lazy chunk links a sheet.
    cssCodeSplit: false,
    // `dist/.vite/manifest.json`: the chunk graph `scripts/check-bundle.ts` measures each page's
    // cold load by. `public/.assetsignore` keeps it off the deploy.
    manifest: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // The workspace packages go where Rollup puts them (each is `sideEffects: false`), so a
          // page loads only the modules it uses: `/arena`'s shell has no `Battle`, no assembler.
          // CodeMirror and the small packages only it uses: none of it loads before the editor.
          if (
            /[\\/]node_modules[\\/](@codemirror|@lezer|codemirror|@marijn|crelt|style-mod|w3c-keyname)[\\/]/.test(
              id,
            )
          ) {
            return 'editor'
          }
          // The zip codec (share links, the settings page's import and export) rides their chunks.
          if (/[\\/]node_modules[\\/]fflate[\\/]/.test(id)) return undefined
          if (/[\\/]node_modules[\\/]/.test(id)) return 'vendor'
          return undefined
        },
      },
    },
  },
})

/** The docs' figures: the only SVG files read as text (any other SVG stays an asset URL). */
const FIGURES = fileURLToPath(new URL('./src/docs/figures/', import.meta.url))

/** The tokens a theme swatch on `/settings` draws, per theme, from the kit's tokens.css. */
function themeSwatches(): Record<string, Record<string, string>> {
  const rules = parseTokenRules(readFileSync(`${PACKAGES}ui/src/tokens.css`, 'utf8'))
  return Object.fromEntries(
    THEMES.map((theme) => {
      const tokens = themeTokens(rules, theme)
      return [theme, Object.fromEntries(SWATCH_TOKENS.map((token) => [token, tokens[token] ?? '']))]
    }),
  )
}

/**
 * Puts the stored theme on `<html data-theme>` before the first paint (no flash of sentinel on a
 * paper page), and keeps `<meta name="theme-color">` on the theme's `--bg`. The colors come from
 * the kit's tokens.css, so a theme is defined in one place.
 */
function themeBoot(): Plugin {
  const css = readFileSync(`${PACKAGES}ui/src/tokens.css`, 'utf8')
  const rules = parseTokenRules(css)
  const background = Object.fromEntries(
    THEMES.map((theme) => [theme, themeTokens(rules, theme)['--bg'] ?? '#000000']),
  )
  return {
    name: 'asmbots:theme-boot',
    transformIndexHtml: () => [
      { tag: 'script', children: themeBootScript(background), injectTo: 'head' },
    ],
  }
}

/**
 * Preloads the font files of the first paint. The build names them by hash, so the links are
 * written after the bundle exists, with the same URLs the stylesheet asks for.
 */
function preloadFonts(): Plugin {
  return {
    name: 'asmbots:preload-fonts',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, { bundle }) {
        const files = Object.keys(bundle ?? {})
        return PRELOAD_WEIGHTS.flatMap((weight) => {
          const file = files.find((f) => f.includes(`jetbrains-mono-latin-${weight}`))
          if (file === undefined) throw new Error(`no font file for weight ${weight}`)
          return [
            {
              tag: 'link',
              attrs: {
                rel: 'preload',
                href: `/${file}`,
                as: 'font',
                type: 'font/woff2',
                crossorigin: '',
              },
              injectTo: 'head-prepend' as const,
            },
          ]
        })
      },
    },
  }
}

/**
 * Puts the app's stylesheet in index.html as a `<style>`: a linked one blocks the first paint for
 * a round trip after the HTML (Lighthouse's mobile run: FCP 2.3 s linked, 2.1 s inline; `/docs`
 * 94 to 95, then 95). With `cssCodeSplit` off the build writes one stylesheet and no chunk asks
 * for it; the build fails if that ever stops being so.
 */
function inlineStylesheet(): Plugin {
  const LINK = /<link rel="stylesheet" crossorigin href="\/([^"]+\.css)">/g
  return {
    name: 'asmbots:inline-stylesheet',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, { bundle }) {
        const sheets = Object.keys(bundle ?? {}).filter((file) => file.endsWith('.css'))
        if (sheets.length !== 1)
          throw new Error(`one stylesheet expected, got ${sheets.join(', ')}`)
        const inlined = html.replace(LINK, (_tag, file: string) => {
          const asset = bundle?.[file]
          if (asset?.type !== 'asset') throw new Error(`no stylesheet ${file} in the bundle`)
          // Nothing else links it: the file would be an orphan in dist.
          delete bundle?.[file]
          return `<style>${String(asset.source)}</style>`
        })
        if (inlined === html) throw new Error('index.html links no stylesheet to inline')
        return inlined
      },
    },
  }
}

/**
 * The site as crawlers and link previews read it (`src/app/pages.ts`): the pages manifest the
 * Worker writes each page's head from (`/meta/pages.json`), the sitemap, and `robots.txt`, all
 * written at build; and the home page's head tags in index.html, for a host that serves it as it
 * is. The Worker swaps those for each page's own.
 */
function sitePages(): Plugin {
  const manifest = pageManifest()
  return {
    name: 'asmbots:site-pages',
    transformIndexHtml: (html) =>
      html.replace('</head>', `${defaultHeadTags(SITE_URL, manifest)}\n  </head>`),
    generateBundle() {
      const emit = (fileName: string, source: string) =>
        this.emitFile({ type: 'asset', fileName, source })
      emit(PAGES_MANIFEST.slice(1), `${JSON.stringify(manifest)}\n`)
      emit('sitemap.xml', sitemap(SITE_URL, manifest))
      emit('robots.txt', robotsTxt(SITE_URL))
    },
  }
}
