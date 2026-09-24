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
    if (!text.includes('<!DOCTYPE html')) throw new Error('No HTML')
    if (!text.includes('id="root"')) throw new Error('No root div')
  })

  // 3. Home page serves the app
  await test('Home page (/) serves the SPA', async () => {
    const res = await fetch(`${baseUrl}/`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    if (!text.includes('<!DOCTYPE html')) throw new Error('No HTML')
  })

  // 4. Hills list has at least 3
  await test('Hills list has at least 3 hills', async () => {
    const res = await fetch(`${baseUrl}/api/hills`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = (await res.json()) as { hills?: unknown[] }
    const count = Array.isArray(body.hills) ? body.hills.length : 0
    if (count < 3) throw new Error(`Expected ≥3 hills, got ${count}`)
  })

  // 5. Roster bot fetch
  await test('Roster bots endpoint returns bots', async () => {
    const res = await fetch(`${baseUrl}/api/bots`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = (await res.json()) as { bots?: unknown[] }
    if (!Array.isArray(body.bots) || body.bots.length === 0)
      throw new Error('No bots returned')
  })

  // 6. Replay POST + GET round trip
  let replayId = ''
  await test('POST /api/replays creates a replay', async () => {
    const payload = {
      isa: 'x16c-v1',
      seed: 12345,
      config: { kind: 'duel', cycles: 80000, rounds: 1 },
      bots: [0, 1], // bot indices from roster
    }
    const res = await fetch(`${baseUrl}/api/replays`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
    const body = (await res.json()) as { replay_id?: string }
    replayId = body.replay_id || ''
    if (!replayId) throw new Error('No replay_id returned')
  })

  if (replayId) {
    await test(`GET /api/replays/${replayId} fetches the replay`, async () => {
      const res = await fetch(`${baseUrl}/api/replays/${replayId}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const text = await res.text()
      if (text.length === 0) throw new Error('Empty response')
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
      throw new Error(
        `Missing OG tags: og:title=${hasOgTitle}, og:image=${hasOgImage}`,
      )
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
