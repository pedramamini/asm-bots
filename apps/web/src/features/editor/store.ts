/**
 * What the editor keeps between visits, in `localStorage[EDITOR_STORAGE_KEY]`: its switches (the
 * listing gutter, the lint warnings), the layout of its panels (`layout/tree.ts`), the documents
 * opened lately, and the text of each document not saved yet (a draft), so a reload never loses a
 * keystroke.
 */
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { isRecord, localStore } from '../../store/settings'
import {
  DEFAULT_LAYOUT,
  type Layout,
  type PanelId,
  PRESETS,
  type PresetId,
  sanitizeLayout,
  setHidden,
} from './layout/tree'

export const EDITOR_STORAGE_KEY = 'asmbots:editor'

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
      version: 1,
      storage: createJSONStorage(() => localStore),
      partialize: ({ listing, lint, layout, recent, drafts }): EditorPrefs => ({
        listing,
        lint,
        layout,
        recent,
        drafts,
      }),
      merge: (stored, current) => ({ ...current, ...sanitizeEditorPrefs(stored) }),
    },
  ),
)

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
  return off.reduce((layout, [, id]) => setHidden(layout, id, true), PRESETS.default())
}
