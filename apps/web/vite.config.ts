import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { THEMES } from '@asmbots/ui/themes'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
// The token parser alone: the kit's index would pull React into the config.
import { parseTokenRules, themeTokens } from '../../packages/ui/src/css-tokens'
import { themeBootScript } from './src/app/theme-boot'

const PACKAGES = fileURLToPath(new URL('../../packages/', import.meta.url))

/** The workspace packages the app imports by name, each to its source entry (no build step). */
const WORKSPACE = ['asm', 'bots', 'codec', 'engine', 'protocol', 'tourney'] as const

/** The weights of the first paint: body and data (400), ticker, brand, and nav (500). */
const PRELOAD_WEIGHTS = [400, 500] as const

export default defineConfig({
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    themeBoot(),
    preloadFonts(),
  ],
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
          if (/[\\/]node_modules[\\/](@codemirror|@lezer|codemirror)[\\/]/.test(id)) return 'editor'
          if (/[\\/]node_modules[\\/]/.test(id)) return 'vendor'
          return undefined
        },
      },
    },
  },
})

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
