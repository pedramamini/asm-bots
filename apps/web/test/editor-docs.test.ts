/**
 * The editor's documents and what it keeps: the templates, the document keys and paths, the
 * route's query, the persisted prefs and drafts (src/features/editor/store.ts), and the saved
 * versions of each local bot (src/store/bot-versions.ts, on fake-indexeddb).
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'bun:test'
import { assemble, formatSource, lint } from '@asmbots/asm'
import { useDom } from '../../../packages/ui/test/dom'
import { SNIPPETS } from '../src/features/editor/cm/complete'
import {
  docKey,
  paramOf,
  parseDocKey,
  pathOf,
  SCRATCH,
  targetOfParam,
} from '../src/features/editor/doc'
import { PRESETS } from '../src/features/editor/layout/tree'
import { validateEditorSearch } from '../src/features/editor/search'
import {
  DEFAULT_DEBUG_PREFS,
  DEFAULT_EDITOR_PREFS,
  EDITOR_PREFS_VERSION,
  EDITOR_STORAGE_KEY,
  MAX_DRAFTS,
  MAX_RECENT,
  migrateEditorPrefs,
  sanitizeDebugPrefs,
  sanitizeEditorPrefs,
  useEditorPrefs,
} from '../src/features/editor/store'
import {
  isBlankBot,
  isTemplateId,
  TEMPLATE_IDS,
  TEMPLATES,
  templateSource,
} from '../src/features/editor/templates'
import { addVersion, clearVersions, listVersions, MAX_VERSIONS } from '../src/store/bot-versions'
import { clearLocalBots, deleteLocalBot, saveLocalBot } from '../src/store/local-bots'

// localStorage, for the persisted prefs.
useDom()

describe('templates', () => {
  it('lists the six of PRODUCT_SPEC §3, the base idiom as a snippet', () => {
    expect(TEMPLATES.map((t) => t.label)).toEqual([
      'blank',
      'imp',
      'dwarf',
      'scanner skeleton',
      'replicator skeleton',
    ])
    expect(SNIPPETS[0]?.label).toBe('base idiom')
  })

  it('assembles each without an error or a warning, in the formatter layout', () => {
    for (const id of TEMPLATE_IDS) {
      const source = templateSource(id)
      const bot = assemble(source)
      expect([id, bot.diagnostics, lint(source, bot)]).toEqual([id, [], []])
      expect([id, formatSource(source)]).toEqual([id, source])
    }
  })

  it('takes imp and dwarf from the roster', () => {
    expect(templateSource('imp')).toContain('%name     "Imp"')
    expect(templateSource('dwarf')).toContain('%name     "Dwarf"')
  })

  it('knows its ids', () => {
    expect(isTemplateId('scanner')).toBe(true)
    expect(isTemplateId('paper')).toBe(false)
  })

  it('says what each is in a line the empty state shows whole', () => {
    for (const { id, detail } of TEMPLATES) {
      expect([id, detail.length > 0 && detail.length <= 28]).toEqual([id, true])
    }
  })

  it('knows a bot nobody has written in: the blank template as it comes, or no text', () => {
    const blank = templateSource('blank')
    expect([blank, '', '  \n\t\n'].map(isBlankBot)).toEqual([true, true, true])
    expect(
      [`${blank}; mine\n`, blank.replace('untitled', 'mine'), templateSource('imp')].map(
        isBlankBot,
      ),
    ).toEqual([false, false, false])
  })
})

describe('documents', () => {
  it('keys a document as the arena refs a bot', () => {
    expect(docKey(SCRATCH)).toBe('scratch')
    expect(docKey({ kind: 'local', id: 'a-1' })).toBe('local:a-1')
    expect(docKey({ kind: 'roster', slug: 'imp-ring' })).toBe('roster:imp-ring')
    for (const key of ['scratch', 'local:a-1', 'roster:imp-ring']) {
      const target = parseDocKey(key)
      expect(target === null ? null : docKey(target)).toBe(key)
    }
    expect(parseDocKey('nope')).toBeNull()
  })

  it('puts a document at its path, a roster bot behind roster-', () => {
    expect(pathOf(SCRATCH)).toBe('/editor')
    expect(pathOf({ kind: 'local', id: '3f2a' })).toBe('/editor/3f2a')
    expect(pathOf({ kind: 'roster', slug: 'dwarf' })).toBe('/editor/roster-dwarf')
    expect(targetOfParam('roster-imp-ring')).toEqual({ kind: 'roster', slug: 'imp-ring' })
    expect(targetOfParam('3f2a')).toEqual({ kind: 'local', id: '3f2a' })
    expect(paramOf({ kind: 'roster', slug: 'paper' })).toBe('roster-paper')
  })

  it('reads the route query: the arena setup, and a template id', () => {
    expect(validateEditorSearch({ b: 'roster:dwarf,roster:imp', seed: '1', t: 'dwarf' })).toEqual({
      b: 'roster:dwarf,roster:imp',
      seed: 1,
      t: 'dwarf',
    })
    expect(validateEditorSearch({ t: 'Dwarf!' })).toEqual({})
    expect(validateEditorSearch({ t: 3 })).toEqual({})
  })
})

describe('editor prefs', () => {
  beforeEach(() => {
    useEditorPrefs.setState(structuredClone(DEFAULT_EDITOR_PREFS as never))
  })

  it('switches the listing, the library, and lint', () => {
    const { toggleListing, toggleLibrary, setLint } = useEditorPrefs.getState()
    toggleListing()
    toggleLibrary()
    setLint(false)
    const { listing, layout, lint } = useEditorPrefs.getState()
    expect([listing, layout.hidden.includes('library'), lint]).toEqual([false, true, false])
  })

  it('keeps the documents opened lately, the latest first, each once', () => {
    const { visit } = useEditorPrefs.getState()
    for (const key of ['a', 'b', 'a', 'c']) visit(key)
    expect(useEditorPrefs.getState().recent).toEqual(['c', 'a', 'b'])
    for (let n = 0; n < 20; n++) visit(`k${n}`)
    expect(useEditorPrefs.getState().recent).toHaveLength(MAX_RECENT)
    expect(useEditorPrefs.getState().recent[0]).toBe('k19')
  })

  it('keeps a draft per document, the newest MAX_DRAFTS, and drops one on null', () => {
    const { setDraft } = useEditorPrefs.getState()
    for (let n = 0; n < MAX_DRAFTS + 3; n++) setDraft(`d${n}`, { source: `s${n}`, name: '', at: n })
    const drafts = useEditorPrefs.getState().drafts
    expect(Object.keys(drafts)).toHaveLength(MAX_DRAFTS)
    expect(drafts.d0).toBeUndefined()
    expect(drafts[`d${MAX_DRAFTS + 2}`]?.source).toBe(`s${MAX_DRAFTS + 2}`)
    setDraft(`d${MAX_DRAFTS + 2}`, null)
    expect(useEditorPrefs.getState().drafts[`d${MAX_DRAFTS + 2}`]).toBeUndefined()
  })

  it('persists to localStorage, and takes only well-formed fields back', () => {
    useEditorPrefs.getState().setDraft('scratch', { source: 'nop', name: 'x', at: 1 })
    const stored = JSON.parse(localStorage.getItem(EDITOR_STORAGE_KEY) ?? '{}')
    expect(stored.state.drafts.scratch).toEqual({ source: 'nop', name: 'x', at: 1 })
    expect(
      sanitizeEditorPrefs({
        listing: 'yes',
        library: false,
        recent: ['a', 3, 'a', 'b'],
        drafts: { ok: { source: 's', name: 'n', at: 2 }, bad: { source: 1 }, worse: 7 },
      }),
    ).toEqual({
      // A store from before layouts: its library switch hides the library.
      layout: { ...PRESETS.writing(), hidden: [...PRESETS.writing().hidden, 'library'] },
      recent: ['a', 'b'],
      drafts: { ok: { source: 's', name: 'n', at: 2 } },
    })
    expect(sanitizeEditorPrefs('junk')).toEqual({})
  })

  it('starts the old default layout over as the writing one, and keeps one the user made', () => {
    expect(DEFAULT_EDITOR_PREFS.layout).toEqual(PRESETS.writing())
    const old = { listing: false, layout: OLD_DEFAULT, recent: ['a'], drafts: {} }
    const migrated = migrateEditorPrefs(JSON.parse(JSON.stringify(old)), 1)
    expect(migrated).toEqual({ listing: false, recent: ['a'], drafts: {} })
    expect(sanitizeEditorPrefs(migrated).layout).toBeUndefined()
    // A divider moved, or a panel hidden: the user's, kept as it is.
    const moved = structuredClone(OLD_DEFAULT) as { root: { weights: number[] }; hidden: string[] }
    moved.root.weights = [0.6, 0.4]
    expect(migrateEditorPrefs({ ...old, layout: moved }, 1)).toEqual({ ...old, layout: moved })
    const hid = { ...OLD_DEFAULT, hidden: ['trace'] }
    expect(migrateEditorPrefs({ ...old, layout: hid }, 1)).toEqual({ ...old, layout: hid })
    // A store of this version keeps its layout.
    expect(migrateEditorPrefs(old, EDITOR_PREFS_VERSION)).toBe(old)
  })

  it("keeps the debugger's preferences, each well-formed field over the defaults", () => {
    expect(DEFAULT_EDITOR_PREFS.debug).toEqual(DEFAULT_DEBUG_PREFS)
    expect(
      sanitizeDebugPrefs({
        speed: 250,
        runCycles: 40,
        lockIp: false,
        opponents: ['roster:imp', 3],
        seed: 7,
      }),
    ).toEqual({ speed: 250, runCycles: 40, lockIp: false, opponents: ['roster:imp'], seed: 7 })
    expect(sanitizeDebugPrefs({ speed: 0, runCycles: -1, lockIp: 'no', seed: 1.5 })).toEqual(
      DEFAULT_DEBUG_PREFS,
    )
    expect(sanitizeDebugPrefs({ speed: 'max' })?.speed).toBe('max')
    expect(sanitizeDebugPrefs('junk')).toBeNull()
    const { setDebug, setPhoneLayout } = useEditorPrefs.getState()
    setDebug({ seed: 42 })
    setPhoneLayout({ ...PRESETS.phone(), hidden: ['library'] })
    const stored = JSON.parse(localStorage.getItem(EDITOR_STORAGE_KEY) ?? '{}').state
    expect(stored.debug).toEqual({ ...DEFAULT_DEBUG_PREFS, seed: 42 })
    expect(sanitizeEditorPrefs(stored).phoneLayout?.hidden).toEqual(['library'])
  })
})

/** The default layout before version 2, as that version's store wrote it. */
const OLD_DEFAULT = (() => {
  const panel = (id: string) => ({ kind: 'panel', id })
  const split = (dir: string, ...parts: [object, number][]) => {
    const sum = parts.reduce((total, [, w]) => total + w, 0)
    return {
      kind: 'split',
      dir,
      children: parts.map(([n]) => n),
      weights: parts.map(([, w]) => w / sum),
    }
  }
  const machine = split(
    'column',
    [panel('debug'), 0.1],
    [
      split(
        'row',
        [split('column', [panel('registers'), 0.3], [panel('processes'), 0.7]), 0.44],
        [
          split(
            'column',
            [panel('memory'), 0.6],
            [panel('watch'), 0.2],
            [panel('breakpoints'), 0.2],
          ),
          0.56,
        ],
      ),
      0.9,
    ],
  )
  return {
    root: split(
      'column',
      [
        split(
          'row',
          [panel('library'), 0.13],
          [split('column', [panel('source'), 0.8], [panel('problems'), 0.2]), 0.41],
          [machine, 0.46],
        ),
        0.74,
      ],
      [split('row', [panel('arena'), 0.72], [panel('trace'), 0.28]), 0.26],
    ),
    hidden: [] as string[],
  }
})()

describe('bot versions', () => {
  beforeEach(async () => {
    await clearLocalBots()
    await clearVersions()
  })

  it('keeps each save, newest first, and skips one that changed nothing', async () => {
    await addVersion('b1', { name: 'dwarf', source: 'v1' }, 1)
    await addVersion('b1', { name: 'dwarf', source: 'v2' }, 2)
    await addVersion('b1', { name: 'dwarf', source: 'v2' }, 3)
    await addVersion('b1', { name: 'dwarf 2', source: 'v2' }, 4)
    expect((await listVersions('b1')).map((v) => [v.at, v.name, v.source])).toEqual([
      [4, 'dwarf 2', 'v2'],
      [2, 'dwarf', 'v2'],
      [1, 'dwarf', 'v1'],
    ])
    expect(await listVersions('b2')).toEqual([])
  })

  it('keeps the newest MAX_VERSIONS', async () => {
    for (let n = 0; n < MAX_VERSIONS + 5; n++) {
      await addVersion('b1', { name: 'x', source: `v${n}` }, n)
    }
    const list = await listVersions('b1')
    expect(list).toHaveLength(MAX_VERSIONS)
    expect(list[0]?.source).toBe(`v${MAX_VERSIONS + 4}`)
    expect(list.at(-1)?.source).toBe('v5')
  })

  it('goes with its bot', async () => {
    const bot = await saveLocalBot({ name: 'x', source: 'nop' })
    await addVersion(bot.id, { name: 'x', source: 'nop' })
    await deleteLocalBot(bot.id)
    expect(await listVersions(bot.id)).toEqual([])
    const other = await saveLocalBot({ name: 'y', source: 'nop' })
    await addVersion(other.id, { name: 'y', source: 'nop' })
    await clearLocalBots()
    expect(await listVersions(other.id)).toEqual([])
  })
})
