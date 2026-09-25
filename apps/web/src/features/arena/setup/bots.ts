/**
 * The bots the arena setup offers and fights (PRODUCT_SPEC §2): the roster, the local bots, the
 * bots a share link carries, and dropped `.asm` files. The roster comes prebuilt
 * (`rosterImage`); the others are assembled on the main thread by `assembleCached`, whose chunk
 * (`assembly.ts`, with the assembler) a setup of roster bots never loads. The selection is a list
 * of refs; `resolveSelection` turns it into bots, and `arenaBots` into what the Worker loads.
 */
import type { Assembled, Diag } from '@asmbots/asm'
import { ROSTER, type RosterEntry, rosterImage } from '@asmbots/bots'
import { type BattleConfigInput, Pcg32, PlacementError, place } from '@asmbots/engine'
import { roundOrder, roundSeed } from '@asmbots/tourney'
import type { LocalBot } from '../../../store/local-bots'
import type { ArenaBot } from '../worker/protocol'
import { battleConfig, MIN_ARENA_BOTS, randomSeed } from './config'
import { type ArenaSetupSpec, type BotRef, formatRef, type SharedBot } from './url'

/** Where a bot comes from: the roster, this browser's store, or a share link. */
export type BotOrigin = 'roster' | 'local' | 'shared'

/**
 * What the setup reads of a bot's assembly: its image, its metadata, and its errors. A local or
 * shared bot's is its whole `Assembled`; a roster bot's is prebuilt (`rosterImage`) and has no
 * listing, so what needs one assembles the roster's source (`loadRoster`).
 */
export type AssembledBot = Pick<
  Assembled,
  'name' | 'author' | 'strategy' | 'version' | 'bytes' | 'diagnostics'
>

/** Assembles a source: `assembleCached`, once its chunk has loaded (`assembler.ts`). */
export type Assemble = (source: string) => Assembled

/** A bot the setup can show and fight. */
export interface CatalogBot {
  readonly ref: BotRef
  readonly origin: BotOrigin
  /** The `%name`, or the stored name of a local bot whose source does not assemble. */
  readonly name: string
  readonly author: string
  /** Its source; null for a roster bot, whose text `rosterSource` reads when a replay needs it. */
  readonly source: string | null
  readonly assembled: AssembledBot
  /** A roster bot's entry: its tier, family, and blurb. */
  readonly roster?: RosterEntry | undefined
}

/** The errors of a bot's assembly: a bot with any makes no bytes (ISA §6.5). */
export function errorsOf(bot: CatalogBot): readonly Diag[] {
  return bot.assembled.diagnostics.filter((d) => d.severity === 'error')
}

let roster: readonly CatalogBot[] | undefined

/**
 * The roster, showcase bots first, then the solid ones, then the test bots, each tier in roster
 * order. Prebuilt: nothing is assembled, and no source is loaded.
 */
export function rosterCatalog(): readonly CatalogBot[] {
  roster ??= [...ROSTER]
    .sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier))
    .map(
      (entry): CatalogBot => ({
        ref: { kind: 'roster', slug: entry.slug },
        origin: 'roster',
        name: entry.name,
        author: entry.author,
        source: null,
        assembled: { ...rosterImage(entry.slug), diagnostics: [] },
        roster: entry,
      }),
    )
  return roster
}

const TIER_ORDER = ['showcase', 'solid', 'test'] as const

/** A local bot, assembled. */
export function localCatalog(bot: LocalBot, assemble: Assemble): CatalogBot {
  return sourceBot({ kind: 'local', id: bot.id }, 'local', bot.source, bot.name, assemble)
}

/** A bot a share link carries, assembled. */
export function sharedCatalog(id: string, source: string, assemble: Assemble): CatalogBot {
  return sourceBot({ kind: 'local', id }, 'shared', source, 'shared bot', assemble)
}

function sourceBot(
  ref: BotRef,
  origin: BotOrigin,
  source: string,
  fallback: string,
  assemble: Assemble,
): CatalogBot {
  const assembled = assemble(source)
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
   * browser has it; `loading` while the local store is read, or the assembler loads.
   */
  readonly state: 'ready' | 'broken' | 'missing' | 'loading'
  readonly bot: CatalogBot | null
  /** The name the battle gives it: its own, with ` 2`, ` 3` … on a name already taken. */
  readonly name: string
}

/** Where `resolveSelection` looks a local ref up, and what assembles it. */
export interface BotSources {
  /** The local bots by id, or null while the store is read. */
  readonly local: ReadonlyMap<string, LocalBot> | null
  /** The sources a share link carries, by id. */
  readonly shared: ReadonlyMap<string, string>
  /** Assembles a local or shared bot; null while the assembler loads. The roster needs none. */
  readonly assemble: Assemble | null
}

/**
 * The bots of `refs`, in order. A local ref is the store's bot when it has one, else the share
 * link's. Names repeat as `Dwarf`, `Dwarf 2`, so each bot of a battle has its own.
 */
export function resolveSelection(refs: readonly BotRef[], sources: BotSources): SetupBot[] {
  const rosterBots = new Map(rosterCatalog().map((bot) => [formatRef(bot.ref), bot]))
  const taken = new Map<string, number>()
  return refs.map((ref, index) => {
    const found = lookUp(ref, sources, rosterBots)
    const bot = found === 'loading' ? undefined : found
    const state =
      found === 'loading'
        ? 'loading'
        : bot === undefined
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

/** A ref's bot; `loading` for a local or shared one while the assembler loads. */
function lookUp(
  ref: BotRef,
  sources: BotSources,
  rosterBots: ReadonlyMap<string, CatalogBot>,
): CatalogBot | 'loading' | undefined {
  if (ref.kind === 'roster') return rosterBots.get(formatRef(ref))
  const local = sources.local?.get(ref.id)
  const shared = sources.shared.get(ref.id)
  if (local === undefined && shared === undefined) return undefined
  const { assemble } = sources
  if (assemble === null) return 'loading'
  if (local !== undefined) return localCatalog(local, assemble)
  return shared === undefined ? undefined : sharedCatalog(ref.id, shared, assemble)
}

/** The local and shared bots of a selection, once each: what a share link must carry. */
export function sharedSources(selection: readonly SetupBot[]): SharedBot[] {
  const bots = new Map<string, SharedBot>()
  for (const { ref, bot } of selection) {
    if (ref.kind === 'local' && bot !== null && bot.source !== null) {
      bots.set(ref.id, { id: ref.id, source: bot.source })
    }
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
  /**
   * Each bot's source, in order: what a replay file carries. Null for a roster bot:
   * `replaySources` reads the roster's text.
   */
  readonly sources: readonly (string | null)[]
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
    sources: selection.map((s) => (s.bot === null ? '' : s.bot.source)),
    shared: sharedSources(selection),
  }
}

/**
 * Each bot's source for a replay file, in order. A roster bot's is read from the roster's
 * sources, a chunk of their own (`roster-source.ts`) that loads here, not with the arena.
 */
export async function replaySources(fight: ArenaFight): Promise<string[]> {
  const { sources } = fight
  if (sources.every((source): source is string => source !== null)) return [...sources]
  const { rosterSource } = await import('./roster-source')
  return sources.map((source, i) => {
    if (source !== null) return source
    const ref = fight.spec.bots[i]
    return ref?.kind === 'roster' ? rosterSource(ref.slug) : ''
  })
}

/** Whether a drag carries files: what a drop zone takes. */
export function carriesFiles(event: { dataTransfer: DataTransfer | null }): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files')
}
