/**
 * The arena setup's logic: the config and its presets, the URL (query, refs, the `#src=` share
 * fragment), and the bots (the roster, resolving a selection, the fight button's words, placement,
 * dropped files). `arena-setup-view.test.tsx` renders the setup.
 */
import { describe, expect, it } from 'bun:test'
import { assemble } from '@asmbots/asm'
import { HILL_RULES, loadRoster, ROSTER } from '@asmbots/bots'
import { DEFAULT_CONFIG, simulate } from '@asmbots/engine'
import { fromBase64Url, SOURCES_KEY, toBase64Url } from '@asmbots/protocol'
import { MAX_MELEE_ENTRANTS } from '@asmbots/tourney'
import { defaultParseSearch } from '@tanstack/react-router'
import { deflateSync, strToU8 } from 'fflate'
import { assembleCached, fileAssembles, readBotFiles } from '../src/features/arena/setup/assembly'
import {
  arenaBots,
  arenaFight,
  fightSeed,
  fightStatus,
  fits,
  matchesQuery,
  replaySources,
  resolveSelection,
  rosterCatalog,
  type SetupBot,
  sharedSources,
} from '../src/features/arena/setup/bots'
import {
  battleConfig,
  countOf,
  DEFAULT_ARENA_CONFIG,
  MAX_ARENA_BOTS,
  PRESETS,
  presetOf,
  ROUNDS,
  sanitizeConfig,
  seedOf,
  withConfig,
  withPreset,
} from '../src/features/arena/setup/config'
import { validateArenaSearch } from '../src/features/arena/setup/search'
import {
  type ArenaSetupSpec,
  type BotRef,
  formatRef,
  parseRef,
  parseRefs,
  searchFromSetup,
  setupFromSearch,
  sharedBots,
  sharedFragment,
  shareUrl,
} from '../src/features/arena/setup/url'
import { stringifySearch } from '../src/router'
import type { LocalBot } from '../src/store/local-bots'
import type { ArenaConfig } from '../src/store/settings'

const roster = (slug: string): BotRef => ({ kind: 'roster', slug })
const local = (id: string): BotRef => ({ kind: 'local', id })

const IMP = loadRoster().get('imp')?.source ?? ''
const BROKEN = '%name "Broken"\n        jmp nowhere\n'

function localBot(id: string, source: string, name = 'mine'): LocalBot {
  return { id, name, source, updatedAt: 0 }
}

function spec(bots: readonly BotRef[], config: Partial<ArenaConfig> = {}): ArenaSetupSpec {
  return { bots, config: { ...DEFAULT_ARENA_CONFIG, ...config } }
}

const NO_SOURCES = {
  local: new Map<string, LocalBot>(),
  shared: new Map<string, string>(),
  assemble: assembleCached,
}

describe('config', () => {
  it('starts as duel: the engine defaults, one round, a random seed', () => {
    expect(DEFAULT_ARENA_CONFIG).toEqual({
      preset: 'duel',
      seed: null,
      rounds: 1,
      maxCycles: DEFAULT_CONFIG.maxCycles,
      maxProcesses: DEFAULT_CONFIG.maxProcesses,
      minSpacing: DEFAULT_CONFIG.minSpacing,
    })
    expect(presetOf(DEFAULT_ARENA_CONFIG)).toBe('duel')
  })

  it('has the four presets, hill rules as the hill has them', () => {
    expect(Object.keys(PRESETS)).toEqual(['duel', 'melee 8', 'melee 16', 'hill rules'])
    expect(PRESETS['hill rules']).toMatchObject({ rounds: 10, maxCycles: HILL_RULES.maxCycles })
    expect(MAX_ARENA_BOTS).toBe(MAX_MELEE_ENTRANTS)
    // Each preset is its own: a config names one preset at most.
    const names = Object.values(PRESETS).map((values) => presetOf(values))
    expect(names).toEqual(['duel', 'melee 8', 'melee 16', 'hill rules'])
  })

  it('applies a preset over everything but the seed', () => {
    const fixed = { ...DEFAULT_ARENA_CONFIG, seed: 42 }
    expect(withPreset(fixed, 'melee 16')).toEqual({
      ...PRESETS['melee 16'],
      seed: 42,
      preset: 'melee 16',
    })
  })

  it('holds a change to the limits and names the preset it lands on', () => {
    const custom = withConfig(DEFAULT_ARENA_CONFIG, { rounds: 3 })
    expect(custom).toMatchObject({ rounds: 3, preset: null })
    expect(withConfig(custom, { rounds: 1 }).preset).toBe('duel')
    expect(withConfig(DEFAULT_ARENA_CONFIG, { rounds: 99, maxCycles: 5 })).toMatchObject({
      rounds: ROUNDS.max,
      maxCycles: 10_000,
    })
  })

  it('takes counts from numbers and digits, and junk as the default', () => {
    expect(countOf('300', ROUNDS)).toBe(10)
    expect(countOf(2.6, ROUNDS)).toBe(3)
    expect(countOf(-4, ROUNDS)).toBe(1)
    expect(countOf('3x', ROUNDS)).toBeNull()
    expect(countOf(Number.NaN, ROUNDS)).toBeNull()
    expect(sanitizeConfig({ rounds: 'many', maxProcesses: 4096, minSpacing: '0' })).toEqual({
      ...DEFAULT_ARENA_CONFIG,
      maxProcesses: 256,
      minSpacing: 0,
      preset: null,
    })
  })

  it('takes a uint32 seed, and anything else as random', () => {
    expect(seedOf(0)).toBe(0)
    expect(seedOf('4294967295')).toBe(0xffff_ffff)
    expect([2 ** 32, -1, 1.5, 'x', null, undefined].map(seedOf)).toEqual(Array(6).fill(null))
  })

  it("gives the engine its fields and the round's seed", () => {
    expect(battleConfig({ ...DEFAULT_ARENA_CONFIG, rounds: 3 }, 9)).toEqual({
      maxCycles: 100_000,
      maxProcesses: 64,
      minSpacing: 1024,
      seed: 9,
    })
  })
})

describe('search', () => {
  it('keeps the fields that have their type', () => {
    expect(
      validateArenaSearch({
        b: 'roster:dwarf,roster:paper',
        seed: 42,
        cycles: '100000',
        rounds: 3,
        procs: 64,
        spacing: 1024,
      }),
    ).toEqual({
      b: 'roster:dwarf,roster:paper',
      seed: 42,
      cycles: 100_000,
      rounds: 3,
      procs: 64,
      spacing: 1024,
    })
  })

  it('drops junk, and leaves the limits to the page', () => {
    expect(
      validateArenaSearch({
        b: 7,
        seed: 'random',
        cycles: -1,
        rounds: 1.5,
        procs: {},
        spacing: '',
      }),
    ).toEqual({})
    expect(validateArenaSearch({ rounds: 99, other: 'x' })).toEqual({ rounds: 99 })
  })
})

describe('refs', () => {
  it('reads roster and local refs and writes them back', () => {
    expect(parseRef('roster:dwarf')).toEqual(roster('dwarf'))
    expect(parseRef('local:3f2a-9c')).toEqual(local('3f2a-9c'))
    for (const text of ['roster:dwarf', 'local:3f2a-9c']) {
      expect(formatRef(parseRef(text) as BotRef)).toBe(text)
    }
  })

  it('refuses anything else', () => {
    for (const text of ['dwarf', 'hill:dwarf', 'roster:', 'roster:a b', 'local:../x', ':x']) {
      expect(parseRef(text)).toBeNull()
    }
  })

  it('reads a list in order, skipping junk, up to the cap', () => {
    expect(parseRefs(' roster:imp ,nope,local:a')).toEqual([roster('imp'), local('a')])
    const many = Array.from({ length: 20 }, (_, i) => `local:b${i}`).join(',')
    expect(parseRefs(many)).toHaveLength(MAX_ARENA_BOTS)
  })
})

describe('setup in the URL', () => {
  it('reads a setup, each field left out at its duel value', () => {
    const got = setupFromSearch({ b: 'roster:dwarf,roster:paper', seed: 42, rounds: 3 })
    expect(got).toEqual({
      bots: [roster('dwarf'), roster('paper')],
      config: { ...DEFAULT_ARENA_CONFIG, seed: 42, rounds: 3, preset: null },
    })
  })

  it('starts a visit with no query from the fallback config', () => {
    const last: ArenaConfig = { ...PRESETS['hill rules'], seed: 5, preset: 'hill rules' }
    expect(setupFromSearch({}, last)).toEqual({ bots: [], config: last })
    // A link with only bots is not a fresh visit: its config is the default.
    expect(setupFromSearch({ b: 'roster:imp' }, last).config).toEqual(DEFAULT_ARENA_CONFIG)
  })

  it('holds a hand-edited link to the limits', () => {
    const got = setupFromSearch({ cycles: 5, rounds: 99, procs: 0, spacing: 9999, seed: 2 ** 33 })
    expect(got.config).toEqual({
      preset: null,
      seed: null,
      rounds: 10,
      maxCycles: 10_000,
      maxProcesses: 1,
      minSpacing: 8192,
    })
  })

  it('writes every field, the seed only when fixed, and reads back the same setup', () => {
    const setup = spec([roster('dwarf'), local('a1')], { seed: 42, rounds: 3 })
    const search = searchFromSetup(setup)
    expect(search).toEqual({
      b: 'roster:dwarf,local:a1',
      seed: 42,
      cycles: 100_000,
      rounds: 3,
      procs: 64,
      spacing: 1024,
    })
    expect(setupFromSearch(search)).toEqual({ ...setup, config: { ...setup.config, preset: null } })
    expect(searchFromSetup(spec([]))).toEqual({
      cycles: 100_000,
      rounds: 1,
      procs: 64,
      spacing: 1024,
    })
  })

  it("keeps the router's query readable, and the router reads it back", () => {
    const search = searchFromSetup(spec([roster('dwarf'), roster('paper')], { seed: 42 }))
    const text = stringifySearch({ ...search })
    expect(text).toBe(
      '?b=roster:dwarf,roster:paper&seed=42&cycles=100000&rounds=1&procs=64&spacing=1024',
    )
    expect(validateArenaSearch(defaultParseSearch(text))).toEqual(search)
    // Anything else still escapes: a `&` in a value cannot end it.
    expect(stringifySearch({ q: 'a&b c' })).toBe('?q=a%26b+c')
  })
})

describe('share fragment', () => {
  const bots = [
    { id: 'a1', source: IMP },
    { id: 'b2', source: '%name "π bot"\nstart: jmp start ; ünïcode\n' },
  ]

  it('carries local bots by id and gives them back', () => {
    const fragment = sharedFragment(bots)
    expect(fragment.startsWith(`${SOURCES_KEY}=`)).toBe(true)
    expect(fragment).toMatch(/^src=[A-Za-z0-9_-]+$/)
    expect([...sharedBots(fragment)]).toEqual(bots.map((b) => [b.id, b.source]))
    expect([...sharedBots(`#${fragment}`)]).toHaveLength(2)
    expect(sharedFragment([])).toBe('')
  })

  it('packs the source: a link is smaller than the text', () => {
    expect(sharedFragment([bots[0] as (typeof bots)[0]]).length).toBeLessThan(IMP.length)
  })

  it('gives nothing for a fragment cut short or made up', () => {
    const fragment = sharedFragment(bots)
    const pack = (value: unknown) =>
      `src=${toBase64Url(deflateSync(strToU8(JSON.stringify(value))))}`
    for (const junk of [
      '',
      'r=abc',
      'src=',
      fragment.slice(0, 20),
      'src=***',
      pack({ a1: IMP }),
      pack([['../x', IMP], ['ok', 7], 'x']),
    ]) {
      expect(sharedBots(junk).size).toBe(0)
    }
  })

  it('stops unpacking a deflate bomb at its limit', () => {
    const bomb = `src=${toBase64Url(deflateSync(new Uint8Array(4 * 1024 * 1024)))}`
    expect(bomb.length).toBeLessThan(8000)
    expect(sharedBots(bomb).size).toBe(0)
  })

  it('writes base64url without padding, and reads it with or without', () => {
    const bytes = new Uint8Array([0xfb, 0xff, 0xfe, 0x00])
    expect(toBase64Url(bytes)).toBe('-__-AA')
    expect(fromBase64Url('-__-AA')).toEqual(bytes)
    expect(fromBase64Url('-__-AA==')).toEqual(bytes)
    const big = new Uint8Array(100_000).map((_, i) => i * 7)
    expect(fromBase64Url(toBase64Url(big))).toEqual(big)
  })

  it('makes a share link of the query and the fragment', () => {
    const setup = spec([roster('dwarf'), local('a1')], { seed: 7 })
    const url = shareUrl('https://asmbots.dev', setup, [{ id: 'a1', source: IMP }])
    const parsed = new URL(url)
    expect(parsed.pathname).toBe('/arena')
    expect(parsed.search).toBe(
      '?b=roster:dwarf,local:a1&seed=7&cycles=100000&rounds=1&procs=64&spacing=1024',
    )
    expect([...sharedBots(parsed.hash)]).toEqual([['a1', IMP]])
    expect(shareUrl('https://x', spec([roster('imp')]), [])).not.toContain('#')
  })
})

describe('roster catalog', () => {
  it('lists every roster bot once, showcase first, then solid, then test', () => {
    const catalog = rosterCatalog()
    expect(catalog.map((b) => b.roster?.slug).sort()).toEqual(ROSTER.map((e) => e.slug).sort())
    const tiers = catalog.map((b) => b.roster?.tier)
    expect(tiers).toEqual([...tiers].sort((a, b) => order(a) - order(b)))
    expect(catalog[0]).toMatchObject({ origin: 'roster', ref: roster('imp'), name: 'Imp' })
    expect(catalog.every((b) => b.assembled.bytes.length > 0)).toBe(true)
    expect(rosterCatalog()).toBe(catalog)
  })

  it('comes prebuilt: what each source assembles to, with no source loaded', () => {
    for (const bot of rosterCatalog()) {
      const slug = bot.roster?.slug ?? ''
      const { name, author, strategy, version, bytes } = loadRoster().get(slug)?.assembled ?? {}
      expect(bot.source).toBeNull()
      expect({ ...bot.assembled, bytes: [...bot.assembled.bytes] }).toEqual({
        name,
        author,
        strategy,
        version,
        bytes: [...(bytes ?? [])],
        diagnostics: [],
      })
    }
  })

  it('finds bots by every word, in name, author, family, tier, or blurb', () => {
    const find = (query: string) =>
      rosterCatalog()
        .filter((b) => matchesQuery(b, query))
        .map((b) => b.roster?.slug)
    expect(find('')).toHaveLength(ROSTER.length)
    expect(find('PAINTER')).toEqual(['painter-lcg', 'painter-spiral'])
    expect(find('paper solid')).toEqual(['silk', 'hybrid'])
    expect(find('paper solid pad')).toEqual(['silk'])
    expect(find('nothing-like-this')).toEqual([])
  })
})

function order(tier: string | undefined): number {
  return ['showcase', 'solid', 'test'].indexOf(tier ?? '')
}

describe('resolveSelection', () => {
  it('finds roster bots, and names a repeat Dwarf 2', () => {
    const got = resolveSelection([roster('dwarf'), roster('paper'), roster('dwarf')], NO_SOURCES)
    expect(got.map((s) => [s.index, s.state, s.name])).toEqual([
      [0, 'ready', 'Dwarf'],
      [1, 'ready', 'Paper'],
      [2, 'ready', 'Dwarf 2'],
    ])
  })

  it('takes a local ref from the store first, then from a share link', () => {
    const sources = {
      local: new Map([['a', localBot('a', IMP, 'stored imp')]]),
      shared: new Map([
        ['a', BROKEN],
        ['b', IMP],
      ]),
      assemble: assembleCached,
    }
    const got = resolveSelection([local('a'), local('b'), local('c')], sources)
    expect(got.map((s) => [s.state, s.bot?.origin ?? null, s.name])).toEqual([
      ['ready', 'local', 'Imp'],
      ['ready', 'shared', 'Imp 2'],
      ['missing', null, 'local bot'],
    ])
  })

  it('marks a local bot loading while the store is read, and one with errors broken', () => {
    const loading = resolveSelection([local('a')], { ...NO_SOURCES, local: null })
    expect(loading[0]?.state).toBe('loading')
    const broken = resolveSelection([local('x')], {
      ...NO_SOURCES,
      local: new Map([['x', localBot('x', BROKEN)]]),
    })
    expect(broken[0]).toMatchObject({ state: 'broken', name: 'Broken' })
    // An unknown roster slug is missing, never loading.
    expect(resolveSelection([roster('nobody')], { ...NO_SOURCES, local: null })[0]?.state).toBe(
      'missing',
    )
  })

  it('marks a local or shared bot loading while the assembler loads; the roster needs none', () => {
    const got = resolveSelection([roster('imp'), local('a'), local('b'), local('c')], {
      local: new Map([['a', localBot('a', IMP)]]),
      shared: new Map([['b', IMP]]),
      assemble: null,
    })
    expect(got.map((s) => [s.state, s.name])).toEqual([
      ['ready', 'Imp'],
      ['loading', 'local bot'],
      ['loading', 'local bot 2'],
      // Nothing has it: no assembler would find it.
      ['missing', 'local bot 3'],
    ])
  })

  it('names a bot with no %name by its stored name', () => {
    const got = resolveSelection([local('n')], {
      ...NO_SOURCES,
      local: new Map([['n', localBot('n', 'jmp $', 'scratch')]]),
    })
    expect(got[0]).toMatchObject({ state: 'broken', name: 'scratch' })
  })

  it('lists the local and shared sources a share link must carry, once each', () => {
    const got = resolveSelection([roster('imp'), local('a'), local('a'), local('b')], {
      local: new Map([['a', localBot('a', IMP)]]),
      shared: new Map([['b', BROKEN]]),
      assemble: assembleCached,
    })
    expect(sharedSources(got)).toEqual([
      { id: 'a', source: IMP },
      { id: 'b', source: BROKEN },
    ])
  })
})

describe('fightStatus', () => {
  const status = (refs: BotRef[], config: Partial<ArenaConfig> = {}, sources = NO_SOURCES) =>
    fightStatus(resolveSelection(refs, sources), spec(refs, config))

  it('asks for bots until there are two', () => {
    expect(status([])).toEqual({ label: 'add 2 bots', ready: false, busy: false })
    expect(status([roster('imp')])).toEqual({ label: 'add 1 more bot', ready: false, busy: false })
  })

  it('says what it fights', () => {
    expect(status([roster('imp'), roster('dwarf')])).toEqual({
      label: 'fight · 2 bots · 1 round',
      ready: true,
      busy: false,
    })
    expect(status([roster('imp'), roster('dwarf'), roster('paper')], { rounds: 3 }).label).toBe(
      'fight · 3 bots · 3 rounds',
    )
  })

  it('names the fix for a missing or a broken bot', () => {
    expect(status([roster('imp'), local('gone'), local('gone2')]).label).toBe(
      'remove 2 missing bots',
    )
    const sources = { ...NO_SOURCES, local: new Map([['x', localBot('x', BROKEN)]]) }
    expect(status([roster('imp'), local('x')], {}, sources).label).toBe('remove 1 broken bot')
  })

  it('waits for the local store', () => {
    const got = status([roster('imp'), local('a')], {}, { ...NO_SOURCES, local: null } as never)
    expect(got).toEqual({ label: 'fight · 2 bots · 1 round', ready: false, busy: true })
  })

  it('waits for the assembler', () => {
    const sources = { ...NO_SOURCES, local: new Map([['a', localBot('a', IMP)]]), assemble: null }
    const got = status([roster('imp'), local('a')], {}, sources as never)
    expect(got).toEqual({ label: 'fight · 2 bots · 1 round', ready: false, busy: true })
  })

  it('says when bots cannot place with a fixed seed', () => {
    // Eight images, each 8 KB clear of the others both ways: more than 64 KB.
    const refs = ['imp', 'dwarf', 'paper', 'stone', 'silk', 'gate', 'decoy', 'scanner'].map(roster)
    expect(status(refs, { seed: 1, minSpacing: 8192 }).label).toBe(
      'bots do not fit · lower the spacing',
    )
    // A random seed decides at the fight.
    expect(status(refs, { seed: null, minSpacing: 8192 }).ready).toBe(true)
  })
})

describe('placement', () => {
  it('knows when images fit around the core', () => {
    expect(fits([100, 100], 1024, 1)).toBe(true)
    expect(fits([100, 100, 100, 100, 100, 100, 100, 100], 8192, 1)).toBe(false)
  })

  it('keeps a fixed seed that places, and draws random seeds until one does', () => {
    expect(fightSeed([10, 10], 1024, 42)).toBe(42)
    expect(fightSeed([10, 10, 10, 10, 10, 10, 10, 10], 8192, 42)).toBeNull()
    const draws = [1, 2, 3]
    expect(fightSeed([10, 10], 1024, null, () => draws.shift() ?? 0)).toBe(1)
    expect(fightSeed([10, 10, 10, 10, 10, 10, 10, 10], 8192, null, () => 5)).toBeNull()
  })

  it('agrees with the engine: a seed that fits runs', () => {
    const selection = resolveSelection([roster('dwarf'), roster('paper')], NO_SOURCES)
    const seed = fightSeed([23, 34], 1024, null) as number
    expect(() => simulate(arenaBots(selection), { seed, maxCycles: 10 })).not.toThrow()
  })
})

describe('arenaBots', () => {
  it('gives the Worker battle names, machine code, and metadata', () => {
    const selection = resolveSelection([roster('dwarf'), roster('dwarf')], NO_SOURCES)
    const bots = arenaBots(selection)
    const dwarf = loadRoster().get('dwarf')?.assembled
    expect(bots.map((b) => b.name)).toEqual(['Dwarf', 'Dwarf 2'])
    expect(bots[1]?.bytes).toEqual(dwarf?.bytes as Uint8Array)
    expect(bots[0]?.meta).toEqual({
      author: dwarf?.author,
      strategy: dwarf?.strategy,
      version: dwarf?.version,
    })
  })

  it('refuses a bot that is not loaded', () => {
    const missing = resolveSelection([local('gone')], NO_SOURCES) as SetupBot[]
    expect(() => arenaBots(missing)).toThrow("bot 'local bot' is not loaded")
  })
})

describe('replaySources', () => {
  it("reads a roster bot's source from the roster, and keeps the others as they are", async () => {
    const refs = [roster('dwarf'), local('a'), roster('imp')]
    const selection = resolveSelection(refs, {
      ...NO_SOURCES,
      local: new Map([['a', localBot('a', BROKEN.replace('jmp nowhere', 'jmp $'))]]),
    })
    const fight = arenaFight(selection, spec(refs), 1)
    expect(fight.sources).toEqual([null, BROKEN.replace('jmp nowhere', 'jmp $'), null])
    expect(await replaySources(fight)).toEqual([
      loadRoster().get('dwarf')?.source,
      BROKEN.replace('jmp nowhere', 'jmp $'),
      IMP,
    ])
  })

  it('hands back the sources of a fight with no roster bot', async () => {
    const refs = [local('a'), local('b')]
    const selection = resolveSelection(refs, {
      ...NO_SOURCES,
      local: new Map([
        ['a', localBot('a', IMP)],
        ['b', localBot('b', IMP, 'again')],
      ]),
    })
    expect(await replaySources(arenaFight(selection, spec(refs), 1))).toEqual([IMP, IMP])
  })
})

describe('readBotFiles', () => {
  it('assembles .asm files and says why it skips the rest', async () => {
    const files = [
      new File([IMP], 'imp.ASM'),
      new File([BROKEN], 'broken.asm'),
      new File(['hello'], 'notes.txt'),
      new File([new Uint8Array(65 * 1024)], 'huge.asm'),
    ]
    const read = await readBotFiles(files)
    expect(read.map((f) => [f.file, f.problem])).toEqual([
      ['imp.ASM', null],
      ['broken.asm', null],
      ['notes.txt', 'not an .asm file'],
      ['huge.asm', '65 KB: a bot source is at most 64 KB'],
    ])
    expect(read.map(fileAssembles)).toEqual([true, false, false, false])
    expect(read[0]?.assembled?.bytes).toEqual(assemble(IMP).bytes)
    expect(read[1]?.assembled?.diagnostics[0]?.code).toBe('undefined-symbol')
  })

  it('says so for a file the browser will not read, and reads the rest', async () => {
    const folder = new File([], 'bots.asm')
    folder.text = () => Promise.reject(new DOMException('a folder', 'NotReadableError'))
    const read = await readBotFiles([folder, new File([IMP], 'imp.asm')])
    expect(read.map((f) => [f.file, f.problem])).toEqual([
      ['bots.asm', 'could not read the file'],
      ['imp.asm', null],
    ])
  })
})
