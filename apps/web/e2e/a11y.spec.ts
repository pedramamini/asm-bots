/**
 * Accessibility (DESIGN_SYSTEM §8): axe over every route of the app and the states a user reaches
 * on them (a battle and its end, the debugger, a results matrix, the dialogs and menus, the signed
 * in hill page), in all five themes, with no violation of any rule axe runs by default: WCAG 2.2 A
 * and AA and axe's best practices. Against the Worker that serves the build and the API on one
 * origin as production does, seeded with the hills, the roster, and their replays. Keyboard-only
 * use and the focus ring are `keyboard.spec.ts` and `focus.spec.ts`.
 */
import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import { THEMES, type Theme } from '../../../packages/ui/src/themes'
import { WORKER } from '../playwright.config'

test.use({ baseURL: WORKER })

/**
 * Every violation on the page, one line each: rule, impact, target, and what axe says to fix. It
 * waits for the transitions under way first: a dialog 70% into its fade-in is not what users read.
 */
async function violations(page: Page): Promise<string[]> {
  // Two frames first: a dialog opened a moment ago starts its transition at the next style pass.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Number.POSITIVE_INFINITY)
        .map((a) => a.finished.catch(() => {})),
    ),
  )
  const { violations } = await new AxeBuilder({ page }).analyze()
  return violations.flatMap((v) =>
    v.nodes.map(
      (node) =>
        `${v.id} (${v.impact}) ${node.target.join(' ')}: ${(node.failureSummary ?? '').replace(/\s+/g, ' ')}`,
    ),
  )
}

/** The kit's tooltip opens this long after a key focuses its control (`TOOLTIP_DELAY`), ms. */
const TOOLTIP_DELAY = 400

/**
 * Runs axe and fails with every violation found, named by `where`. A state has just moved the
 * focus: a tooltip may be on its way, so the scan waits for it to open and fade in.
 */
async function expectClean(page: Page, where: string): Promise<void> {
  await page.waitForTimeout(TOOLTIP_DELAY + 50)
  expect(await violations(page), where).toEqual([])
}

/** A new page in `theme`, as a first visit: its coach marks show, as they would. */
async function themed(page: Page, theme: Theme): Promise<void> {
  await page.addInitScript((name) => {
    if (sessionStorage.getItem('themed') === null) {
      localStorage.setItem('theme', name)
      sessionStorage.setItem('themed', '1')
    }
  }, theme)
}

/** Goes to `path` and waits for it to draw: the title, the network quiet, a frame to settle. */
async function open(page: Page, path: string): Promise<void> {
  await page.goto(path)
  await expect(page).toHaveTitle(/^ASM BOTS/)
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {})
  // Nothing still loading: a skeleton or a radar would be scanned in place of the page.
  await expect(page.locator('[data-skeleton], [aria-label^="loading"]')).toHaveCount(0)
  await page.waitForTimeout(300)
}

/** The seeded data the routes show: a stored replay and the next weekly championship. */
async function seeded(page: Page): Promise<{ replay: string; tournament: string }> {
  const matches = await (await page.request.get('/api/hills/main/matches')).json()
  const tournaments = await (await page.request.get('/api/tournaments')).json()
  const replay = matches.matches.find(
    (m: { match: { replayKey: string | null } }) => m.match.replayKey,
  )?.match.replayKey
  const tournament = tournaments.tournaments[0]?.tournament.id
  expect(replay, 'a stored replay').toBeTruthy()
  expect(tournament, 'a championship').toBeTruthy()
  return { replay, tournament }
}

for (const theme of THEMES) {
  test.describe(theme, () => {
    test.beforeEach(async ({ page }) => themed(page, theme))

    test('every route', async ({ page }) => {
      test.setTimeout(180_000)
      const { replay, tournament } = await seeded(page)
      const routes = [
        '/',
        '/arena',
        `/arena/${replay}`,
        '/editor',
        '/editor/roster-dwarf',
        '/tournaments',
        `/tournaments/${tournament}`,
        '/hills',
        '/hills/main',
        '/hills/melee',
        '/bots/roster-dwarf',
        '/u/system',
        '/docs',
        '/settings',
        '/no/such/address',
        '/docs/no/such/page',
        '/embed/arena',
        '/embed/arena?b=roster:dwarf,roster:imp&seed=1',
        `/embed/arena/${replay}`,
      ]
      const found: string[] = []
      for (const path of routes) {
        await open(page, path)
        found.push(...(await violations(page)).map((line) => `${path}: ${line}`))
      }
      expect(found).toEqual([])
    })

    test('every docs page', async ({ page }) => {
      test.setTimeout(240_000)
      const manifest = await (await page.request.get('/meta/pages.json')).json()
      const docs = Object.keys(manifest.pages).filter((path) => path.startsWith('/docs/'))
      expect(docs.length).toBeGreaterThan(10)
      const found: string[] = []
      for (const path of docs) {
        await open(page, path)
        found.push(...(await violations(page)).map((line) => `${path}: ${line}`))
      }
      expect(found).toEqual([])
    })

    test('the arena in battle, its menus, and its end', async ({ page }) => {
      test.setTimeout(90_000)
      await open(page, '/arena?b=roster:dwarf,roster:imp&seed=1&cycles=20000')
      await page.locator('button[name="fight"]').click()
      const arena = page.getByRole('region', { name: 'arena' })
      await expect(arena.getByRole('button', { name: 'pause' })).toBeVisible()
      await page.keyboard.press('Space')
      await expect(arena.getByRole('button', { name: 'play' })).toBeVisible()
      await expectClean(page, 'battle, paused')
      await arena.getByRole('button', { name: 'share ▾' }).click()
      await expect(page.getByRole('menuitem', { name: 'copy link' })).toBeVisible()
      await expectClean(page, 'share menu')
      await page.keyboard.press('Escape')
      // To the end at the top speed: the victory.
      for (let i = 0; i < 12; i++) await page.keyboard.press(']')
      await arena.getByRole('button', { name: 'play' }).click()
      await expect(page.locator('[data-result-hash]')).toBeVisible({ timeout: 60_000 })
      await expectClean(page, 'victory')
    })

    test('the boot screen, and each step of the welcome tour', async ({ page }) => {
      // `?boot=1`: a driven browser skips the boot unless asked.
      await page.goto('/?boot=1')
      const boot = page.getByRole('dialog', { name: 'asm bots' })
      // Every line of the log is in the page from the start and fades in on its time: wait until
      // all of them are opaque, so axe does not read a line's contrast mid-fade.
      const log = boot.getByRole('list', { name: 'boot log' }).getByRole('listitem')
      await expect
        .poll(() =>
          log.evaluateAll((lines) => lines.every((l) => getComputedStyle(l).opacity === '1')),
        )
        .toBe(true)
      await expectClean(page, 'boot screen')
      await page.keyboard.press('Enter')
      const tour = page.getByRole('dialog', { name: 'the tour' })
      for (let step = 1; step <= 6; step++) {
        await expect(tour).toContainText(`${step} / 6`)
        await expectClean(page, `tour, step ${step}`)
        await page.keyboard.press('ArrowRight')
      }
    })

    test('the dialogs and menus of the frame', async ({ page }) => {
      await open(page, '/')
      await page.keyboard.press('?')
      await expect(page.getByRole('dialog', { name: 'keys' })).toBeVisible()
      await expectClean(page, 'key help')
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: 'pick a theme' }).click()
      await expect(page.getByRole('menuitem', { name: 'paper' })).toBeVisible()
      await expectClean(page, 'theme menu')
      await page.keyboard.press('Escape')
      await open(page, '/docs/start-here')
      await page.keyboard.press('/')
      await page.keyboard.type('imp')
      await expect(page.getByRole('searchbox').first()).toHaveValue('imp')
      await expectClean(page, 'docs search')
    })

    test('a local round robin, from its form to its matrix', async ({ page }) => {
      test.setTimeout(90_000)
      await page.route('**/api/tournaments', (route) =>
        route.fulfill({ json: { tournaments: [] } }),
      )
      await open(page, '/tournaments')
      await page.getByRole('button', { name: 'new tournament' }).first().click()
      const form = page.getByRole('dialog', { name: 'new tournament' })
      await form.getByRole('textbox', { name: 'name' }).fill('league')
      await form.getByRole('radio', { name: 'round robin' }).click()
      for (const name of ['Imp', 'Dwarf', 'Stone']) {
        await form.getByRole('checkbox', { name, exact: true }).check()
      }
      await expectClean(page, 'new tournament form')
      await form.locator('button[name="create"]').click()
      await expect(form).toBeHidden()
      await page.getByRole('listitem', { name: 'league' }).getByRole('link').click()
      const matrix = page.getByRole('table', { name: 'results matrix' })
      await expect(matrix.locator('[data-played]')).toHaveCount(6, { timeout: 60_000 })
      await expectClean(page, 'round robin, finished')
    })

    test('signed in: the first sign-in, the hill, its submit dialog, the settings', async ({
      page,
    }) => {
      const login = `a11y-${theme}-${Date.now().toString(36)}`
      // An address of its own: the Worker allows 10 sign-ins a minute an address, and a full run
      // signs in more than that. The local Worker takes the header as sent; Cloudflare sets it.
      await page.setExtraHTTPHeaders({ 'CF-Connecting-IP': `10.11.${THEMES.indexOf(theme)}.1` })
      await open(page, '/hills/tiny')
      await page.route('**/api/auth/github?*', (route) =>
        route.continue({ url: `${route.request().url()}&as=${login}` }),
      )
      await page.getByRole('button', { name: 'sign in to submit', exact: true }).click()
      const pick = page.getByRole('dialog', { name: 'pick a handle' })
      await expect(pick).toBeVisible()
      await expectClean(page, 'first sign-in')
      await pick.getByRole('button', { name: 'continue' }).click()
      await expect(pick).toBeHidden()
      await page.getByRole('button', { name: 'submit', exact: true }).click()
      await expect(page.getByRole('dialog', { name: /submit/ })).toBeVisible()
      await expectClean(page, 'submit dialog')
      await page.keyboard.press('Escape')
      await open(page, '/settings')
      await page.getByRole('button', { name: 'sound' }).click()
      await expectClean(page, 'settings, signed in, sound on')
    })
  })
}
