/**
 * The debugged bot as it lies in the core: where each source line's bytes went, and where its
 * labels are. The editor maps its lines to addresses with it (the IP line, the breakpoint dots),
 * and the memory panel names addresses with it. Addresses are absolute: the bot's base plus the
 * listing's offsets, wrapping at 64 KB.
 */
import { type Assembled, parse, tokenize } from '@asmbots/asm'

/** A source line with bytes: its line number, and the address and length of its bytes. */
export interface LineBytes {
  /** 1-based. */
  readonly lineNo: number
  readonly addr: number
  readonly length: number
}

/** The bot in the core. */
export interface BotImage {
  readonly base: number
  readonly size: number
  /** The lines with bytes, in source order. */
  readonly lines: readonly LineBytes[]
  /** Each label's address; a `.local` label by its full name (`start.here`). No `equ`. */
  readonly labels: ReadonlyMap<string, number>
  /** The first label at each address. */
  readonly names: ReadonlyMap<number, string>
}

/** `assembled`, the bot of `source`, loaded at `base`. `assembled` has no errors. */
export function botImage(source: string, assembled: Assembled, base: number): BotImage {
  const lines = assembled.listing
    .filter((line) => line.bytes.length > 0)
    .map((line) => ({
      lineNo: line.lineNo,
      addr: (base + line.address) & 0xffff,
      length: line.bytes.length,
    }))
  // The names the source gives its labels: `symbols` holds the `equ` values too.
  const labels = new Map<string, number>()
  const names = new Map<number, string>()
  for (const line of parse(tokenize(source)).lines) {
    if (line.kind === 'equ' || line.label === undefined) continue
    const offset = assembled.symbols.get(line.label.name)
    if (offset === undefined || labels.has(line.label.name)) continue
    const addr = (base + offset) & 0xffff
    labels.set(line.label.name, addr)
    if (!names.has(addr)) names.set(addr, line.label.name)
  }
  return { base, size: assembled.bytes.length, lines, labels, names }
}

/** Whether `addr` is one of the image's bytes. */
export function inImage(image: BotImage, addr: number): boolean {
  return ((addr - image.base) & 0xffff) < image.size
}

/** A label as a listing shows it: a `.local` one by its own part, `.here`. */
export function shortLabel(name: string): string {
  const dot = name.indexOf('.', 1)
  return dot > 0 && !name.startsWith('..') ? name.slice(dot) : name
}

/** `addr` as a label and an offset, `lap+3`, from the nearest label at or before it in `image`. */
export function labelOf(image: BotImage, addr: number): string | null {
  if (!inImage(image, addr)) return null
  let best: string | null = null
  let bestOffset = Number.POSITIVE_INFINITY
  for (const [name, at] of image.labels) {
    const offset = (addr - at) & 0xffff
    // A label past `addr` wraps to an offset past the image.
    if (offset < bestOffset && offset < image.size && inImage(image, at)) {
      best = name
      bestOffset = offset
    }
  }
  if (best === null) return null
  return bestOffset === 0 ? best : `${best}+${bestOffset}`
}
