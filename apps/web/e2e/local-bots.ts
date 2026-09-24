/** The browser's local bots (IndexedDB, `src/store/local-bots.ts`), written from a spec. */
import type { Page } from '@playwright/test'

/** Writes bots straight into the app's IndexedDB store (idb-keyval: key = id, value = bot). */
export async function seedBots(
  page: Page,
  bots: { id: string; name: string; source: string; updatedAt: number }[],
): Promise<void> {
  await page.evaluate(
    (list) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('asmbots')
        open.onupgradeneeded = () => open.result.createObjectStore('local-bots')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const tx = open.result.transaction('local-bots', 'readwrite')
          for (const bot of list) tx.objectStore('local-bots').put(bot, bot.id)
          tx.oncomplete = () => {
            open.result.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
      }),
    bots,
  )
}
