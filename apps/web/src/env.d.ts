/** The app's version (`scripts/version.ts`: `2026.09.23a`), set by Vite's `define`. */
declare const __APP_VERSION__: string

/**
 * The version's release in CHANGELOG.md (`scripts/changelog.ts` `releaseOf`): its name, and whether
 * the build is that release. Set by Vite's `define`.
 */
declare const __APP_RELEASE__: { readonly name: string | null; readonly released: boolean }

/** Each theme's swatch tokens (`--bg`, `--panel`, `--accent` …) from tokens.css, set by Vite's `define`. */
declare const __THEME_SWATCHES__: Record<string, Record<string, string>>
