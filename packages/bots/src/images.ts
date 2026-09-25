/**
 * The roster, prebuilt: each bot's machine code and metadata as `bun run roster-images` wrote them
 * from its assembly (`images.gen.ts`). A page that fights the roster reads these, and loads
 * neither the assembler nor the sources; `test/images.test.ts` keeps them what `loadRoster`
 * assembles.
 */
import { ROSTER_IMAGE_DATA } from './images.gen'

/** What a roster bot assembles to: its `%name`, `%author`, `%strategy`, `%version`, and bytes. */
export interface RosterImage {
  readonly name: string
  readonly author: string
  readonly strategy: string
  readonly version: string
  readonly bytes: Uint8Array
}

const decoded = new Map<string, RosterImage>()

/**
 * Roster bot `slug`'s image, decoded on the first call and shared after it, so do not change what
 * it holds. Throws for a slug the roster does not have.
 */
export function rosterImage(slug: string): RosterImage {
  let image = decoded.get(slug)
  if (image === undefined) {
    const data = ROSTER_IMAGE_DATA[slug]
    if (data === undefined) throw new Error(`the roster has no bot '${slug}'`)
    image = { ...data, bytes: Uint8Array.from(atob(data.bytes), (c) => c.charCodeAt(0)) }
    decoded.set(slug, image)
  }
  return image
}
