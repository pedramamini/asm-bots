/**
 * The servers Lighthouse CI measures (`lighthouserc.json` at the repo root, `startServerCommand`):
 * the seeded e2e Worker (`WORKER_COMMAND` of playwright.config.ts: `wrangler dev` on :8788, its
 * storage migrated and seeded) and `vite preview` of the build on :4173, its `/api` on that Worker,
 * as the e2e suite runs them. The build must exist (`bun run lighthouse` makes it). Prints
 * `lighthouse: servers ready` once both answer, and stops both when it is stopped.
 */
import { type ChildProcess, spawn } from 'node:child_process'
import { WORKER, WORKER_COMMAND } from '../playwright.config'

const PREVIEW = 'http://localhost:4173'
const APP = new URL('..', import.meta.url).pathname

/** Each in a process group of its own, so a stop reaches `wrangler dev`'s workerd too. */
const start = (command: string, env: Record<string, string> = {}): ChildProcess =>
  spawn('sh', ['-c', command], {
    cwd: APP,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'inherit', 'inherit'],
    detached: true,
  })

const servers = [start(WORKER_COMMAND), start('bun run preview', { API_ORIGIN: WORKER })]

const stop = (code = 0) => {
  for (const server of servers) {
    if (server.pid !== undefined) {
      try {
        process.kill(-server.pid, 'SIGTERM')
      } catch {
        // Gone already.
      }
    }
  }
  process.exit(code)
}
process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())

/** Resolves once `url` answers 200, or throws after `ms`. */
async function up(url: string, ms = 120_000): Promise<void> {
  const until = Date.now() + ms
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      // Not listening yet.
    }
    await Bun.sleep(500)
  }
  throw new Error(`lighthouse: ${url} did not answer in ${ms / 1000} s`)
}

try {
  await Promise.all([up(`${WORKER}/api/health`), up(`${PREVIEW}/hills/main`)])
  console.log('lighthouse: servers ready')
} catch (e) {
  console.error(e instanceof Error ? e.message : e)
  stop(1)
}
