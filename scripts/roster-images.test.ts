import { afterAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IMAGES_FILE, imagesModule, literal, rosterImages } from './roster-images'

const DIR = mkdtempSync(join(tmpdir(), 'asmbots-roster-images-'))
afterAll(() => rmSync(DIR, { recursive: true, force: true }))

describe('roster-images: the file', () => {
  it('is what the generator writes: run `bun run roster-images` after changing a roster bot', () => {
    expect(readFileSync(IMAGES_FILE, 'utf8')).toBe(imagesModule())
  })

  it('says so from the command line with --check', () => {
    const run = Bun.spawnSync(['bun', 'scripts/roster-images.ts', '--check'], {
      cwd: `${import.meta.dir}/..`,
    })
    expect(run.stdout.toString()).toBe('packages/bots/src/images.gen.ts is up to date\n')
    expect(run.exitCode).toBe(0)
  })
})

describe('roster-images: check and write', () => {
  it('finds a stale file, names the fix, and leaves it', () => {
    const file = join(DIR, 'stale.ts')
    writeFileSync(file, 'export const ROSTER_IMAGE_DATA = {}\n')
    const lines: string[] = []
    expect(rosterImages(true, (line) => lines.push(line), file)).toBe(1)
    expect(lines).toEqual([expect.stringContaining('is stale: run `bun run roster-images`')])
    expect(readFileSync(file, 'utf8')).toBe('export const ROSTER_IMAGE_DATA = {}\n')
  })

  it('writes the module, which a check then passes', () => {
    const file = join(DIR, 'fresh.ts')
    const lines: string[] = []
    expect(rosterImages(false, (line) => lines.push(line), file)).toBe(0)
    expect(lines).toEqual([expect.stringMatching(/fresh\.ts: 22 bots$/)])
    expect(readFileSync(file, 'utf8')).toBe(imagesModule())
    expect(rosterImages(true, () => {}, file)).toBe(0)
  })

  it('rejects any other argument', () => {
    const run = Bun.spawnSync(['bun', 'scripts/roster-images.ts', '--update'], {
      cwd: `${import.meta.dir}/..`,
    })
    expect(run.stderr.toString()).toContain('usage: bun run roster-images [--check]')
    expect(run.exitCode).toBe(2)
  })
})

describe('roster-images: literals', () => {
  it('quotes as Biome does: single quotes, unless the text holds more of them', () => {
    expect(literal('Imp')).toBe("'Imp'")
    expect(literal("the dwarf's bombs")).toBe(`"the dwarf's bombs"`)
    expect(literal(`say "hi" and 'bye'`)).toBe(`'say "hi" and \\'bye\\''`)
    expect(literal('a\\b')).toBe("'a\\\\b'")
  })

  it('reads back as the text it quotes, in a module as the generated one is', async () => {
    const texts = ['Imp', "it's", `"quoted" 'both'`, 'back\\slash', '6AAAW4Pr+/==']
    const file = join(DIR, 'literals.ts')
    writeFileSync(file, `export default [${texts.map(literal).join(', ')}]\n`)
    expect((await import(file)).default).toEqual(texts)
  })
})
