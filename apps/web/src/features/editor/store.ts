/**
 * What the editor keeps between visits, in `localStorage[EDITOR_STORAGE_KEY]`: its switches (the
 * listing gutter, the lint warnings), the layout of its panels (`layout/tree.ts`), a wide
 * window's and a phone's, each as the user left it, the debugger's preferences, the documents
 * opened lately, and the text of each document not saved yet (a draft), so a reload never loses a
 * keystroke.
 */
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { isRecord, localStore } from '../../store/settings'
import { SEED } from '../arena/setup/config'
import { MAX_CYCLES_PER_FRAME, type Speed } from '../arena/worker/protocol'
import {
  DEFAULT_LAYOUT,
  type Layout,
  type LayoutNode,
  type PanelId,
  PRESETS,
  type PresetId,
  sanitizeLayout,
  setHidden,
} from './layout/tree'

export const EDITOR_STORAGE_KEY = 'asmbots:editor'

/**
 * The store's version. 2: the writing layout is the default. A layout kept from before that is the
 * old default, untouched, starts over as it; one the user made stays as they made it.
 */
export const EDITOR_PREFS_VERSION = 2

/** The debugger's preferences: how it runs, what it follows, and what it loads. */
export interface DebugPrefs {
  /** Cycles a run runs per display frame, or `max`. */
  readonly speed: Speed
  /** The count `run N cycles` runs. */
  readonly runCycles: number
  /** The arena strip stays zoomed on the followed process. */
  readonly lockIp: boolean
  /** The opponents, as bot refs (`roster:imp`), in order. */
  readonly opponents: readonly string[]
  /** The placement seed. */
  readonly seed: number
}

export const DEFAULT_DEBUG_PREFS: DebugPrefs = Object.freeze({
  speed: 'max',
  runCycles: 1000,
  lockIp: true,
  opponents: [],
  seed: 1,
})

/** The most documents the library's `recent` lists. */
export const MAX_RECENT = 8

/** The most drafts kept: past it, the oldest goes. */
export const MAX_DRAFTS = 16

/** A document's text as the user left it, not saved. */
export interface Draft {
  readonly source: string
  /** The name typed in the toolbar. */
  readonly name: string
  /** When it was written, ms since the epoch. */
  readonly at: number
}

/** What the editor persists. */
export interface EditorPrefs {
  /** The listing gutter shows (`l`). */
  listing: boolean
  /** Lint warnings show beside the errors. */
  lint: boolean
  /** Where each panel sits, its size, and which are hidden (the library: `b`). */
  layout: Layout
  /** The same, under `md`: a phone's one column. */
  phoneLayout: Layout
  debug: DebugPrefs
  /** The keys of the documents opened lately (`docKey`), the latest first. */
  recent: string[]
  /** Unsaved text by document key. */
  drafts: Record<string, Draft>
}

export interface EditorPrefsState extends EditorPrefs {
  toggleListing: () => void
  toggleLibrary: () => void
  setLint: (lint: boolean) => void
  setLayout: (layout: Layout) => void
  setPhoneLayout: (layout: Layout) => void
  setDebug: (debug: Partial<DebugPrefs>) => void
  /** Hides or shows panel `id`, in its place. */
  setPanelHidden: (id: PanelId, hide: boolean) => void
  /** Puts the panels as the preset has them. */
  applyPreset: (preset: PresetId) => void
  /** Puts `key` first in `recent`. */
  visit: (key: string) => void
  /** Keeps `draft` for `key`, or drops the draft with null. */
  setDraft: (key: string, draft: Draft | null) => void
}

export const DEFAULT_EDITOR_PREFS: Readonly<EditorPrefs> = Object.freeze({
  listing: true,
  lint: true,
  layout: DEFAULT_LAYOUT,
  phoneLayout: PRESETS.phone(),
  debug: DEFAULT_DEBUG_PREFS,
  recent: [],
  drafts: {},
})

export const useEditorPrefs = create<EditorPrefsState>()(
  persist(
    (set) => ({
      ...structuredClone(DEFAULT_EDITOR_PREFS as EditorPrefs),
      toggleListing: () => set((state) => ({ listing: !state.listing })),
      toggleLibrary: () =>
        set(({ layout }) => ({
          layout: setHidden(layout, 'library', !layout.hidden.includes('library')),
        })),
      setLint: (lint) => set({ lint }),
      setLayout: (layout) => set({ layout }),
      setPhoneLayout: (phoneLayout) => set({ phoneLayout }),
      setDebug: (debug) => set((state) => ({ debug: { ...state.debug, ...debug } })),
      setPanelHidden: (id, hide) => set(({ layout }) => ({ layout: setHidden(layout, id, hide) })),
      applyPreset: (preset) => set({ layout: PRESETS[preset]() }),
      visit: (key) =>
        set((state) =>
          state.recent[0] === key
            ? state
            : { recent: [key, ...state.recent.filter((k) => k !== key)].slice(0, MAX_RECENT) },
        ),
      setDraft: (key, draft) =>
        set((state) => {
          const drafts = { ...state.drafts }
          if (draft === null) {
            if (!(key in drafts)) return state
            delete drafts[key]
            return { drafts }
          }
          drafts[key] = draft
          return { drafts: newestDrafts(drafts) }
        }),
    }),
    {
      name: EDITOR_STORAGE_KEY,
      version: EDITOR_PREFS_VERSION,
      // `merge` reads what this returns as it reads any stored value: field by field.
      migrate: (stored, version) => migrateEditorPrefs(stored, version) as EditorPrefsState,
      storage: createJSONStorage(() => localStore),
      partialize: ({ listing, lint, layout, phoneLayout, debug, recent, drafts }): EditorPrefs => ({
        listing,
        lint,
        layout,
        phoneLayout,
        debug,
        recent,
        drafts,
      }),
      merge: (stored, current) => ({ ...current, ...sanitizeEditorPrefs(stored) }),
    },
  ),
)

/**
 * Stored prefs of `version` as this version reads them. Before 2, a layout that is the old default
 * as it came (every panel shown, no divider moved) goes, so the writing layout takes its place.
 */
export function migrateEditorPrefs(stored: unknown, version: number): unknown {
  if (version >= 2 || !isRecord(stored) || !isOldDefault(stored.layout)) return stored
  const { layout: _old, ...rest } = stored
  return rest
}

/** A layout as nested literals: a panel, or a split's direction and its `[child, weight]` parts. */
type Shape = PanelId | SplitShape
interface SplitShape extends ReadonlyArray<'row' | 'column' | Part> {
  readonly 0: 'row' | 'column'
}
type Part = readonly [Shape, number]

/** The default layout before version 2: the library, the source, and the debugger, all shown. */
const OLD_DEFAULT: Shape = [
  'column',
  [
    [
      'row',
      ['library', 0.13],
      [['column', ['source', 0.8], ['problems', 0.2]], 0.41],
      [
        [
          'column',
          ['debug', 0.1],
          [
            [
              'row',
              [['column', ['registers', 0.3], ['processes', 0.7]], 0.44],
              [['column', ['memory', 0.6], ['watch', 0.2], ['breakpoints', 0.2]], 0.56],
            ],
            0.9,
          ],
        ],
        0.46,
      ],
    ],
    0.74,
  ],
  [['row', ['arena', 0.72], ['trace', 0.28]], 0.26],
]

/** Whether a stored layout is `OLD_DEFAULT`, its weights as it made them, and hides nothing. */
function isOldDefault(stored: unknown): boolean {
  const layout = sanitizeLayout(stored)
  if (layout === null || !isRecord(stored) || !Array.isArray(stored.hidden)) return false
  if (stored.hidden.length > 0) return false
  const same = (node: LayoutNode, shape: Shape): boolean => {
    if (typeof shape === 'string') return node.kind === 'panel' && node.id === shape
    const [dir, ...rest] = shape
    const parts = rest as readonly Part[]
    if (node.kind !== 'split' || node.dir !== dir || node.children.length !== parts.length) {
      return false
    }
    const sum = parts.reduce((total, [, weight]) => total + weight, 0)
    return parts.every(
      ([child, weight], i) =>
        Math.abs((node.weights[i] ?? 0) - weight / sum) < 1e-6 &&
        same(node.children[i] as LayoutNode, child),
    )
  }
  // `sanitizeLayout` adds the panels the old layout lacks (the help) at the end of the root.
  const root = layout.root
  if (root.kind !== 'split') return false
  const kept = root.children.length - 1
  if (panelOf(root.children[kept]) !== 'help') return false
  const weights = root.weights.slice(0, kept)
  const total = weights.reduce((a, b) => a + b, 0)
  return same(
    { ...root, children: root.children.slice(0, kept), weights: weights.map((w) => w / total) },
    OLD_DEFAULT,
  )
}

const panelOf = (node: LayoutNode | undefined) => (node?.kind === 'panel' ? node.id : null)

/** Stored debugger preferences, each field that is well formed over the defaults; null for none. */
export function sanitizeDebugPrefs(stored: unknown): DebugPrefs | null {
  if (!isRecord(stored)) return null
  const count = (value: unknown, least: number, most: number) =>
    typeof value === 'number' && Number.isInteger(value) && value >= least && value <= most
      ? value
      : null
  const flag = (value: unknown) => (typeof value === 'boolean' ? value : null)
  const d = DEFAULT_DEBUG_PREFS
  return {
    speed:
      stored.speed === 'max' ? 'max' : (count(stored.speed, 1, MAX_CYCLES_PER_FRAME) ?? d.speed),
    runCycles: count(stored.runCycles, 1, Number.MAX_SAFE_INTEGER) ?? d.runCycles,
    lockIp: flag(stored.lockIp) ?? d.lockIp,
    opponents: Array.isArray(stored.opponents)
      ? stored.opponents.filter((r): r is string => typeof r === 'string')
      : d.opponents,
    seed: count(stored.seed, SEED.min, SEED.max) ?? d.seed,
  }
}

/** `drafts` without the oldest past `MAX_DRAFTS`. */
function newestDrafts(drafts: Record<string, Draft>): Record<string, Draft> {
  const entries = Object.entries(drafts)
  if (entries.length <= MAX_DRAFTS) return drafts
  entries.sort(([, a], [, b]) => b.at - a.at)
  return Object.fromEntries(entries.slice(0, MAX_DRAFTS))
}

/** The well-formed fields of stored editor prefs; storage is the user's to edit. */
export function sanitizeEditorPrefs(stored: unknown): Partial<EditorPrefs> {
  if (!isRecord(stored)) return {}
  const out: Partial<EditorPrefs> = {}
  for (const key of ['listing', 'lint'] as const) {
    if (typeof stored[key] === 'boolean') out[key] = stored[key]
  }
  const layout = sanitizeLayout(stored.layout) ?? legacyLayout(stored)
  if (layout !== null) out.layout = layout
  const phone = sanitizeLayout(stored.phoneLayout)
  if (phone !== null) out.phoneLayout = phone
  const debug = sanitizeDebugPrefs(stored.debug)
  if (debug !== null) out.debug = debug
  if (Array.isArray(stored.recent)) {
    out.recent = [
      ...new Set(stored.recent.filter((k): k is string => typeof k === 'string')),
    ].slice(0, MAX_RECENT)
  }
  if (isRecord(stored.drafts)) {
    const drafts: Record<string, Draft> = {}
    for (const [key, draft] of Object.entries(stored.drafts)) {
      if (
        isRecord(draft) &&
        typeof draft.source === 'string' &&
        typeof draft.name === 'string' &&
        typeof draft.at === 'number'
      ) {
        drafts[key] = { source: draft.source, name: draft.name, at: draft.at }
      }
    }
    out.drafts = newestDrafts(drafts)
  }
  return out
}

/** The layout of a store from before layouts: its `library` and `strip` switches, or null. */
function legacyLayout(stored: Record<string, unknown>): Layout | null {
  const off = (
    [
      ['library', 'library'],
      ['strip', 'arena'],
    ] as const
  ).filter(([key]) => stored[key] === false)
  if (off.length === 0) return null
  return off.reduce((layout, [, id]) => setHidden(layout, id, true), PRESETS.writing())
}
