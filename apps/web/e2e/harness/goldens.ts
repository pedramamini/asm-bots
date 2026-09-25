/**
 * The goldens in a Chromium module Worker, for `e2e/goldens.spec.ts`: the page posts every golden
 * matchup to `goldens.worker.ts`, which assembles the roster and plays each round, and
 * `window.goldens` settles to the results it posts back. Only the dev server serves it
 * (`/e2e/harness/goldens.html`); no build includes it.
 */
import { GOLDEN_MATCHUPS, type GoldenResult } from '@asmbots/bots'

const worker = new Worker(
  new URL('../../../../packages/bots/src/goldens.worker.ts', import.meta.url),
  { type: 'module' },
)

declare global {
  interface Window {
    goldens: Promise<GoldenResult[]>
  }
}

window.goldens = new Promise((resolve, reject) => {
  worker.onmessage = (e: MessageEvent<GoldenResult[]>) => resolve(e.data)
  worker.onerror = (e) => reject(new Error(`golden worker: ${e.message}`))
})
worker.postMessage(GOLDEN_MATCHUPS)
