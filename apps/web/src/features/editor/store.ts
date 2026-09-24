/**
 * What the editor keeps between visits, in `localStorage[EDITOR_STORAGE_KEY]`: its switches (the
 * listing gutter, the bot library, the lint warnings), the documents opened lately, and the text
 * of each document not saved yet (a draft), so a reload never loses a keystroke.
 */
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { isRecord, localStore } from '../../store/settings'

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
  /** The bot library shows (`b`). */
  library: boolean
  /** Lint warnings show beside the errors. */
  lint: boolean
  /** The keys of the documents opened lately (`docKey`), the latest first. */
  recent: string[]
  /** Unsaved text by document key. */
  drafts: Record<string, Draft>
}

export interface EditorPrefsState extends EditorPrefs {
  toggleListing: () => void
  toggleLibrary: () => void
  setLint: (lint: boolean) => void
  /** Puts `key` first in `recent`. */
  visit: (key: string) => void
  /** Keeps `draft` for `key`, or drops the draft with null. */
  setDraft: (key: string, draft: Draft | null) => void
}

export const DEFAULT_EDITOR_PREFS: Readonly<EditorPrefs> = Object.freeze({
  listing: true,
  library: true,
  lint: true,
  recent: [],
  drafts: {},
})

export const useEditorPrefs = create<EditorPrefsState>()(
  persist(
    (set) => ({
      ...structuredClone(DEFAULT_EDITOR_PREFS as EditorPrefs),
      toggleListing: () => set((state) => ({ listing: !state.listing })),
      toggleLibrary: () => set((state) => ({ library: !state.library })),
      setLint: (lint) => set({ lint }),
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
      partialize: ({ listing, library, lint, recent, drafts }): EditorPrefs => ({
        listing,
        library,
        lint,
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
  for (const key of ['listing', 'library', 'lint'] as const) {
    if (typeof stored[key] === 'boolean') out[key] = stored[key]
  }
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
