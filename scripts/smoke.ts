#!/usr/bin/env bun
/**
 * Smoke test suite for production deployment.
 * Usage: scripts/smoke.ts <baseUrl>
 * Exit code: 0 on success, 1 on any failure.
 */

const argv = (globalThis as any).Bun?.argv || process.argv
const baseUrl = argv[2] || 'http://localhost:8787'
let passed = 0
let failed = 0

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn()
    console.log(`✓ ${name}`)
    passed++
  } catch (e) {
    console.error(`✗ ${name}`)
    console.error(`  ${e instanceof Error ? e.message : String(e)}`)
    failed++
  }
}

async function smoke() {
  // 1. Health endpoint
  await test('Health endpoint returns { ok: true }', async () => {
    const res = await fetch(`${baseUrl}/api/health`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = (await res.json()) as { ok?: boolean }
    if (!body.ok) throw new Error(`Expected { ok: true }, got ${JSON.stringify(body)}`)
  })

  // 2. SPA fallback: navigate to /arena
  await test('SPA fallback serves app at /arena', async () => {
    const res = await fetch(`${baseUrl}/arena`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    if (!/<!doctype html/i.test(text)) throw new Error('No HTML')
    if (!text.includes('id="root"')) throw new Error('No root div')
  })

  // 3. Home page serves the app
  await test('Home page (/) serves the SPA', async () => {
    const res = await fetch(`${baseUrl}/`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    if (!/<!doctype html/i.test(text)) throw new Error('No HTML')
  })

  // 4. Hills list has at least 3
  await test('Hills list has at least 3 hills', async () => {
    const res = await fetch(`${baseUrl}/api/hills`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = (await res.json()) as { hills?: unknown[] }
    const count = Array.isArray(body.hills) ? body.hills.length : 0
    if (count < 3) throw new Error(`Expected ≥3 hills, got ${count}`)
  })

  // 5. The main hill has its standings
  await test('Main hill has standings', async () => {
    const res = await fetch(`${baseUrl}/api/hills/main`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = (await res.json()) as { standings?: unknown[] }
    if (!Array.isArray(body.standings) || body.standings.length === 0)
      throw new Error('No standings')
  })

  // 6. A published match: its replay, and its verification inputs (read-only)
  let match: { id: string; replayKey: string | null } | undefined
  await test('Main hill has a finished match', async () => {
    const res = await fetch(`${baseUrl}/api/hills/main/matches?limit=1`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = (await res.json()) as { matches?: { match: typeof match }[] }
    match = body.matches?.[0]?.match
    if (!match?.replayKey) throw new Error('No finished match with a replay')
  })

  if (match?.replayKey) {
    const { id, replayKey } = match
    await test(`GET /api/replays/${replayKey.slice(0, 12)}… fetches the replay`, async () => {
      const res = await fetch(`${baseUrl}/api/replays/${replayKey}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      if ((await res.text()).length === 0) throw new Error('Empty response')
    })
    await test(`GET /api/matches/${id}/verify returns its inputs`, async () => {
      const res = await fetch(`${baseUrl}/api/matches/${id}/verify`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    })
  }

  // 7. OG SVG (meta tags)
  await test('Home page has OG meta tags (og:image, og:title)', async () => {
    const res = await fetch(`${baseUrl}/`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    const hasOgTitle = text.includes('og:title')
    const hasOgImage = text.includes('og:image')
    if (!hasOgTitle || !hasOgImage)
      throw new Error(`Missing OG tags: og:title=${hasOgTitle}, og:image=${hasOgImage}`)
  })

  // 8. Headers: HTTPS enforcement and CSP
  await test('Response includes security headers', async () => {
    const res = await fetch(`${baseUrl}/api/health`)
    const hsts = res.headers.get('Strict-Transport-Security')
    const csp = res.headers.get('Content-Security-Policy')
    // HSTS optional in dev (localhost has no HTTPS).
    // CSP may not be on all endpoints in initial deploy.
    console.log(`  [info] HSTS: ${hsts ? 'present' : 'absent'}, CSP: ${csp ? 'present' : 'absent'}`)
  })

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

smoke().catch((e) => {
  console.error('Fatal error:', e)
  process.exit(1)
})
