import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compile } from 'tailwindcss'

export const SRC = fileURLToPath(new URL('../src/', import.meta.url))

/** Compiles src/tailwind.css as the app's build does, loading each `@import` from disk. */
export async function compileKit() {
  const entry = resolve(SRC, 'tailwind.css')
  return compile(await readFile(entry, 'utf8'), {
    base: SRC,
    from: entry,
    async loadStylesheet(id, base) {
      const path =
        id === 'tailwindcss' ? Bun.resolveSync('tailwindcss/index.css', base) : resolve(base, id)
      return { path, base: dirname(path), content: await readFile(path, 'utf8') }
    },
  })
}

/** The declarations of the first rule for `selector` in `css`, or null when there is none. */
export function rule(css: string, selector: string): Record<string, string> | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  const body = new RegExp(`(?:^|\\n)\\s*${escaped} \\{([^{}]*)\\}`).exec(css)?.[1]
  if (body === undefined) return null
  return Object.fromEntries(
    body
      .split(';')
      .map((d) => d.trim())
      .filter((d) => d !== '')
      .map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()]),
  )
}

/**
 * Classes with no rule of their own: a group marker names a parent for `group-*` variants, and
 * lucide names its icons (`lucide lucide-play`).
 */
export const MARKER = /^(group(\/[\w-]+)?|lucide(-[\w-]+)?)$/

/** True when `css` has a rule for the class `name`: its escaped selector, and no more name after. */
export function hasRule(css: string, name: string): boolean {
  const selector = `.${name.replace(/[^\w-]/g, (ch) => `\\${ch}`)}`
  return new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(?![\\w\\\\-])`).test(css)
}
