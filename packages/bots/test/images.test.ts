import { describe, expect, it } from 'bun:test'
import { ROSTER_IMAGE_DATA } from '../src/images.gen'
import { loadRoster, ROSTER, rosterImage, rosterSource } from '../src/index'

/** The roster bot of `slug`, assembled from its source. */
function assembled(slug: string) {
  const bot = loadRoster().get(slug)
  if (bot === undefined) throw new Error(`loadRoster has no bot '${slug}'`)
  return bot
}

describe('roster images', () => {
  it('hold every roster bot and no other', () => {
    expect(Object.keys(ROSTER_IMAGE_DATA).sort()).toEqual(ROSTER.map((e) => e.slug).sort())
  })

  for (const { slug } of ROSTER) {
    it(`${slug}: is what its source assembles to (else run \`bun run roster-images\`)`, () => {
      const { name, author, strategy, version, bytes } = assembled(slug).assembled
      const image = rosterImage(slug)
      expect({ ...image, bytes: [...image.bytes] }).toEqual({
        name,
        author,
        strategy,
        version,
        bytes: [...bytes],
      })
    })
  }

  it('decodes a bot once and shares it', () => {
    expect(rosterImage('dwarf')).toBe(rosterImage('dwarf'))
    expect(rosterImage('dwarf').bytes).toBeInstanceOf(Uint8Array)
  })

  it('throws for a slug the roster does not have', () => {
    expect(() => rosterImage('nobody')).toThrow("the roster has no bot 'nobody'")
  })
})

describe('roster sources', () => {
  it('are the texts loadRoster assembles', () => {
    for (const { slug } of ROSTER) expect(rosterSource(slug)).toBe(assembled(slug).source)
  })

  it('throw for a slug the roster does not have', () => {
    expect(() => rosterSource('nobody')).toThrow("the roster has no bot 'nobody'")
  })
})
