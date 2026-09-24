/**
 * Canonical JSON: each object's keys sorted by code unit, no whitespace, and `undefined` fields
 * left out as `JSON.stringify` leaves them. Two values that differ only in the order of their
 * fields give the same text, so its hash names the value (`replayKey`).
 */
export function canonicalJson(value: unknown): string {
  return write(value) ?? 'null'
}

function write(value: unknown): string | undefined {
  if (Array.isArray(value)) return `[${value.map((item) => write(item) ?? 'null').join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const o = value as Record<string, unknown>
    const fields: string[] = []
    for (const key of Object.keys(o).sort()) {
      const text = write(o[key])
      if (text !== undefined) fields.push(`${JSON.stringify(key)}:${text}`)
    }
    return `{${fields.join(',')}}`
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return 'null'
  if (typeof value === 'bigint') throw new TypeError('canonicalJson: a bigint has no JSON')
  return JSON.stringify(value)
}
