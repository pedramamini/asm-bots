/**
 * The bots the arena setup offers and fights (PRODUCT_SPEC §2): the roster, the local bots, the
 * bots a share link carries, and dropped `.asm` files, each assembled on the main thread (the
 * whole roster takes about 10 ms). The selection is a list of refs; `resolveSelection` turns it
 * into bots, and `arenaBots` into what the Worker loads.
 */
import { type Assembled, assemble, type Diag } from '@asmbots/asm'
import { loadRoster, ROSTER, type RosterEntry } from '@asmbots/bots'
import { type BattleConfigInput, Pcg32, PlacementError, place } from '@asmbots/engine'
import { roundOrder, roundSeed } from '@asmbots/tourney'
import type { LocalBot } from '../../../store/local-bots'
import type { ArenaBot } from '../worker/protocol'
import { battleConfig, MIN_ARENA_BOTS, randomSeed } from './config'
import { type ArenaSetupSpec, type BotRef, formatRef, type SharedBot } from './url'

/** Where a bot comes from: the roster, this browser's store, or a share link. */
export type BotOrigin = 'roster' | 'local' | 'shared'

/** A bot the setup can show and fight. */
export interface CatalogBot {
  readonly ref: BotRef
  readonly origin: BotOrigin
  /** The `%name`, or the stored name of a local bot whose source does not assemble. */
  readonly name: string
  readonly author: string
  readonly source: string
  readonly assembled: Assembled
  /** A roster bot's entry: its tier, family, and blurb. */
  readonly roster?: RosterEntry | undefined
}

/** The errors of a bot's assembly: a bot with any makes no bytes (ISA §6.5). */
export function errorsOf(bot: CatalogBot): readonly Diag[] {
  return bot.assembled.diagnostics.filter((d) => d.severity === 'error')
}

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

let roster: readonly CatalogBot[] | undefined

/**
 * The roster, showcase bots first, then the solid ones, then the test bots, each tier in roster
 * order. Assembled on the first call.
 */
export function rosterCatalog(): readonly CatalogBot[] {
  roster ??= [...ROSTER]
    .sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier))
    .map((entry) => {
      const bot = loadRoster().get(entry.slug)
      if (bot === undefined) throw new Error(`the roster has no bot '${entry.slug}'`)
      return {
        ref: { kind: 'roster', slug: entry.slug },
        origin: 'roster',
        name: entry.name,
        author: entry.author,
        source: bot.source,
        assembled: bot.assembled,
        roster: entry,
      } satisfies CatalogBot
    })
  return roster
}

const TIER_ORDER = ['showcase', 'solid', 'test'] as const

/** A local bot, assembled. */
export function localCatalog(bot: LocalBot): CatalogBot {
  return sourceBot({ kind: 'local', id: bot.id }, 'local', bot.source, bot.name)
}

/** A bot a share link carries, assembled. */
export function sharedCatalog(id: string, source: string): CatalogBot {
  return sourceBot({ kind: 'local', id }, 'shared', source, 'shared bot')
}

function sourceBot(ref: BotRef, origin: BotOrigin, source: string, fallback: string): CatalogBot {
  const assembled = assembleCached(source)
  return {
    ref,
    origin,
    name: assembled.name === '' ? fallback : assembled.name,
    author: assembled.author,
    source,
    assembled,
  }
}

/** Whether `bot` matches a search: every word is in its name, author, or roster entry. */
export function matchesQuery(bot: CatalogBot, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const entry = bot.roster
  const text = [bot.name, bot.author, entry?.slug, entry?.family, entry?.tier, entry?.blurb]
    .join(' ')
    .toLowerCase()
  return words.every((word) => text.includes(word))
}

/** A place in the selection, and the bot it holds, as far as the setup knows it. */
export interface SetupBot {
  /** Its place in the selection: its bot index in the battle, and so its hue. */
  readonly index: number
  readonly ref: BotRef
  /**
   * `ready` to fight; `broken` when its source does not assemble; `missing` when nothing in this
   * browser has it; `loading` while the local store is read.
   */
  readonly state: 'ready' | 'broken' | 'missing' | 'loading'
  readonly bot: CatalogBot | null
  /** The name the battle gives it: its own, with ` 2`, ` 3` … on a name already taken. */
  readonly name: string
}

/** Where `resolveSelection` looks a local ref up. */
export interface BotSources {
  /** The local bots by id, or null while the store is read. */
  readonly local: ReadonlyMap<string, LocalBot> | null
  /** The sources a share link carries, by id. */
  readonly shared: ReadonlyMap<string, string>
}

/**
 * The bots of `refs`, in order. A local ref is the store's bot when it has one, else the share
 * link's. Names repeat as `Dwarf`, `Dwarf 2`, so each bot of a battle has its own.
 */
export function resolveSelection(refs: readonly BotRef[], sources: BotSources): SetupBot[] {
  const rosterBots = new Map(rosterCatalog().map((bot) => [formatRef(bot.ref), bot]))
  const taken = new Map<string, number>()
  return refs.map((ref, index) => {
    const bot = lookUp(ref, sources, rosterBots)
    const state =
      bot === undefined
        ? ref.kind === 'local' && sources.local === null
          ? 'loading'
          : 'missing'
        : errorsOf(bot).length > 0
          ? 'broken'
          : 'ready'
    const own = bot?.name ?? (ref.kind === 'roster' ? ref.slug : 'local bot')
    const seen = (taken.get(own) ?? 0) + 1
    taken.set(own, seen)
    return { index, ref, state, bot: bot ?? null, name: seen === 1 ? own : `${own} ${seen}` }
  })
}

function lookUp(
  ref: BotRef,
  sources: BotSources,
  rosterBots: ReadonlyMap<string, CatalogBot>,
): CatalogBot | undefined {
  if (ref.kind === 'roster') return rosterBots.get(formatRef(ref))
  const local = sources.local?.get(ref.id)
  if (local !== undefined) return localCatalog(local)
  const shared = sources.shared.get(ref.id)
  return shared === undefined ? undefined : sharedCatalog(ref.id, shared)
}

/** The local and shared bots of a selection, once each: what a share link must carry. */
export function sharedSources(selection: readonly SetupBot[]): SharedBot[] {
  const bots = new Map<string, SharedBot>()
  for (const { ref, bot } of selection) {
    if (ref.kind === 'local' && bot !== null) bots.set(ref.id, { id: ref.id, source: bot.source })
  }
  return [...bots.values()]
}

/** What the fight button says, and whether it fights. */
export interface FightStatus {
  readonly label: string
  readonly ready: boolean
  /** The local store is still being read: the button waits. */
  readonly busy: boolean
}

/**
 * The fight button's words (PRODUCT_SPEC §2): what is missing, "add 1 more bot", until the
 * selection can fight, then what it fights, "fight · 4 bots · 1 round".
 */
export function fightStatus(selection: readonly SetupBot[], spec: ArenaSetupSpec): FightStatus {
  const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`
  const fight = `fight · ${count(selection.length, 'bot')} · ${count(spec.config.rounds, 'round')}`
  const missing = selection.filter((s) => s.state === 'missing').length
  const broken = selection.filter((s) => s.state === 'broken').length
  const not = (label: string): FightStatus => ({ label, ready: false, busy: false })
  if (selection.length < MIN_ARENA_BOTS) {
    const need = MIN_ARENA_BOTS - selection.length
    return not(`add ${selection.length === 0 ? count(need, 'bot') : count(need, 'more bot')}`)
  }
  if (missing > 0) return not(`remove ${count(missing, 'missing bot')}`)
  if (broken > 0) return not(`remove ${count(broken, 'broken bot')}`)
  if (selection.some((s) => s.state === 'loading'))
    return { label: fight, ready: false, busy: true }
  const { seed, minSpacing, rounds } = spec.config
  if (seed !== null && !fits(sizesOf(selection), minSpacing, seed, rounds)) {
    return not('bots do not fit · lower the spacing')
  }
  return { label: fight, ready: true, busy: false }
}

/** The image sizes of a selection, in order. */
export function sizesOf(selection: readonly SetupBot[]): number[] {
  return selection.map((s) => s.bot?.assembled.bytes.length ?? 0)
}

/**
 * Whether images of `sizes` place `minSpacing` apart in each of `rounds` rounds of a match from
 * `seed` (ISA §5.5): round i places them in its rotated order with seed + i.
 */
export function fits(
  sizes: readonly number[],
  minSpacing: number,
  seed: number,
  rounds = 1,
): boolean {
  try {
    for (let round = 0; round < rounds; round++) {
      const order = roundOrder(sizes.length, round).map((k) => sizes[k] as number)
      place(order, minSpacing, new Pcg32(roundSeed(seed, round)))
    }
    return true
  } catch (error) {
    if (error instanceof PlacementError) return false
    throw error
  }
}

/** Random seeds a fight tries before it says the bots do not fit. */
const SEED_TRIES = 32

/**
 * The seed to fight a match of `rounds` rounds with: `seed` when the bots place with it in every
 * round, else a random seed they place with. Null when they do not place: the fixed seed fails,
 * or `SEED_TRIES` random ones do.
 */
export function fightSeed(
  sizes: readonly number[],
  minSpacing: number,
  seed: number | null,
  random: () => number = randomSeed,
  rounds = 1,
): number | null {
  if (seed !== null) return fits(sizes, minSpacing, seed, rounds) ? seed : null
  for (let i = 0; i < SEED_TRIES; i++) {
    const drawn = random()
    if (fits(sizes, minSpacing, drawn, rounds)) return drawn
  }
  return null
}

/** What the fight button starts: the bots as the Worker loads them, and the config. */
export interface ArenaFight {
  readonly bots: readonly ArenaBot[]
  /** The engine's config for the first round: its seed is drawn when the setup's is random. */
  readonly config: BattleConfigInput
  /** Rounds in the match. */
  readonly rounds: number
  /** The setup it came from. */
  readonly spec: ArenaSetupSpec
  /** Each bot's source, in order: what a replay file carries. */
  readonly sources: readonly string[]
  /** The local bots among them, once each: what a share link carries. */
  readonly shared: readonly SharedBot[]
}

/** The Worker's bots for a selection that is ready: battle names, machine code, and metadata. */
export function arenaBots(selection: readonly SetupBot[]): ArenaBot[] {
  return selection.map(({ name, bot }) => {
    if (bot === null) throw new Error(`bot '${name}' is not loaded`)
    const { author, strategy, version, bytes } = bot.assembled
    return { name, bytes, meta: { author, strategy, version } }
  })
}

/** The fight of a ready `selection` under `spec`, its first round placed with `seed`. */
export function arenaFight(
  selection: readonly SetupBot[],
  spec: ArenaSetupSpec,
  seed: number,
): ArenaFight {
  return {
    bots: arenaBots(selection),
    config: battleConfig(spec.config, seed),
    rounds: spec.config.rounds,
    spec,
    sources: selection.map((s) => s.bot?.source ?? ''),
    shared: sharedSources(selection),
  }
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

/** Whether a drag carries files: what a drop zone takes. */
export function carriesFiles(event: { dataTransfer: DataTransfer | null }): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files')
}
