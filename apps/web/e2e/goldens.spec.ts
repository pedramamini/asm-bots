/**
 * The goldens in Chromium, the browser leg of CI's determinism matrix (PRODUCT_SPEC §11, ISA
 * §5.6): the harness page plays every golden round in a module Worker, from the roster's sources,
 * and the results must be `packages/bots/goldens/results.json`, hash for hash. `bun run golden`
 * checks the same file in Bun and `apps/api/test/goldens.test.ts` in workerd, so the three hash
 * sets are one.
 *
 * The page imports the roster by its source path, which only the dev server serves: DEV_URL says
 * where it listens (default: Vite's http://localhost:5173).
 */
import { expect, test } from '@playwright/test'
import RESULTS from '../../../packages/bots/goldens/results.json' with { type: 'json' }
// `window.goldens`, typed.
import type {} from './harness/goldens'

test.use({ baseURL: process.env.DEV_URL ?? 'http://localhost:5173' })

test('a Chromium Worker plays every golden to results.json, hash for hash', async ({ page }) => {
  test.setTimeout(60_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.goto('/e2e/harness/goldens.html')
  await page.waitForFunction(() => window.goldens !== undefined)
  const got = await page.evaluate(() => window.goldens)
  expect(got).toHaveLength(RESULTS.length)
  expect(got).toEqual(RESULTS)
  expect(errors).toEqual([])
})
