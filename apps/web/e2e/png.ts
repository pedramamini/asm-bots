/**
 * Just enough PNG for the specs to read a screenshot's pixels: 8-bit RGB or RGBA, not interlaced,
 * which is what Chromium's screenshots are. No dependency: `node:zlib` inflates, and the five
 * scanline filters are undone here.
 */
import { inflateSync } from 'node:zlib'

/** A decoded image: `width` × `height` pixels, 4 bytes each (RGBA), row by row. */
export interface Pixels {
  readonly width: number
  readonly height: number
  readonly data: Uint8Array
}

export function decodePng(png: Uint8Array): Pixels {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  let width = 0
  let height = 0
  let channels = 0
  const idat: Uint8Array[] = []
  for (let at = 8; at < png.length; ) {
    const length = view.getUint32(at)
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8))
    const body = png.subarray(at + 8, at + 8 + length)
    if (type === 'IHDR') {
      const head = new DataView(body.buffer, body.byteOffset, body.byteLength)
      width = head.getUint32(0)
      height = head.getUint32(4)
      const [depth, color, , , interlace] = body.subarray(8, 13)
      if (depth !== 8 || interlace !== 0 || (color !== 2 && color !== 6)) {
        throw new Error(`png: only 8-bit RGB(A), not interlaced (depth ${depth}, color ${color})`)
      }
      channels = color === 6 ? 4 : 3
    } else if (type === 'IDAT') idat.push(body)
    else if (type === 'IEND') break
    at += 12 + length
  }
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const rows = new Uint8Array(height * stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] as number
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const out = rows.subarray(y * stride, (y + 1) * stride)
    const up = y > 0 ? rows.subarray((y - 1) * stride, y * stride) : null
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? (out[i - channels] as number) : 0
      const b = up === null ? 0 : (up[i] as number)
      const c = up !== null && i >= channels ? (up[i - channels] as number) : 0
      const x = line[i] as number
      let v = x
      if (filter === 1) v = x + a
      else if (filter === 2) v = x + b
      else if (filter === 3) v = x + ((a + b) >> 1)
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
      }
      out[i] = v & 0xff
    }
  }
  const data = new Uint8Array(width * height * 4)
  for (let p = 0; p < width * height; p++) {
    data.set(rows.subarray(p * channels, p * channels + 3), p * 4)
    data[p * 4 + 3] = channels === 4 ? (rows[p * channels + 3] as number) : 255
  }
  return { width, height, data }
}

/** WCAG 2 contrast of two opaque pixels given as RGB bytes. */
export function pixelContrast(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const luminance = (c: ArrayLike<number>) => {
    const lin = (v: number) => {
      const s = v / 255
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }
    return (
      0.2126 * lin(c[0] as number) + 0.7152 * lin(c[1] as number) + 0.0722 * lin(c[2] as number)
    )
  }
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/**
 * The pixels that differ between two shots of one clip by at least `ratio`:1 of contrast (WCAG
 * 2.4.13 measures a focus indicator this way: the same pixels, focused and not).
 */
export function changedPixels(focused: Pixels, blurred: Pixels, ratio = 3): number {
  if (focused.width !== blurred.width || focused.height !== blurred.height) {
    throw new Error('changedPixels: the two shots differ in size')
  }
  let n = 0
  for (let p = 0; p < focused.width * focused.height; p++) {
    const a = focused.data.subarray(p * 4, p * 4 + 3)
    const b = blurred.data.subarray(p * 4, p * 4 + 3)
    if (pixelContrast(a, b) >= ratio) n++
  }
  return n
}
