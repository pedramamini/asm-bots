/**
 * The files the battle saves: a screenshot, `asmbots-dwarf-imp-1-3527.png`, and a replay,
 * `asmbots-dwarf-imp-1.asmreplay.json`. Their names say the bots, the seed, and the cycle.
 */

/** Past this many bots, a file names them by count: `asmbots-8-bots-7`. */
const NAMED_BOTS = 3

/** A name as a file name's part: lowercase letters, digits, and single dashes. */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** `asmbots-dwarf-imp-1`: the bots (or their count) and the seed. */
export function fileStem(names: readonly string[], seed: number): string {
  const bots =
    names.length > NAMED_BOTS
      ? `${names.length}-bots`
      : names.map((name) => slug(name) || 'bot').join('-')
  return `asmbots-${bots}-${seed}`
}

/** The screenshot's name (`s`): `asmbots-<bots>-<seed>-<cycle>.png`. */
export function screenshotName(names: readonly string[], seed: number, cycle: number): string {
  return `${fileStem(names, seed)}-${cycle}.png`
}

/** The replay's name (`download replay`): `asmbots-<bots>-<seed>.asmreplay.json`. */
export function replayName(names: readonly string[], seed: number): string {
  return `${fileStem(names, seed)}.asmreplay.json`
}

/** Saves `blob` as a download named `name`. */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()
  // After the click has started the download.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
