import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { THEMES } from '@asmbots/ui/themes'
import mdx from '@mdx-js/rollup'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
// The token parser alone: the kit's index would pull React into the config.
import { parseTokenRules, themeTokens } from '../../packages/ui/src/css-tokens'
import { getVersion } from '../../scripts/version'
import { themeBootScript } from './src/app/theme-boot'

const PACKAGES = fileURLToPath(new URL('../../packages/', import.meta.url))

/** The workspace packages the app imports by name, each to its source entry (no build step). */
const WORKSPACE = ['asm', 'bots', 'codec', 'engine', 'protocol', 'tourney'] as const

/** The weights of the first paint: body and data (400), ticker, brand, and nav (500). */
const PRELOAD_WEIGHTS = [400, 500] as const

/** The tokens of a theme swatch: its surfaces, a hairline, its text, and its accent. */
const SWATCH_TOKENS = ['--bg', '--panel', '--border', '--text', '--text-muted', '--accent'] as const

export default defineConfig({
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    // The docs pages: MDX compiles to JSX before React's plugin sees it.
    { enforce: 'pre', ...mdx() },
    react({ include: /\.(mdx|tsx?|jsx?)$/ }),
    tailwindcss(),
    themeBoot(),
    preloadFonts(),
    asmText(),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(getVersion()),
    __THEME_SWATCHES__: JSON.stringify(themeSwatches()),
  },
  resolve: {
    alias: WORKSPACE.map((name) => ({
      find: new RegExp(`^@asmbots/${name}$`),
      replacement: `${PACKAGES}${name}/src/index.ts`,
    })),
  },
  worker: { format: 'es' },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (/[\\/]packages[\\/](engine|codec)[\\/]/.test(id)) return 'engine'
          // CodeMirror and the small packages only it uses: none of it loads before the editor.
          if (
            /[\\/]node_modules[\\/](@codemirror|@lezer|codemirror|@marijn|crelt|style-mod|w3c-keyname)[\\/]/.test(
              id,
            )
          ) {
            return 'editor'
          }
          // The zip codec serves only the settings page's import and export: it rides that chunk.
          if (/[\\/]node_modules[\\/]fflate[\\/]/.test(id)) return undefined
          if (/[\\/]node_modules[\\/]/.test(id)) return 'vendor'
          return undefined
        },
      },
    },
  },
})

/** An `.asm` import's text attribute, after the specifier: `from './dwarf.asm' with { type: 'text' }`. */
const ASM_TEXT_IMPORT = /(from\s*(['"])[^'"]+\.asm\2)\s*with\s*\{\s*type\s*:\s*(['"])text\3\s*\}/g

/**
 * The roster's sources, imported as text (`import dwarf from '../roster/dwarf.asm' with { type:
 * 'text' }`) the way Bun reads them. Browsers take only the `json` and `css` import types, and
 * Rollup would parse the file as JavaScript: this drops the attribute from the importer and makes
 * each `.asm` file a module whose default export is its text.
 */
function asmText(): Plugin {
  return {
    name: 'asmbots:asm-text',
    enforce: 'pre',
    load(id) {
      const file = asmFile(id)
      if (file === null) return null
      return { code: `export default ${JSON.stringify(readFileSync(file, 'utf8'))}`, map: null }
    },
    transform(code, id) {
      if (asmFile(id) !== null || !code.includes('.asm')) return null
      const stripped = code.replace(ASM_TEXT_IMPORT, '$1')
      return stripped === code ? null : { code: stripped, map: null }
    },
  }
}

/** The path of an `.asm` module id, or null. Vite adds `?import` to a file it does not know as code. */
function asmFile(id: string): string | null {
  const file = id.split('?')[0] ?? id
  return file.endsWith('.asm') ? file : null
}

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
