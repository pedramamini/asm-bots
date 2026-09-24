/**
 * The first sign-in (PRODUCT_SPEC §9) against the Worker (`wrangler dev` with `DEV_FAKE_AUTH`, see
 * playwright.config.ts): sign in from the header, pick a handle, import two local bots, and find
 * them on the profile.
 */
import { expect, type Page, test } from '@playwright/test'
import { WORKER } from '../playwright.config'
import { seedBots } from './local-bots'

test.use({ baseURL: WORKER })

/** The page's errors and console errors, as they come. */
function watch(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  return errors
}

test('signs in, picks a handle, imports two local bots, and shows them on the profile', async ({
  page,
}) => {
  const errors = watch(page)
  // A login of its own, so a reused Worker's earlier runs do not get in the way.
  const login = `e2e-${Date.now().toString(36)}`
  const handle = `${login}-x`
  await page.route('**/api/auth/github?*', (route) =>
    route.continue({ url: `${route.request().url()}&as=${login}` }),
  )

  await page.goto('/settings')
  await seedBots(page, [
    { id: 'l1', name: 'spinner', source: '%name "Spinner"\nstart: jmp $\n', updatedAt: 2 },
    { id: 'l2', name: 'napper', source: '%name "Napper"\nstart: nop\n jmp start\n', updatedAt: 1 },
  ])
  await page.reload()

  await page.getByRole('button', { name: 'sign in with github' }).first().click()
  await expect(page).toHaveURL(`${WORKER}/settings`)

  const pick = page.getByRole('dialog', { name: 'pick a handle' })
  const field = pick.getByRole('textbox', { name: 'handle' })
  await expect(field).toHaveValue(login)
  await field.fill(handle)
  await pick.getByRole('button', { name: 'continue' }).click()

  const offer = page.getByRole('dialog', { name: 'import your bots' })
  await expect(offer).toContainText('import 2 local bots to your account?')
  await offer.getByRole('button', { name: 'import 2' }).click()
  await expect(page.getByText('imported 2 bots.')).toBeVisible()
  await expect(offer).toBeHidden()

  await expect(page.getByRole('region', { name: 'account' })).toContainText(`signed in: ${handle}`)
  await page.getByRole('button', { name: `account: ${handle}` }).click()
  await page.getByRole('menuitem', { name: 'profile' }).click()
  await expect(page).toHaveURL(`${WORKER}/u/${handle}`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(handle)
  const bots = page.getByRole('table', { name: 'bots' })
  await expect(bots.getByRole('link', { name: 'spinner' })).toBeVisible()
  await expect(bots.getByRole('link', { name: 'napper' })).toBeVisible()

  // Signed in again later, the dialog does not come back.
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(handle)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(errors).toEqual([])
})
