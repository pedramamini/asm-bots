import { brotliDecompressSync } from 'node:zlib'

/** WOFF2 known table tags by index (WOFF2 §5.1), as far as a TrueType font needs them. */
const KNOWN_TAGS = [
  'cmap',
  'head',
  'hhea',
  'hmtx',
  'maxp',
  'name',
  'OS/2',
  'post',
  'cvt ',
  'fpgm',
  'glyf',
  'loca',
  'prep',
  'CFF ',
  'VORG',
  'EBDT',
  'EBLC',
  'gasp',
  'hdmx',
  'kern',
  'LTSH',
  'PCLT',
  'VDMX',
  'vhea',
  'vmtx',
  'BASE',
  'GDEF',
  'GPOS',
  'GSUB',
]

/** What the tests read out of a WOFF2 file. */
export interface Woff2Font {
  /** OS/2 usWeightClass: 300 for Light … 700 for Bold. */
  readonly weight: number
  /** Every code point the cmap maps to a glyph. */
  readonly codePoints: ReadonlySet<number>
  /** The GSUB feature tags, such as `zero` or `calt`. */
  readonly features: ReadonlySet<string>
}

/** Reads a single-font WOFF2 file far enough to check its weight, glyphs, and features. */
export function readWoff2(bytes: Uint8Array): Woff2Font {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const signature = String.fromCharCode(...bytes.subarray(0, 4))
  if (signature !== 'wOF2') throw new Error(`not a WOFF2 file: ${signature}`)
  const numTables = view.getUint16(12)
  const compressedSize = view.getUint32(20)

  let pos = 48
  const base128 = () => {
    let value = 0
    for (let i = 0; i < 5; i++) {
      const byte = bytes[pos++] as number
      value = value * 128 + (byte & 0x7f)
      if ((byte & 0x80) === 0) return value
    }
    throw new Error('bad UIntBase128')
  }
  const directory: { tag: string; length: number; transformed: boolean }[] = []
  for (let i = 0; i < numTables; i++) {
    const flags = bytes[pos++] as number
    const index = flags & 0x3f
    let tag = KNOWN_TAGS[index] ?? `#${index}`
    if (index === 63) {
      tag = String.fromCharCode(...bytes.subarray(pos, pos + 4))
      pos += 4
    }
    const version = flags >> 6
    // glyf and loca are transformed unless the version is 3; any other table unless it is 0.
    const transformed = tag === 'glyf' || tag === 'loca' ? version !== 3 : version !== 0
    const origLength = base128()
    const length = transformed ? base128() : origLength
    directory.push({ tag, length, transformed })
  }

  const data = brotliDecompressSync(bytes.subarray(pos, pos + compressedSize))
  const tables = new Map<string, DataView>()
  let offset = 0
  for (const { tag, length, transformed } of directory) {
    if (!transformed) tables.set(tag, new DataView(data.buffer, data.byteOffset + offset, length))
    offset += length
  }
  const table = (tag: string) => {
    const t = tables.get(tag)
    if (t === undefined) throw new Error(`no ${tag} table`)
    return t
  }
  return {
    weight: table('OS/2').getUint16(4),
    codePoints: cmapCodePoints(table('cmap')),
    features: gsubFeatures(table('GSUB')),
  }
}

/** The code points of the Windows Unicode cmap subtable: format 12 if present, else format 4. */
function cmapCodePoints(cmap: DataView): Set<number> {
  const out = new Set<number>()
  const subtables = new Map<string, number>()
  for (let i = 0; i < cmap.getUint16(2); i++) {
    const record = 4 + i * 8
    const key = `${cmap.getUint16(record)}/${cmap.getUint16(record + 2)}`
    subtables.set(key, cmap.getUint32(record + 4))
  }
  const full = subtables.get('3/10')
  if (full !== undefined && cmap.getUint16(full) === 12) {
    for (let g = 0; g < cmap.getUint32(full + 12); g++) {
      const group = full + 16 + g * 12
      const start = cmap.getUint32(group)
      const end = cmap.getUint32(group + 4)
      const glyph = cmap.getUint32(group + 8)
      for (let c = start; c <= end; c++) if (glyph !== 0 || c !== start) out.add(c)
    }
    return out
  }
  const bmp = subtables.get('3/1') ?? subtables.get('0/3')
  if (bmp === undefined || cmap.getUint16(bmp) !== 4) throw new Error('no format 4 cmap')
  const segments = cmap.getUint16(bmp + 6) / 2
  const ends = bmp + 14
  const starts = ends + segments * 2 + 2
  const deltas = starts + segments * 2
  const rangeOffsets = deltas + segments * 2
  for (let s = 0; s < segments; s++) {
    const start = cmap.getUint16(starts + s * 2)
    const end = cmap.getUint16(ends + s * 2)
    const delta = cmap.getUint16(deltas + s * 2)
    const rangeOffset = cmap.getUint16(rangeOffsets + s * 2)
    for (let c = start; c <= end && c !== 0xffff; c++) {
      let glyph: number
      if (rangeOffset === 0) glyph = (c + delta) & 0xffff
      else {
        glyph = cmap.getUint16(rangeOffsets + s * 2 + rangeOffset + (c - start) * 2)
        if (glyph !== 0) glyph = (glyph + delta) & 0xffff
      }
      if (glyph !== 0) out.add(c)
    }
  }
  return out
}

/** The feature tags in a GSUB table's feature list. */
function gsubFeatures(gsub: DataView): Set<string> {
  const list = gsub.getUint16(6)
  const out = new Set<string>()
  for (let i = 0; i < gsub.getUint16(list); i++) {
    const record = list + 2 + i * 6
    out.add(String.fromCharCode(...[0, 1, 2, 3].map((d) => gsub.getUint8(record + d))))
  }
  return out
}
