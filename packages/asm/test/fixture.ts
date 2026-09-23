import { expect } from 'bun:test'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'

/**
 * Fixture files are the expected results of tests. After a deliberate change, regenerate them
 * with `UPDATE_FIXTURES=1 bun test packages/asm` and review the diff.
 */
export const UPDATE = process.env.UPDATE_FIXTURES === '1'

/** The `.asm` files in `dir`, or under it with `recursive`, as paths relative to it, sorted. */
export const asmFiles = (dir: string, recursive = false) =>
  readdirSync(dir, { recursive, encoding: 'utf8' })
    .filter((f) => f.endsWith('.asm'))
    .sort()

/** JSON on one line, spaced like the formatter spaces it. */
function inline(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(inline).join(', ')}]`
  if (typeof v === 'object' && v !== null) {
    const fields = Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`)
    return fields.length === 0 ? '{}' : `{ ${fields.join(', ')} }`
  }
  return JSON.stringify(v)
}

/** JSON with each object or array on one line when it fits in 100 columns. */
function pretty(v: unknown, indent = '', used = 0): string {
  const flat = inline(v)
  if (typeof v !== 'object' || v === null || indent.length + used + flat.length <= 100) return flat
  const inner = `${indent}  `
  const items = Array.isArray(v)
    ? v.map((x) => inner + pretty(x, inner))
    : Object.entries(v).map(([k, x]) => {
        const key = `${JSON.stringify(k)}: `
        return inner + key + pretty(x, inner, key.length)
      })
  const [open, close] = Array.isArray(v) ? ['[', ']'] : ['{', '}']
  return `${open}\n${items.join(',\n')}\n${indent}${close}`
}

/** Compares `actual` with the JSON file, or writes the file when updating. */
export function expectFixture(file: string, actual: unknown) {
  if (UPDATE) writeFileSync(file, `${pretty(actual)}\n`)
  expect(actual).toEqual(JSON.parse(readFileSync(file, 'utf8')))
}
