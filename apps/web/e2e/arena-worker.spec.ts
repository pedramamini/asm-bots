/**
 * The arena Worker in Chromium, as Vite serves it: the page imports `ArenaClient`, which starts
 * `arena.worker.ts` as a module Worker, and the frames come back with their arrays transferred.
 * `test/arena-worker.test.ts` runs the same checks in Bun's Worker.
 *
 * The page imports `client.ts` by its source path, which only the dev server serves, so the spec
 * runs there: DEV_URL says where it listens (default: Vite's http://localhost:5173).
 * `arena-setup.spec.ts` starts the build's Worker through `/arena`.
 */
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

test.use({ baseURL: process.env.DEV_URL ?? 'http://localhost:5173' })

const APP = fileURLToPath(new URL('..', import.meta.url))

interface Fixture {
  bots: { name: string; bytes: number[] }[]
  /** `simulate` of the bots at seed 1: the cycles it ran and its result hash. */
  cycles: number
  hash: string
}

/**
 * Dwarf and Paper, assembled by Bun, and their battle at seed 1. The roster imports its sources
 * as text (`with { type: 'text' }`), which Node, and so this runner, cannot load.
 */
function fixture(): Fixture {
  const script = `
    import { fighter } from '@asmbots/bots'
    import { resultHash, simulate } from '@asmbots/engine'
    const bots = ['dwarf', 'paper'].map(fighter)
    const result = simulate(bots, { seed: 1 })
    console.log(JSON.stringify({
      bots: bots.map((b) => ({ name: b.name, bytes: Array.from(b.bytes) })),
      cycles: result.cycles,
      hash: resultHash(result),
    }))`
  return JSON.parse(execFileSync('bun', ['--eval', script], { cwd: APP, encoding: 'utf8' }))
}

test('steps, seeks back, and plays to the end in a module Worker', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  const { bots, cycles, hash } = fixture()
  await page.goto('/')

  const got = await page.evaluate(async (bots) => {
    // Types stay behind in the Node runner: the page gets the module Vite serves.
    const client = '/src/features/arena/worker/client.ts'
    const { ArenaClient, createArenaStore } = await import(/* @vite-ignore */ client)
    const loaded = bots.map((b) => ({ name: b.name, bytes: new Uint8Array(b.bytes) }))
    // biome-ignore lint/suspicious/noExplicitAny: the module's types are not in the page.
    const frameAfter = (arena: any, request: () => void) => {
      const next = arena.once('frame')
      request()
      return next
    }
    const a = new ArenaClient({ store: createArenaStore() })
    await frameAfter(a, () => a.load(loaded, { seed: 1 }))
    const ten = await frameAfter(a, () => a.step(10))
    await frameAfter(a, () => a.step(5990))
    const back = await frameAfter(a, () => a.seek(5000))
    // A second battle run straight to 5,000; a seek to where it stands sends its whole core.
    const b = new ArenaClient({ store: createArenaStore() })
    await frameAfter(b, () => b.load(loaded, { seed: 1 }))
    await frameAfter(b, () => b.step(5000))
    const fresh = await frameAfter(b, () => b.seek(5000))
    const owners = (f: { ownerDirty: Uint8Array }) => Array.from(f.ownerDirty).join()

    a.speed('max')
    const ended = a.once('ended')
    a.play()
    const { result, hash } = await ended
    const status = a.store.getState().status
    a.dispose()
    b.dispose()
    return {
      ten: ten.cycle,
      arrays: [ten.writes, ten.execs, ten.ips, ten.deaths, ten.stats].map(
        (x) => x.constructor.name,
      ),
      back: back.cycle,
      sameOwners: owners(back) === owners(fresh),
      cycles: result.cycles,
      hash,
      status,
    }
  }, bots)

  expect(got).toEqual({
    ten: 10,
    arrays: ['Uint16Array', 'Uint16Array', 'Uint16Array', 'Uint32Array', 'Float32Array'],
    back: 5000,
    sameOwners: true,
    cycles,
    hash,
    status: 'ended',
  })
  expect(errors).toEqual([])
})
