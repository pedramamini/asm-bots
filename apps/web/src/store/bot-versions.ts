/**
 * The saves of each local bot, for the editor's `versions` (PRODUCT_SPEC §3): the last
 * `MAX_VERSIONS` of them, the newest first, in their own IndexedDB database beside the bots, so
 * listing the bots never reads their histories.
 */
import { useQuery } from '@tanstack/react-query'
import { clear, createStore, del, get, set, type UseStore } from 'idb-keyval'

/** One save of a bot. */
export interface BotVersion {
  /** When it was saved, ms since the epoch. */
  readonly at: number
  readonly name: string
  readonly source: string
}

/** The most saves a bot keeps. */
export const MAX_VERSIONS = 20

/** The IndexedDB database and object store of the versions: a list per bot id. */
export const VERSIONS_DB = 'asmbots-versions'
export const VERSIONS_STORE = 'versions'

/** The query key of a bot's versions. */
export function versionsKey(id: string) {
  return ['bot-versions', id] as const
}

let store: UseStore | undefined
function versionStore(): UseStore {
  store ??= createStore(VERSIONS_DB, VERSIONS_STORE)
  return store
}

/** The saves of bot `id`, the newest first. */
export async function listVersions(id: string): Promise<BotVersion[]> {
  return (await get<BotVersion[]>(id, versionStore())) ?? []
}

/**
 * Adds a save of bot `id`, unless it has the text and the name of the newest one. Keeps the
 * newest `MAX_VERSIONS`. Returns the list as it now is.
 */
export async function addVersion(
  id: string,
  version: { name: string; source: string },
  at: number = Date.now(),
): Promise<BotVersion[]> {
  const list = await listVersions(id)
  const newest = list[0]
  if (newest?.source === version.source && newest.name === version.name) return list
  const next = [{ at, name: version.name, source: version.source }, ...list].slice(0, MAX_VERSIONS)
  await set(id, next, versionStore())
  return next
}

export function deleteVersions(id: string): Promise<void> {
  return del(id, versionStore())
}

export function clearVersions(): Promise<void> {
  return clear(versionStore())
}

/** The saves of bot `id`, through the query cache; nothing for null. */
export function useBotVersions(id: string | null) {
  return useQuery({
    queryKey: versionsKey(id ?? ''),
    queryFn: () => (id === null ? [] : listVersions(id)),
    enabled: id !== null,
    staleTime: Number.POSITIVE_INFINITY,
  })
}
