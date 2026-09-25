// UX audit shots of the live site: every route, desktop and mobile. Not part of the build.
// bun run scripts/ux-shots.ts [origin] [outDir]
import { chromium } from '@playwright/test'

const ORIGIN = process.argv[2] ?? 'https://asmbots.io'
const OUT = process.argv[3] ?? '/tmp/ux-shots'
const REPLAY = 'ba48ddd254aa950482d36f6b69e8da6b5e1d9c72e5be2d0e9c64dafd3b9ad37c'

type Shot = { name: string; path: string; full?: boolean; wait?: number; theme?: string; after?: string }
const SHOTS: Shot[] = [
  { name: 'home', path: '/', full: true, wait: 4000 },
  { name: 'home-boot', path: '/?boot=1', wait: 1500 },
  { name: 'home-paper', path: '/', full: true, wait: 4000, theme: 'paper' },
  { name: 'arena-setup', path: '/arena', wait: 2500 },
  { name: 'arena-battle', path: '/arena?b=roster:dwarf,roster:imp,roster:paper,roster:stone&seed=7', wait: 6000 },
  { name: 'arena-intro', path: '/arena?intro=true', wait: 3000 },
  { name: 'arena-replay', path: `/arena/${REPLAY}`, wait: 6000 },
  { name: 'embed-arena', path: `/embed/arena/${REPLAY}`, wait: 6000 },
  { name: 'editor', path: '/editor', wait: 3000 },
  { name: 'tournaments', path: '/tournaments', full: true, wait: 2500 },
  { name: 'tournament', path: '/tournaments/weekly-2026-09-26', full: true, wait: 2500 },
  { name: 'hills', path: '/hills', full: true, wait: 2500 },
  { name: 'hill-main', path: '/hills/main', full: true, wait: 2500 },
  { name: 'bot-paper', path: '/bots/roster-paper', full: true, wait: 2500 },
  { name: 'user-system', path: '/u/system', full: true, wait: 2500 },
  { name: 'docs', path: '/docs', full: true, wait: 2500 },
  { name: 'docs-start', path: '/docs/start-here', full: true, wait: 3000 },
  { name: 'docs-memory', path: '/docs/machine/memory', full: true, wait: 3000 },
  { name: 'docs-imps', path: '/docs/strategy/imps', full: true, wait: 3000 },
  { name: 'docs-keys', path: '/docs/tools/keys', full: true, wait: 3000 },
  { name: 'settings', path: '/settings', full: true, wait: 2000 },
  { name: 'not-found', path: '/nope/nothing', wait: 1500 },
  { name: 'keys-help', path: '/hills', wait: 2000, after: '?' },
]
const VIEWPORTS = [
  { tag: 'desktop', width: 1440, height: 900 },
  { tag: 'mobile', width: 390, height: 844, mobile: true },
]

const browser = await chromium.launch({ channel: 'chromium-headless-shell' } as never).catch(() => chromium.launch())
for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: vp.mobile ?? false,
    hasTouch: vp.mobile ?? false,
    deviceScaleFactor: 1,
  })
  for (const shot of SHOTS) {
    if (vp.mobile && ['home-paper', 'arena-intro', 'keys-help', 'docs-keys'].includes(shot.name)) continue
    const page = await ctx.newPage()
    try {
      if (shot.theme) await ctx.addInitScript((t) => localStorage.setItem('theme', t), shot.theme)
      await page.goto(ORIGIN + shot.path, { waitUntil: 'load', timeout: 30000 })
      await page.waitForTimeout(shot.wait ?? 1500)
      if (shot.after) await page.keyboard.press(shot.after), await page.waitForTimeout(600)
      await page.screenshot({ path: `${OUT}/${shot.name}-${vp.tag}.png`, fullPage: shot.full ?? false })
      const h = await page.evaluate(() => document.documentElement.scrollHeight)
      console.log(`${vp.tag} ${shot.name} ok h=${h}`)
    } catch (e) {
      console.log(`${vp.tag} ${shot.name} FAIL ${(e as Error).message.split('\n')[0]}`)
    }
    await page.close()
  }
  await ctx.close()
}
await browser.close()
