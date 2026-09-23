import {
  DEFAULT_THEME,
  LIGHT_THEME,
  THEME_STORAGE_KEY,
  THEMES,
  type Theme,
} from '@asmbots/ui/themes'

/** What the boot script needs to know: the themes, and the `--bg` of each for theme-color. */
export interface ThemeBootConfig {
  readonly themes: readonly string[]
  readonly fallback: string
  readonly light: string
  readonly key: string
  readonly background: Readonly<Record<string, string>>
}

/**
 * The inline script of index.html: `initTheme()` before the first paint, with no imports, so
 * it runs before the bundle. It also keeps
 * `<meta name="theme-color">` on the theme's `--bg` whenever `<html data-theme>` changes.
 */
export function themeBootScript(background: Readonly<Record<Theme, string>>): string {
  const config: ThemeBootConfig = {
    themes: THEMES,
    fallback: DEFAULT_THEME,
    light: LIGHT_THEME,
    key: THEME_STORAGE_KEY,
    background,
  }
  return `(${bootTheme.toString()})(${JSON.stringify(config)})`
}

/** The script's body. Self-contained: it is serialized with `toString()`. */
export function bootTheme(config: ThemeBootConfig): void {
  const root = document.documentElement
  let theme: string | null = null
  try {
    theme = localStorage.getItem(config.key)
  } catch {
    // Storage is off: follow the system.
  }
  if (theme === null || config.themes.indexOf(theme) < 0) {
    const light =
      typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches
    theme = light ? config.light : config.fallback
  }
  root.setAttribute('data-theme', theme)
  const sync = () => {
    const color = config.background[root.getAttribute('data-theme') ?? '']
    const meta = document.querySelector('meta[name="theme-color"]')
    if (color !== undefined && meta !== null) meta.setAttribute('content', color)
  }
  sync()
  new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ['data-theme'] })
}
