import { createScheduledController } from 'cloudflare:test'
import { env, exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import handler from '../src/index'
import { uptimeOf } from '../src/routes/health'

const worker = exports.default
/** What a browser sends when it loads a page. */
const NAVIGATE = { headers: { Accept: 'text/html', 'Sec-Fetch-Mode': 'navigate' } }

function get(path: string, init?: RequestInit): Promise<Response> {
  return worker.fetch(new Request(`https://asmbots.test${path}`, init))
}

describe('GET /api/health', () => {
  it('answers ok with the build stamp, the ISA, and how long this version has been up', async () => {
    const before = Date.now()
    const res = await get('/api/health')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { uptime: number; since: string }
    expect(body).toEqual({
      ok: true,
      version: 'dev',
      isa: 'x16c-v1',
      uptime: expect.any(Number),
      since: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/),
    })
    // Since the version went up: the version metadata binding's upload time, the pool's start.
    const since = Date.parse(body.since)
    expect(new Date(since).toISOString()).toBe(
      new Date(Date.parse(env.CF_VERSION_METADATA?.timestamp ?? '')).toISOString(),
    )
    expect(Number.isInteger(body.uptime)).toBe(true)
    expect(body.uptime).toBe(Math.floor((Date.now() - since) / 1000))
    expect(since).toBeLessThanOrEqual(before)
  })

  it('counts whole seconds from the upload, and from the fallback without one', () => {
    const at = Date.parse('2026-10-03T18:00:00.000Z')
    const metadata = { id: 'v', tag: '', timestamp: '2026-10-03T18:00:00.000000Z' }
    expect(uptimeOf({ CF_VERSION_METADATA: metadata }, at + 90_061_999, at - 5_000)).toEqual({
      uptime: 90_061,
      since: '2026-10-03T18:00:00.000Z',
    })
    // A clock behind the upload says 0, not a negative uptime.
    expect(uptimeOf({ CF_VERSION_METADATA: metadata }, at - 5_000, 0).uptime).toBe(0)
    // No metadata, or none that reads as a time: the fallback, this isolate's first answer.
    expect(uptimeOf({}, at + 2_500, at)).toEqual({ uptime: 2, since: '2026-10-03T18:00:00.000Z' })
    const garbled = { id: 'v', tag: '', timestamp: 'soon' }
    expect(uptimeOf({ CF_VERSION_METADATA: garbled }, at + 61_000, at).uptime).toBe(61)
  })

  it('gives every response a request id, and keeps a well-formed one it was sent', async () => {
    const made = await get('/api/health')
    expect(made.headers.get('X-Request-Id')).toMatch(/^[0-9a-f-]{36}$/)
    const kept = await get('/api/health', { headers: { 'X-Request-Id': 'probe-1' } })
    expect(kept.headers.get('X-Request-Id')).toBe('probe-1')
  })
})

describe('GET /api/version', () => {
  it('names the build, the ISA, and the live protocol', async () => {
    const res = await get('/api/version')
    expect(await res.json()).toEqual({ version: 'dev', isa: 'x16c-v1', live: 1 })
  })
})

describe('static assets', () => {
  it('serves the single-page app for a client route', async () => {
    const res = await get('/arena', NAVIGATE)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('spa shell')
  })

  it('answers an unknown API path with the protocol error, not the app', async () => {
    const res = await get('/api/nope', NAVIGATE)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({
      error: { code: 'not_found', message: 'no route for GET /api/nope' },
    })
  })
})

describe('CORS', () => {
  it('lets the app origin in', async () => {
    const res = await get('/api/health', { headers: { Origin: 'http://localhost:5173' } })
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173')
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true')
  })

  it('keeps any other origin out', async () => {
    const res = await get('/api/health', { headers: { Origin: 'https://evil.example' } })
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })
})

describe('write rate limit', () => {
  it('allows 60 writes a minute per IP, then answers 429 in the protocol shape', async () => {
    const post = (ip: string) =>
      get('/api/anything', { method: 'POST', headers: { 'CF-Connecting-IP': ip } })
    for (let i = 0; i < 60; i++) {
      const res = await post('203.0.113.7')
      expect(res.status).toBe(404)
      expect(res.headers.get('X-RateLimit-Remaining')).toBe(String(59 - i))
    }
    const limited = await post('203.0.113.7')
    expect(limited.status).toBe(429)
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0)
    const body = (await limited.json()) as { error: { code: string } }
    expect(body.error.code).toBe('rate_limited')
    // Another IP has its own count, and reads are never limited.
    expect((await post('203.0.113.8')).status).toBe(404)
    const read = await get('/api/health', { headers: { 'CF-Connecting-IP': '203.0.113.7' } })
    expect(read.status).toBe(200)
  })
})

describe('scheduled', () => {
  it('runs the weekly championship stub', async () => {
    const controller = createScheduledController({ cron: '0 18 * * 6' })
    await expect(handler.scheduled(controller, env)).resolves.toBeUndefined()
  })
})
