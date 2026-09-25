/**
 * Text imports for Vite: the roster's sources (`import dwarf from '../roster/dwarf.asm' with {
 * type: 'text' }`, the way Bun reads them) and the docs' figures. Browsers take only the `json`
 * and `css` import types, and Rollup would parse the file as JavaScript: the plugin drops the
 * attribute from the importer and makes each such file a module whose default export is its text.
 * The web app's build and the API's Vitest pool (workerd) both load the roster through it.
 */
import { readFileSync } from 'node:fs'

/**
 * A text import's attribute, after the specifier: `from './dwarf.asm' with { type: 'text' }`, or
 * a docs figure's `from './modrm.svg' with { type: 'text' }`.
 */
const TEXT_IMPORT =
  /(from\s*(['"])[^'"]+\.(?:asm|svg)\2)\s*with\s*\{\s*type\s*:\s*(['"])text\3\s*\}/g

/**
 * The plugin. `isText` says which other files (by path) are text: an `.asm` file always is. Vite
 * adds `?import` to a file it does not know as code, so the path is the id before any `?`.
 */
export function textImport(isText: (file: string) => boolean = () => false) {
  const textFile = (id: string): string | null => {
    const file = id.split('?')[0] ?? id
    return file.endsWith('.asm') || isText(file) ? file : null
  }
  return {
    name: 'asmbots:text-import',
    enforce: 'pre' as const,
    load(id: string) {
      const file = textFile(id)
      if (file === null) return null
      return { code: `export default ${JSON.stringify(readFileSync(file, 'utf8'))}`, map: null }
    },
    transform(code: string, id: string) {
      if (textFile(id) !== null || !/\.(asm|svg)['"]/.test(code)) return null
      const stripped = code.replace(TEXT_IMPORT, '$1')
      return stripped === code ? null : { code: stripped, map: null }
    },
  }
}
