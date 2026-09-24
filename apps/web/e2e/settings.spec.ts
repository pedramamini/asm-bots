/**
 * `/settings` against the production build: the settings survive a reload, and the local bots
 * (IndexedDB) go out as a zip and come back in.
 */
import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { strFromU8, unzipSync, zipSync } from 'fflate'
import { seedBots } from './local-bots'

test('settings survive a reload', async ({ page }) => {
  await page.goto('/settings')
  await page.getByRole('radio', { name: 'amber' }).click()
  await page.getByRole('button', { name: 'scanlines' }).click()
  await page.getByRole('radio', { name: 'reduce' }).click()
  await page.getByRole('button', { name: 'sound', exact: true }).click()
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'amber')
  await expect(page.getByRole('radio', { name: 'amber' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('button', { name: 'scanlines' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  await expect(page.getByRole('button', { name: 'bloom' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('radio', { name: 'reduce' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('button', { name: 'sound', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByRole('slider', { name: 'volume' })).toBeEnabled()
})

test('exports one .asm per local bot', async ({ page }) => {
  await page.goto('/settings')
  await seedBots(page, [
    { id: 'a', name: 'dwarf', source: 'mov ax, 1', updatedAt: 3 },
    { id: 'b', name: 'imp', source: 'jmp $', updatedAt: 2 },
    { id: 'c', name: 'Imp', source: 'nop', updatedAt: 1 },
  ])
  await page.reload()
  const data = page.getByRole('region', { name: 'data' })
  await expect(data).toContainText('3 local bots')
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    data.getByRole('button', { name: 'export zip' }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(/^asmbots-bots-\d{4}-\d{2}-\d{2}\.zip$/)
  const files = unzipSync(new Uint8Array(await readFile(await download.path())))
  expect(Object.keys(files).sort()).toEqual(['dwarf.asm', 'imp-2.asm', 'imp.asm'])
  expect(strFromU8(files['dwarf.asm'] as Uint8Array)).toBe('mov ax, 1')
})

test('imports a zip, then clears local data after the confirm', async ({ page }) => {
  await page.goto('/settings')
  const data = page.getByRole('region', { name: 'data' })
  await expect(data).toContainText('0 local bots')
  await expect(data.getByRole('button', { name: 'export zip' })).toBeDisabled()
  const zip = zipSync({ 'imp.asm': new TextEncoder().encode('jmp $') })
  await page.getByLabel('import zip', { exact: true }).setInputFiles({
    name: 'bots.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(zip),
  })
  await expect(data).toContainText('1 local bot')
  await expect(page.getByText('imported 1.')).toBeVisible()
  await data.getByRole('button', { name: 'clear local data' }).click()
  const dialog = page.getByRole('dialog', { name: 'clear local data' })
  await dialog.getByRole('button', { name: 'clear', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(data).toContainText('0 local bots')
  await page.reload()
  await expect(data).toContainText('0 local bots')
})
