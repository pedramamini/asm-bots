/**
 * The docs' figures by name, for `<Fig src="…">`: each an SVG file of this folder, as text. Bun
 * reads a text import itself; `vite.config.ts`'s `textImport` does it for the build. A figure
 * colors itself with the kit's CSS variables, so it follows the theme.
 */
import modrm from './modrm.svg' with { type: 'text' }

export const FIGURES: Readonly<Record<string, string>> = { modrm }
