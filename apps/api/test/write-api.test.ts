/**
 * The write routes of 3.1: server-side assembly, replay upload (checked by running the match
 * again), and a stored replay's OG image.
 */
import { env, exports } from 'cloudflare:workers'
import { assembleOrThrow } from '@asmbots/asm'
import {
  AssembleResult,
  buildReplay,
  CARD_HEIGHT,
  CARD_WIDTH,
  MAX_SOURCE_TEXT,
  parse,
  type Replay,
  replayKey,
  StoredReplay,
  sha256Hex,
  toBase64,
} from '@asmbots/protocol'
import { runMatch } from '@asmbots/tourney'
import { describe, expect, it } from 'vitest'
import { finalOwners, winnerLine } from '../src/og/replay'
import { ogCacheKey, pngCacheKey, replayObjectKey } from '../src/storage'
import { pngSize, wellFormed } from './xml'

const worker = exports.default

/** A fresh client IP, so the per-IP rate limits count each request apart. */
function someIp(): string {
  return `10.${[0, 0, 0].map(() => Math.floor(Math.random() * 256)).join('.')}`
}

function post(path: string, body: unknown, ip = someIp()): Promise<Response> {
  return worker.fetch(
    new Request(`https://asmbots.test${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  )
}

function get(path: string): Promise<Response> {
  return worker.fetch(new Request(`https://asmbots.test${path}`))
}

async function refused(res: Response): Promise<{ status: number; code: string; message: string }> {
  const { error } = (await res.json()) as { error: { code: string; message: string } }
  return { status: res.status, ...error }
}

const SPIN = '%name "Spin"\n%author "ASM Bots"\n%strategy "Jump to itself"\nstart: jmp $\n'
const DWARF = `%name "Dwarf"
%author "ASM Bots"
%strategy "Bomb every 4th byte, walking backward"
SIZE equ end - start
start:  call .here
.here:  pop bx
        sub bx, .here
lap:    mov di, bx
        mov cx, (0x10000 - SIZE) / 4
.bomb:  sub di, 4
        mov word [di], 0
        loop .bomb
        jmp lap
end:
`

/** A true replay of `sources` fighting `rounds` rounds of `maxCycles` cycles. */
async function replayOf(
  sources: readonly string[],
  {
    rounds = 3,
    maxCycles = 20_000,
    names,
  }: { rounds?: number; maxCycles?: number; names?: string[] } = {},
): Promise<Replay> {
  const bots = sources.map((source, i) => {
    const out = assembleOrThrow(source)
    return { name: names?.[i] ?? out.name, bytes: out.bytes, source }
  })
  const config = { maxCycles, seed: 7 }
  const match = runMatch(bots, config, rounds)
  return buildReplay({ bots, config, rounds, match, createdAt: new Date('2026-09-24T12:00:00Z') })
}

describe('POST /api/assemble', () => {
  it('assembles a source into bytes, their size, and their SHA-256', async () => {
    const res = await post('/api/assemble', { source: DWARF })
    expect(res.status).toBe(200)
    const out = parse(AssembleResult, await res.json(), 'the result')
    const bytes = assembleOrThrow(DWARF).bytes
    expect(out).toEqual({
      bytes: toBase64(bytes),
      size: bytes.length,
      sha256: await sha256Hex(bytes),
      diagnostics: [],
    })
  })

  it('gives no bytes, and the diagnostics, for a source with an error', async () => {
    const res = await post('/api/assemble', { source: 'start: frob ax\n' })
    expect(res.status).toBe(200)
    const out = parse(AssembleResult, await res.json(), 'the result')
    expect(out).toMatchObject({ bytes: null, size: 0, sha256: null })
    expect(out.diagnostics.map((d) => d.code)).toEqual(
      expect.arrayContaining(['unknown-mnemonic', 'missing-name']),
    )
    expect(out.diagnostics[0]).toMatchObject({ severity: 'error', line: 1 })
  })

  it('refuses a body that is not JSON, not a request, or too big', async () => {
    expect(await refused(await post('/api/assemble', '{'))).toMatchObject({
      status: 400,
      message: 'the request body is not JSON',
    })
    expect(await refused(await post('/api/assemble', { text: SPIN }))).toMatchObject({
      status: 400,
      message: 'source is missing',
    })
    const long = { source: ';'.repeat(MAX_SOURCE_TEXT + 1) }
    expect(await refused(await post('/api/assemble', long))).toMatchObject({
      status: 400,
      message: 'the source is over 64 KB',
    })
    const huge = { source: ';'.repeat(300 * 1024) }
    expect(await refused(await post('/api/assemble', huge))).toMatchObject({
      status: 413,
      code: 'payload_too_large',
    })
  })

  it('is rate limited at 30 a minute', async () => {
    const res = await post('/api/assemble', { source: SPIN })
    expect(res.headers.get('X-RateLimit-Limit')).toBe('30')
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('29')
  })
})

describe('POST /api/replays', () => {
  it('stores a true replay under its key, and answers 200 when it has it', async () => {
    const replay = await replayOf([DWARF, SPIN])
    const key = await replayKey(replay)
    const res = await post('/api/replays', { replay })
    expect(res.status).toBe(201)
    expect(parse(StoredReplay, await res.json(), 'the answer')).toEqual({
      key,
      url: `https://asmbots.test/arena/${key}`,
    })
    const stored = await get(`/api/replays/${key}`)
    expect(await stored.json()).toEqual(replay)

    const again = await post('/api/replays', { replay: { ...replay, createdAt: undefined } })
    expect(again.status).toBe(200)
    expect(((await again.json()) as StoredReplay).key).toBe(key)
  })

  it('rejects a tampered result hash with 422, and stores nothing', async () => {
    const replay = await replayOf([SPIN, DWARF], { rounds: 2 })
    const tampered = { ...replay, result: { ...replay.result, resultHash: '0123456789abcdef' } }
    expect(await refused(await post('/api/replays', { replay: tampered }))).toEqual({
      status: 422,
      code: 'unprocessable',
      message: 'the result hash is not the one the server got from the match',
    })
    expect(await env.REPLAYS.head(replayObjectKey(await replayKey(replay)))).toBeNull()
  })

  it('rejects a result that differs from the match with 422, its hash intact', async () => {
    const replay = await replayOf([SPIN, DWARF], { rounds: 2, maxCycles: 30_000 })
    const points = replay.result.points.map((p) => p + 1)
    const tampered = { ...replay, result: { ...replay.result, points } }
    expect(await refused(await post('/api/replays', { replay: tampered }))).toMatchObject({
      status: 422,
      message: 'the result is not the one the server got from the match',
    })
  })

  it('checks an upload of a stored match against the stored result', async () => {
    const replay = await replayOf([DWARF, SPIN], { rounds: 1 })
    expect((await post('/api/replays', { replay })).status).toBe(201)
    const tampered = { ...replay, result: { ...replay.result, resultHash: 'ffffffffffffffff' } }
    expect((await refused(await post('/api/replays', { replay: tampered }))).status).toBe(422)
  })

  it('rejects bytes that are not their SHA-256, and a source that is not the bytes', async () => {
    const replay = await replayOf([DWARF, SPIN], { rounds: 1, maxCycles: 5_000 })
    const [dwarf, spin] = replay.bots as [Replay['bots'][number], Replay['bots'][number]]
    const badHash = { ...replay, bots: [{ ...dwarf, sha256: 'ab'.repeat(32) }, spin] }
    expect(await refused(await post('/api/replays', { replay: badHash }))).toMatchObject({
      status: 422,
      message: "Dwarf's bytes do not match their SHA-256",
    })
    const badSource = { ...replay, bots: [dwarf, { ...spin, source: DWARF }] }
    expect(await refused(await post('/api/replays', { replay: badSource }))).toMatchObject({
      status: 422,
      message: "Spin's source does not assemble to its bytes",
    })
  })

  it('refuses more work than a request may do with 413', async () => {
    const replay = await replayOf([DWARF, SPIN], { rounds: 1, maxCycles: 1_000 })
    const cases = [
      { ...replay, config: { ...replay.config, maxCycles: 200_001 } },
      { ...replay, rounds: 11 },
      { ...replay, bots: Array.from({ length: 17 }, () => replay.bots[0]) },
    ]
    for (const big of cases) {
      expect(await refused(await post('/api/replays', { replay: big }))).toMatchObject({
        status: 413,
        code: 'payload_too_large',
      })
    }
    // At the limit, the server runs it.
    const most = await replayOf([DWARF, SPIN], { rounds: 1, maxCycles: 200_000 })
    expect((await post('/api/replays', { replay: most })).status).toBe(201)
  })

  it('refuses a replay that is not one with 400', async () => {
    expect(await refused(await post('/api/replays', { replay: { isa: 'x16c-v1' } }))).toMatchObject(
      { status: 400, code: 'bad_request' },
    )
    expect((await refused(await post('/api/replays', {}))).status).toBe(400)
  })
})

describe('GET /api/replays/:key/og.svg', () => {
  it('draws the final owner map and the winner, as well-formed SVG, cached a day', async () => {
    const replay = await replayOf([DWARF, SPIN], { rounds: 2, maxCycles: 50_000 })
    const { key } = (await (await post('/api/replays', { replay })).json()) as StoredReplay
    const res = await get(`/api/replays/${key}/og.svg`)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/svg+xml; charset=utf-8')
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=86400')
    const svg = await res.text()
    expect(wellFormed(svg)).toBe('svg')
    expect(svg).toContain(`${winnerLine(replay)}</text>`)
    // Dwarf's bytes and bombs in its hue, one <rect> a run.
    expect(svg).toMatch(/<g fill="#FF5C5C"><rect x="\d+" y="\d+" width="\d+" height="1"\/>/)
    expect(await env.KV.get(ogCacheKey(key))).toBe(svg)

    // A second request is the cached one.
    await env.KV.put(ogCacheKey(key), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    expect(await (await get(`/api/replays/${key}/og.svg`)).text()).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg"/>',
    )
  })

  it('stays well formed for names with XML specials and control characters', async () => {
    const names = ['<b>&"\'\u0001 Dwarf', 'Spin \uD800']
    const replay = await replayOf([DWARF, SPIN], { rounds: 1, maxCycles: 2_000, names })
    const { key } = (await (await post('/api/replays', { replay })).json()) as StoredReplay
    const svg = await (await get(`/api/replays/${key}/og.svg`)).text()
    expect(wellFormed(svg)).toBe('svg')
    expect(svg).toContain('&lt;b&gt;&amp;&quot;&#39;� Dwarf')
  })

  it('answers 404 for a key it does not have, and 400 for one that is not a key', async () => {
    expect((await get(`/api/replays/${'0'.repeat(64)}/og.svg`)).status).toBe(404)
    expect((await get('/api/replays/nope/og.svg')).status).toBe(400)
  })
})

describe('GET /api/replays/:key/og.png', () => {
  it('draws the card as a PNG at the edge, 1200 × 630, and keeps it in KV by its SVG', async () => {
    // Its own match: the SVG test above leaves a stand-in SVG in KV for its replay.
    const replay = await replayOf([DWARF, SPIN], { rounds: 3, maxCycles: 40_000 })
    const { key } = (await (await post('/api/replays', { replay })).json()) as StoredReplay
    const res = await get(`/api/replays/${key}/og.png`)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/png')
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=86400')
    const png = new Uint8Array(await res.arrayBuffer())
    expect(pngSize(png)).toEqual({ width: CARD_WIDTH, height: CARD_HEIGHT })
    // A card of an owner map and six lines of text, not a blank page.
    expect(png.length).toBeGreaterThan(8_000)

    // KV keeps it under the hash of the card's SVG, which KV keeps too.
    const svg = (await env.KV.get(ogCacheKey(key))) ?? ''
    expect(svg).toContain(`${winnerLine(replay)}</text>`)
    const kept = await env.KV.get(
      pngCacheKey(await sha256Hex(new TextEncoder().encode(svg))),
      'arrayBuffer',
    )
    expect(new Uint8Array(kept ?? new ArrayBuffer(0))).toEqual(png)

    // The next request is the kept PNG.
    const marker = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
    await env.KV.put(pngCacheKey(await sha256Hex(new TextEncoder().encode(svg))), marker)
    expect(new Uint8Array(await (await get(`/api/replays/${key}/og.png`)).arrayBuffer())).toEqual(
      marker,
    )
  })

  it('answers 404 for a key it does not have, and 400 for one that is not a key', async () => {
    expect((await get(`/api/replays/${'0'.repeat(64)}/og.png`)).status).toBe(404)
    expect((await get('/api/replays/nope/og.png')).status).toBe(400)
  })
})

describe('the OG image parts', () => {
  it('maps each core byte to its entrant at the end of the last round', async () => {
    // Round 2 fights Spin first: the map must still name Dwarf entrant 0.
    const replay = await replayOf([DWARF, SPIN], { rounds: 2, maxCycles: 50_000 })
    const owners = finalOwners(replay)
    expect(owners).toHaveLength(0x10000)
    const count = (o: number) => owners.reduce((n, v) => n + (v === o ? 1 : 0), 0)
    // Dwarf bombs the core: it owns far more of it than the 2 bytes of Spin.
    expect(count(1)).toBeGreaterThan(1000)
    expect(count(2)).toBeLessThanOrEqual(2)
  })

  it('names the winner, the bots that tie, or no one', async () => {
    const replay = await replayOf([DWARF, SPIN], { rounds: 1, maxCycles: 50_000 })
    const with_ = (points: number[]) => ({ ...replay, result: { ...replay.result, points } })
    expect(winnerLine(with_([3, 0]))).toBe('Dwarf wins')
    expect(winnerLine(with_([1, 1]))).toBe('a draw')
    expect(winnerLine(with_([0, 0]))).toBe('no winner')
    const three = await replayOf([DWARF, SPIN, SPIN], {
      rounds: 1,
      maxCycles: 10,
      names: ['A', 'B', 'C'],
    })
    expect(winnerLine({ ...three, result: { ...three.result, points: [2, 2, 0] } })).toBe(
      'A, B tie',
    )
  })
})
