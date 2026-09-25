/**
 * The hills' 30 s cache (`src/edge-cache.ts`): the list and a hill's standings come from the
 * colo's edge cache while young, say how long a browser may keep them, and come fresh to a
 * request that asks (the web app, once it knows a board changed).
 */
import { env, exports } from 'cloudflare:workers'
import { HillDetail, HillList, parse } from '@asmbots/protocol'
import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { beforeAll, describe, expect, it } from 'vitest'
import { applySeed, buildSeed } from '../src/db/seed'
import { edgeCached, HILLS_CACHE_SECONDS, wantsFresh } from '../src/edge-cache'
import type { AppEnv } from '../src/env'

const worker = exports.default

function get(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return worker.fetch(new Request(`https://asmbots.test${path}`, { headers }))
}

/** Renames the main hill in the database, behind any cache's back. */
async function rename(name: string): Promise<void> {
  await env.DB.prepare("UPDATE hills SET name = ? WHERE slug = 'main'").bind(name).run()
}

beforeAll(async () => {
  // The launch hills, empty: a hill's name is what these tests read.
  await applySeed(env, await buildSeed([]))
})

describe('the hills cache', () => {
  it('keeps a hill 30 s: a second read is the first, with its age', async () => {
    const first = await get('/api/hills/main')
    expect(first.status).toBe(200)
    expect(first.headers.get('Cache-Control')).toBe(`public, max-age=${HILLS_CACHE_SECONDS}`)
    const before = parse(HillDetail, await first.json(), 'the hill').hill.name
    await rename('Renamed Hill')
    const second = await get('/api/hills/main')
    expect(parse(HillDetail, await second.json(), 'the hill').hill.name).toBe(before)
    expect(Number(second.headers.get('Age'))).toBeGreaterThanOrEqual(0)
    expect(second.headers.get('Cache-Control')).toBe(`public, max-age=${HILLS_CACHE_SECONDS}`)
  })

  it('reads it again for a request that asks for a fresh copy, and keeps that one', async () => {
    await rename('Fresh Hill')
    const fresh = await get('/api/hills/main', { 'Cache-Control': 'no-cache' })
    expect(parse(HillDetail, await fresh.json(), 'the hill').hill.name).toBe('Fresh Hill')
    expect(fresh.headers.get('Age')).toBeNull()
    await rename('Later Hill')
    const next = await get('/api/hills/main')
    expect(parse(HillDetail, await next.json(), 'the hill').hill.name).toBe('Fresh Hill')
  })

  it('keeps the hills list the same way', async () => {
    const names = async (headers?: Record<string, string>) => {
      const res = await get('/api/hills', headers)
      expect(res.headers.get('Cache-Control')).toBe(`public, max-age=${HILLS_CACHE_SECONDS}`)
      const { hills } = parse(HillList, await res.json(), 'the hills')
      return hills.map((h) => h.hill.name)
    }
    const first = await names()
    await rename('Listed Hill')
    expect(await names()).toEqual(first)
    expect(await names({ 'Cache-Control': 'max-age=0' })).toContain('Listed Hill')
  })

  it('keeps no error: a hill that is not there is looked up each time', async () => {
    const missing = await get('/api/hills/nowhere')
    expect(missing.status).toBe(404)
    expect(missing.headers.get('Cache-Control')).toBeNull()
    expect((await get('/api/hills/nowhere')).headers.get('Age')).toBeNull()
  })
})

describe('edgeCached', () => {
  /** A route whose answer is `status`, through the cache, counting how often it is made. */
  function route(status: ContentfulStatusCode) {
    let made = 0
    const app = new Hono<AppEnv>().get('/probe/:name', (c) =>
      edgeCached(c, HILLS_CACHE_SECONDS, async () => c.json({ made: ++made }, status)),
    )
    const kept: Promise<unknown>[] = []
    const ctx = {
      waitUntil: (work: Promise<unknown>) => void kept.push(work),
      passThroughOnException: () => {},
      props: {},
    } as unknown as ExecutionContext
    const get = async (path: string) => {
      const res = await app.fetch(new Request(`https://asmbots.test${path}`), env, ctx)
      await Promise.all(kept)
      return res
    }
    return { get, made: () => made }
  }

  it('keeps a 200, and makes any other answer each time', async () => {
    const ok = route(200)
    await ok.get('/probe/ok')
    await ok.get('/probe/ok')
    expect(ok.made()).toBe(1)
    for (const status of [404, 503] as const) {
      const other = route(status)
      const first = await other.get(`/probe/${status}`)
      expect(first.status).toBe(status)
      expect(first.headers.get('Cache-Control')).toBeNull()
      await other.get(`/probe/${status}`)
      expect(other.made(), String(status)).toBe(2)
    }
  })
})

describe('wantsFresh', () => {
  it('reads a reload, no-store, and a revalidation as asking for a fresh copy', () => {
    for (const header of ['no-cache', 'no-store', 'max-age=0', 'private, no-cache', 'MAX-AGE=0']) {
      expect(wantsFresh(header), header).toBe(true)
    }
    for (const header of [undefined, '', 'max-age=30', 'max-age=00x', 'public']) {
      expect(wantsFresh(header), String(header)).toBe(false)
    }
  })
})
