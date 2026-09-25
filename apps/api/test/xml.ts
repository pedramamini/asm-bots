import { SaxesParser } from 'saxes'

/** Parses `xml` strictly: throws at the first thing that is not well formed. Returns the root. */
export function wellFormed(xml: string): string {
  const parser = new SaxesParser()
  let root = ''
  parser.on('opentag', (tag) => {
    if (root === '') root = tag.name
  })
  parser.write(xml).close()
  return root
}

/** Whether `bytes` are a PNG, and its size from its header (IHDR), px. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length < 24 || signature.some((b, i) => bytes[i] !== b)) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}
