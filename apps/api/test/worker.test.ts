import { createScheduledController } from 'cloudflare:test'
import { env, exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import handler from '../src/index'

const worker = exports.default
/** What a browser sends when it loads a page. */
const NAVIGATE = { headers: { Accept: 'text/html', 'Sec-Fetch-Mode': 'navigate' } }

function get(path: string, init?: RequestInit): Promise<Response> {
  return worker.fetch(new Request(`https://asmbots.test${path}`, init))
}

describe('GET /api/health', () => {
  it('answers ok with the build stamp and the ISA', async () => {
    const res = await get('/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, version: 'dev', isa: 'x16c-v1' })
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
