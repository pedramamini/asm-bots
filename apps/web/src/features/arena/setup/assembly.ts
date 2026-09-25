/**
 * The assembler for the bots the arena does not have prebuilt: local bots, a share link's, a
 * pasted source, and dropped files. A chunk of its own with `@asmbots/asm`: a setup of roster
 * bots never loads it (`assembler.ts`), and the editor and tournaments import it.
 */
import { type Assembled, assemble } from '@asmbots/asm'

/** Assemblies by source text, the newest last. The same source is the same bot. */
const assemblies = new Map<string, Assembled>()
const MAX_ASSEMBLIES = 64

/** `assemble(source)`, from the cache when the text was seen before. Do not change what it holds. */
export function assembleCached(source: string): Assembled {
  let assembled = assemblies.get(source)
  if (assembled === undefined) {
    assembled = assemble(source)
    assemblies.set(source, assembled)
    if (assemblies.size > MAX_ASSEMBLIES) assemblies.delete(assemblies.keys().next().value ?? '')
  }
  return assembled
}

/** The largest file the setup reads as a bot source. */
export const MAX_SOURCE_BYTES = 64 * 1024

/** A dropped or picked file, read and assembled, or the reason it was not. */
export interface BotFile {
  /** The file's name. */
  readonly file: string
  readonly source: string
  /** Null when the file was not read: see `problem`. */
  readonly assembled: Assembled | null
  /** Why the file was not read: not an `.asm` file, or too big. */
  readonly problem: string | null
}

/** Reads and assembles each file (PRODUCT_SPEC §2: the drop zone takes `.asm` files, many). */
export function readBotFiles(files: readonly File[]): Promise<BotFile[]> {
  return Promise.all(
    files.map(async (file): Promise<BotFile> => {
      if (!/\.asm$/i.test(file.name)) {
        return { file: file.name, source: '', assembled: null, problem: 'not an .asm file' }
      }
      if (file.size > MAX_SOURCE_BYTES) {
        const kb = Math.ceil(file.size / 1024)
        const problem = `${kb} KB: a bot source is at most ${MAX_SOURCE_BYTES / 1024} KB`
        return { file: file.name, source: '', assembled: null, problem }
      }
      let source: string
      try {
        source = await file.text()
      } catch {
        // A folder dropped under an `.asm` name, or a file the browser may not read.
        return { file: file.name, source: '', assembled: null, problem: 'could not read the file' }
      }
      return { file: file.name, source, assembled: assembleCached(source), problem: null }
    }),
  )
}

/** Whether a read file makes a bot: read, and assembled with no error. */
export function fileAssembles(file: BotFile): file is BotFile & { assembled: Assembled } {
  return file.assembled !== null && !file.assembled.diagnostics.some((d) => d.severity === 'error')
}
