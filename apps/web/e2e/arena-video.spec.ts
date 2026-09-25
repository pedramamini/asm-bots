/**
 * The arena's video (`battle/video.ts`) in Chromium, against the production build: `export video`
 * records the round from cycle 0 to its end and saves it, and `v` records and saves what plays. An
 * MP4 where the browser records one (Chrome on a Mac), else a WebM (a Chromium without H.264): the
 * files are checked for their container's header, and for more than a still frame's bytes.
 */
import { readFile } from 'node:fs/promises'
import { type Download, expect, type Page, test } from '@playwright/test'
import { pickShare } from './share'

const victory = (page: Page) => page.locator('section[data-result-hash]')
const arena = (page: Page) => page.getByRole('application', { name: 'arena' })

/** The bytes of `download`, once saved. */
async function bytesOf(download: Download): Promise<Buffer> {
  const path = await download.path()
  return readFile(path)
}

/** An MP4 starts with its `ftyp` box (four bytes of size, then the type); a WebM with EBML's id. */
function isVideo(name: string, bytes: Buffer): boolean {
  if (name.endsWith('.mp4')) return bytes.subarray(4, 8).toString('latin1') === 'ftyp'
  return name.endsWith('.webm') && bytes.readUInt32BE(0) === 0x1a45dfa3
}
const FILE = /^asmbots-dwarf-imp-1\.(mp4|webm)$/

test.beforeEach(async ({ page }) => {
  await page.goto('/arena?b=roster:dwarf,roster:imp&seed=1')
  await page.locator('button[name="fight"]').click()
  await expect(arena(page)).toBeVisible()
})

test('export video records the round from its start to its end', async ({ page }) => {
  await page.getByRole('button', { name: 'max speed' }).click()
  await expect(victory(page)).toBeVisible({ timeout: 30_000 })
  const saved = page.waitForEvent('download', { timeout: 60_000 })
  await pickShare(page, victory(page), 'export video')
  await expect(page.getByRole('status', { name: 'recording video' })).toBeVisible()
  const download = await saved
  expect(download.suggestedFilename()).toMatch(FILE)
  const bytes = await bytesOf(download)
  expect(isVideo(download.suggestedFilename(), bytes)).toBe(true)
  expect(bytes.length).toBeGreaterThan(20_000)
  await expect(page.getByRole('status', { name: 'recording video' })).toBeHidden()
})

test('v records what plays, and v again saves it', async ({ page }) => {
  await page.keyboard.press('v')
  await expect(page.getByRole('status', { name: 'recording video' })).toContainText('rec 0:0')
  await page.keyboard.press('Space')
  await page.waitForTimeout(1500)
  const saved = page.waitForEvent('download')
  await page.keyboard.press('v')
  const download = await saved
  expect(download.suggestedFilename()).toMatch(FILE)
  expect(isVideo(download.suggestedFilename(), await bytesOf(download))).toBe(true)
})
