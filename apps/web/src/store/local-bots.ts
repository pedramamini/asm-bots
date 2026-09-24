import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { clear, createStore, del, get, set, type UseStore, values } from 'idb-keyval'
import { clearVersions, deleteVersions } from './bot-versions'

/** A bot that lives in this browser only: an anonymous user's, until they sign in (PRODUCT_SPEC §9). */
export interface LocalBot {
  id: string
  name: string
  /** The assembly source, as the user wrote it. */
  source: string
  /** Last save, ms since the epoch. */
  updatedAt: number
  /** The account bot it was imported to (PRODUCT_SPEC §9): synced. Unset for a local-only bot. */
  cloudId?: string | undefined
}

/** The IndexedDB database and object store of the local bots. */
export const LOCAL_BOTS_DB = 'asmbots'
export const LOCAL_BOTS_STORE = 'local-bots'

/** The query key of the local bot list. */
export const LOCAL_BOTS_KEY = ['local-bots'] as const

/** The earliest time a zip entry can carry (DOS dates start in 1980); fflate throws before it. */
const ZIP_EPOCH = Date.UTC(1980, 0, 2)

let store: UseStore | undefined
/** Opened on first use, so a page that never touches local bots never opens the database. */
function botStore(): UseStore {
  store ??= createStore(LOCAL_BOTS_DB, LOCAL_BOTS_STORE)
  return store
}

/** Every local bot, the latest save first. */
export async function listLocalBots(): Promise<LocalBot[]> {
  const bots = await values<LocalBot>(botStore())
  return bots.sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name))
}

export function getLocalBot(id: string): Promise<LocalBot | undefined> {
  return get<LocalBot>(id, botStore())
}

/**
 * Creates a bot (no `id`) or overwrites one, stamped now. An overwrite keeps its `cloudId` unless
 * the bot names another.
 */
export async function saveLocalBot(bot: {
  id?: string | undefined
  name: string
  source: string
  cloudId?: string | undefined
}): Promise<LocalBot> {
  const cloudId =
    bot.cloudId ?? (bot.id === undefined ? undefined : (await getLocalBot(bot.id))?.cloudId)
  const saved: LocalBot = {
    id: bot.id ?? crypto.randomUUID(),
    name: bot.name,
    source: bot.source,
    updatedAt: Date.now(),
    ...(cloudId !== undefined && { cloudId }),
  }
  await set(saved.id, saved, botStore())
  return saved
}

/** Marks local bots synced: each local id to the account bot it was imported to. */
export async function markLocalBotsSynced(cloudIds: ReadonlyMap<string, string>): Promise<void> {
  for (const [id, cloudId] of cloudIds) {
    const bot = await getLocalBot(id)
    if (bot !== undefined) await set(id, { ...bot, cloudId }, botStore())
  }
}

/** Forgets every local bot's link to the account (a deleted account): each is local only again. */
export async function unlinkLocalBots(): Promise<void> {
  for (const bot of await listLocalBots()) {
    if (bot.cloudId === undefined) continue
    const { cloudId: _, ...local } = bot
    await set(bot.id, local, botStore())
  }
}

/** Deletes a bot and its saved versions. */
export async function deleteLocalBot(id: string): Promise<void> {
  await del(id, botStore())
  await deleteVersions(id)
}

/** Deletes every bot and every saved version. */
export async function clearLocalBots(): Promise<void> {
  await clear(botStore())
  await clearVersions()
}

/** A zip of the bots: one `<name>.asm` each, names made file-safe and unique. */
export function botsToZip(bots: readonly LocalBot[]): Uint8Array {
  const taken = new Set<string>()
  const files: Record<string, [Uint8Array, { mtime: Date }]> = {}
  for (const bot of bots) {
    const stem = fileStem(bot.name)
    let file = `${stem}.asm`
    for (let n = 2; taken.has(file); n++) file = `${stem}-${n}.asm`
    taken.add(file)
    files[file] = [strToU8(bot.source), { mtime: new Date(Math.max(bot.updatedAt, ZIP_EPOCH)) }]
  }
  return zipSync(files, { level: 6 })
}

/** The `.asm` files of a zip, at any depth, as new bots named after their files. */
export function botsFromZip(zip: Uint8Array): { name: string; source: string }[] {
  const files = unzipSync(zip, { filter: (file) => /\.asm$/i.test(file.name) })
  return Object.entries(files)
    .filter(([path]) => !path.split('/').some((part) => part.startsWith('.')))
    .map(([path, bytes]) => ({
      name: (path.split('/').pop() ?? path).replace(/\.asm$/i, ''),
      source: strFromU8(bytes),
    }))
}

/** Saves each `.asm` of a zip as a new local bot. */
export async function importLocalBots(zip: Uint8Array): Promise<LocalBot[]> {
  const saved: LocalBot[] = []
  for (const bot of botsFromZip(zip)) saved.push(await saveLocalBot(bot))
  return saved
}

/** A bot name as a file name: lowercase, `[a-z0-9._-]`, `bot` when nothing is left. */
function fileStem(name: string): string {
  const stem = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-.]+|-+$/g, '')
  return stem === '' ? 'bot' : stem
}

/** The local bots, through the query cache. */
export function useLocalBots() {
  return useQuery({ queryKey: LOCAL_BOTS_KEY, queryFn: listLocalBots, staleTime: Infinity })
}

/** The mutations of the local bots; each refreshes `useLocalBots`. */
export function useLocalBotActions() {
  const client = useQueryClient()
  const onSuccess = () => client.invalidateQueries({ queryKey: LOCAL_BOTS_KEY })
  return {
    save: useMutation({ mutationFn: saveLocalBot, onSuccess }),
    remove: useMutation({ mutationFn: deleteLocalBot, onSuccess }),
    importZip: useMutation({ mutationFn: importLocalBots, onSuccess }),
    clear: useMutation({ mutationFn: clearLocalBots, onSuccess }),
  }
}
