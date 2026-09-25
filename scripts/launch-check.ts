#!/usr/bin/env bun
/**
 * The launch checklist's automated half (docs/RUNBOOK.md "Launch checklist"), against a deployed
 * site: the version it runs, the smoke tests, backups, the championship cron, the GitHub sign-in
 * redirect, share cards as Slack and Twitter fetch them, robots.txt, and the error rate.
 *
 *   bun run scripts/launch-check.ts [baseUrl] [--version 2026.09.25a]
 *
 * The Cloudflare checks (backups, cron, error rate) need CLOUDFLARE_API_TOKEN and
 * CLOUDFLARE_ACCOUNT_ID (the Keychain's `asmbots/cloudflare`); without them they fail. Exit code 0
 * when every check passes.
 */
import { spawnSync } from 'node:child_process'

const args = process.argv.slice(2)
const flag = args.indexOf('--version')
const expectVersion = flag >= 0 ? args[flag + 1] : undefined
const base = (
  args.find((a, i) => !a.startsWith('--') && i !== flag + 1) ?? 'https://asmbots.io'
).replace(/\/$/, '')

const TOKEN = process.env.CLOUDFLARE_API_TOKEN
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID
const SCRIPT = 'asmbots'
const BACKUPS = 'asmbots-backups'
const CRON = '0 18 * * 6'
/** The newest backup may be this old: a nightly run and some slack. */
const BACKUP_MAX_AGE_H = 30
const MAX_ERROR_RATE = 0.001
const CRAWLERS = {
  slack: 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
  twitter: 'Twitterbot/1.0',
}
const CARD_PATHS = ['/', '/arena', '/hills/main']

let failed = 0
async function check(name: string, run: () => Promise<string>) {
  try {
    console.log(`✓ ${name}: ${await run()}`)
  } catch (e) {
    failed++
    console.log(`✗ ${name}: ${e instanceof Error ? e.message : String(e)}`)
  }
}

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message)
}

async function cloudflare<T>(path: string, init?: RequestInit): Promise<T> {
  assert(TOKEN && ACCOUNT, 'CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are not set')
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  })
  const body = (await res.json()) as { result?: T; data?: T; errors?: unknown }
  assert(res.ok, `Cloudflare ${path}: HTTP ${res.status} ${JSON.stringify(body.errors)}`)
  return (body.result ?? body.data) as T
}

/** The `content` of `<meta property|name="key" content="…">` in `html`. */
function meta(html: string, key: string): string | undefined {
  const tag = html.match(new RegExp(`<meta[^>]+(?:property|name)="${key}"[^>]*>`))?.[0]
  return tag?.match(/content="([^"]*)"/)?.[1]?.replaceAll('&amp;', '&')
}

await check('version', async () => {
  const res = await fetch(`${base}/api/health`)
  const body = (await res.json()) as { ok?: boolean; version?: string; isa?: string }
  assert(res.ok && body.ok, `health: HTTP ${res.status} ${JSON.stringify(body)}`)
  assert(
    !expectVersion || body.version === expectVersion,
    `runs ${body.version}, not ${expectVersion}`,
  )
  return `${body.version} · ${body.isa}`
})

await check('smoke', async () => {
  const run = spawnSync('bun', ['run', new URL('./smoke.ts', import.meta.url).pathname, base], {
    encoding: 'utf8',
  })
  const summary = run.stdout.trim().split('\n').at(-1) ?? ''
  assert(run.status === 0, `${summary}\n${run.stdout}${run.stderr}`)
  return summary
})

await check('backups', async () => {
  const objects = await cloudflare<{ key: string; last_modified: string }[]>(
    `/accounts/${ACCOUNT}/r2/buckets/${BACKUPS}/objects?per_page=1000`,
  )
  const newest = objects.toSorted((a, b) => b.last_modified.localeCompare(a.last_modified))[0]
  assert(newest, `${BACKUPS} is empty`)
  const age = (Date.now() - Date.parse(newest.last_modified)) / 3_600_000
  assert(age <= BACKUP_MAX_AGE_H, `newest is ${newest.key}, ${age.toFixed(1)} h old`)
  return `${newest.key}, ${age.toFixed(1)} h old`
})

await check('championship cron', async () => {
  const { schedules } = await cloudflare<{ schedules: { cron: string }[] }>(
    `/accounts/${ACCOUNT}/workers/scripts/${SCRIPT}/schedules`,
  )
  const crons = schedules.map((s) => s.cron)
  assert(crons.includes(CRON), `schedules are ${JSON.stringify(crons)}, not ${CRON}`)
  return crons.join(', ')
})

await check('GitHub sign-in', async () => {
  const res = await fetch(`${base}/api/auth/github`, { redirect: 'manual' })
  const to = new URL(res.headers.get('location') ?? '', base)
  assert(res.status === 302, `HTTP ${res.status}`)
  assert(to.href.startsWith('https://github.com/login/oauth/authorize'), `redirects to ${to.href}`)
  assert(to.searchParams.get('client_id'), 'no client_id')
  // The callback is live: without a code and a state it refuses, and does not 404 or crash.
  const back = await fetch(`${base}/api/auth/github/callback`, { redirect: 'manual' })
  assert(back.status >= 300 && back.status < 500 && back.status !== 404, `callback: ${back.status}`)
  return `302 to GitHub (client ${to.searchParams.get('client_id')}), callback ${back.status}`
})

for (const [crawler, agent] of Object.entries(CRAWLERS)) {
  await check(`share cards · ${crawler}`, async () => {
    const seen: string[] = []
    for (const path of CARD_PATHS) {
      const html = await (
        await fetch(`${base}${path}`, { headers: { 'User-Agent': agent } })
      ).text()
      const title = meta(html, 'og:title')
      const image = meta(html, 'og:image')
      assert(title && image, `${path}: og:title ${title}, og:image ${image}`)
      assert(meta(html, 'twitter:card') === 'summary_large_image', `${path}: no large card`)
      const png = await fetch(new URL(image, base), { headers: { 'User-Agent': agent } })
      const bytes = new Uint8Array(await png.arrayBuffer())
      assert(png.ok && png.headers.get('content-type') === 'image/png', `${image}: ${png.status}`)
      const view = new DataView(bytes.buffer)
      seen.push(`${path} ${view.getUint32(16)}×${view.getUint32(20)}`)
    }
    return seen.join(', ')
  })
}

await check('robots.txt', async () => {
  const text = await (await fetch(`${base}/robots.txt`)).text()
  const star = text.split(/\n(?=User-agent:)/i).find((group) => /^User-agent:\s*\*/im.test(group))
  assert(star && /^Allow:\s*\/\s*$/im.test(star), 'no `Allow: /` for every agent')
  assert(!/^Disallow:\s*\/\s*$/im.test(star), '`Disallow: /` for every agent')
  return 'indexing allowed'
})

await check('error rate, last hour', async () => {
  const to = new Date()
  const from = new Date(to.getTime() - 3_600_000)
  const query = `query ($account: String!, $from: Time!, $to: Time!) { viewer { accounts(filter: { accountTag: $account }) {
    workersInvocationsAdaptive(limit: 100, filter: { scriptName: "${SCRIPT}", datetime_geq: $from, datetime_leq: $to }) {
      sum { requests errors } } } } }`
  const data = await cloudflare<{
    viewer: {
      accounts: { workersInvocationsAdaptive: { sum: { requests: number; errors: number } }[] }[]
    }
  }>('/graphql', {
    method: 'POST',
    body: JSON.stringify({ query, variables: { account: ACCOUNT, from, to } }),
  })
  const rows = data.viewer.accounts[0]?.workersInvocationsAdaptive ?? []
  const requests = rows.reduce((n, r) => n + r.sum.requests, 0)
  const errors = rows.reduce((n, r) => n + r.sum.errors, 0)
  const rate = requests === 0 ? 0 : errors / requests
  assert(rate < MAX_ERROR_RATE, `${errors} errors in ${requests} requests`)
  return `${errors} errors in ${requests} requests (${(rate * 100).toFixed(2)}%)`
})

console.log(failed === 0 ? '\nall checks pass' : `\n${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
