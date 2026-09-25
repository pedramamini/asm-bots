/**
 * Share cards (PRODUCT_SPEC §10) of a bot, a hill, a tournament, and a page: each one's SVG well
 * formed and saying what it shows, its PNG drawn at the edge at 1200 × 630, and the cards that do
 * not exist: a private bot's, a draft's, a page the web build did not describe.
 */
import { env, exports } from 'cloudflare:workers'
import { CARD_HEIGHT, CARD_WIDTH, type Hill } from '@asmbots/protocol'
import { createBracket } from '@asmbots/tourney'
import { beforeAll, describe, expect, it } from 'vitest'
import { applySeed, buildSeed, SEED_HILLS } from '../src/db/seed'
import { wrap } from '../src/og/card'
import { hillCard } from '../src/og/hill'
import { me, send, signIn } from './fake-auth'
import { Jar } from './jar'
import { pngSize, wellFormed } from './xml'

const worker = exports.default

function get(path: string): Promise<Response> {
  return worker.fetch(new Request(`https://asmbots.test${path}`))
}

async function svgOf(path: string): Promise<string> {
  const res = await get(path)
  expect(res.status, path).toBe(200)
  expect(res.headers.get('Content-Type')).toBe('image/svg+xml; charset=utf-8')
  const svg = await res.text()
  expect(wellFormed(svg), path).toBe('svg')
  return svg
}

async function pngOf(path: string): Promise<Uint8Array> {
  const res = await get(path)
  expect(res.status, path).toBe(200)
  expect(res.headers.get('Content-Type')).toBe('image/png')
  const png = new Uint8Array(await res.arrayBuffer())
  expect(pngSize(png), path).toEqual({ width: CARD_WIDTH, height: CARD_HEIGHT })
  return png
}

const SOURCES = [
  {
    slug: 'spin',
    melee: true,
    source: '%name "Spin"\n%author "ASM Bots"\n%strategy "Jump to itself"\nstart: jmp $\n',
  },
  {
    slug: 'dwarf',
    melee: true,
    source: `%name "Dwarf"
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
`,
  },
]

beforeAll(async () => {
  await applySeed(env, await buildSeed(SOURCES, { now: new Date('2026-09-24T12:00:00.000Z') }))
  const insert = (sql: string, ...values: unknown[]) => env.DB.prepare(sql).bind(...values)
  const config = JSON.stringify({ rounds: 3, seed: 1, battle: SEED_HILLS[0]?.config })
  const bracket = JSON.stringify(
    createBracket([{ name: 'Spin' }, { name: 'Dwarf' }], { seeding: 'given' }),
  )
  await env.DB.batch([
    insert("INSERT INTO users (id, handle) VALUES ('u1', 'pedram')"),
    insert(
      `INSERT INTO bots (id, owner_id, slug, name, visibility) VALUES
       ('secret', 'u1', 'secret', 'Secret', 'private'),
       ('quiet', 'u1', 'quiet', 'Quiet', 'unlisted'),
       ('odd', 'u1', 'odd', '<b>&"''', 'public')`,
    ),
    insert(
      `INSERT INTO bot_versions (id, bot_id, version, source, bytes_sha256, size, isa, strategy) VALUES
       ('secret-v1', 'secret', 1, 'hlt', ?1, 1, 'x16c-v1', NULL),
       ('quiet-v1', 'quiet', 1, 'nop', ?1, 1, 'x16c-v1', NULL),
       ('odd-v1', 'odd', 1, 'nop', ?1, 1, 'x16c-v1', 'a strategy with <tags> & "quotes"')`,
      'ab'.repeat(32),
    ),
    insert(
      `INSERT INTO tournaments (id, slug, name, kind, status, config_json, owner_id, starts_at, bracket_json)
       VALUES ('rr', 'rr', 'Round Robin 1', 'roundrobin', 'finished', ?1, NULL, '2026-09-19T18:00:00Z', NULL),
              ('br', 'br', 'Bracket 1', 'bracket', 'running', ?1, NULL, '2026-09-19T18:00:00Z', ?2),
              ('draft', 'draft', 'My draft', 'melee', 'draft', ?1, 'u1', NULL, NULL)`,
      config,
      bracket,
    ),
    insert(
      `INSERT INTO tournament_entries (tournament_id, bot_version_id, seed) VALUES
       ('rr', 'roster-dwarf-v1', 1), ('rr', 'roster-spin-v1', 2),
       ('br', 'roster-spin-v1', 1), ('br', 'roster-dwarf-v1', 2)`,
    ),
    insert(
      `INSERT INTO matches (id, tournament_id, participants_json, rounds, seed, result_json, finished_at)
       VALUES ('rr-0', 'rr', ?1, 3, 1, ?2, '2026-09-19T18:01:00Z')`,
      JSON.stringify(['roster-dwarf-v1', 'roster-spin-v1']),
      JSON.stringify({ points: [7, 1], survivors: [0], resultHash: '0'.repeat(16) }),
    ),
  ])
})

describe('GET /api/bots/:id/og.svg and og.png', () => {
  it('draws the bot: its identicon, name, owner, strategy, size, and best place', async () => {
    const svg = await svgOf('/api/bots/roster-dwarf/og.svg')
    expect(svg).toContain('>Dwarf</text>')
    expect(svg).toContain('by system · ASM Bots')
    expect(svg).toContain('Bomb every 4th byte, walking backward')
    expect(svg).toMatch(/#\d+ on (main|tiny|melee) · score/)
    // The identicon: 8 × 8 cells scaled to 512 px, beside the text.
    expect(svg).toContain('scale(64)')
    await pngOf('/api/bots/roster-dwarf/og.png')
  })

  it('escapes what the owner wrote, and draws an unlisted bot, but not a private one', async () => {
    const odd = await svgOf('/api/bots/odd/og.svg')
    expect(odd).toContain('&lt;b&gt;&amp;&quot;&#39;')
    expect(odd).toContain('a strategy with &lt;tags&gt; &amp; &quot;quotes&quot;')
    await svgOf('/api/bots/quiet/og.svg')
    expect((await get('/api/bots/secret/og.svg')).status).toBe(404)
    expect((await get('/api/bots/secret/og.png')).status).toBe(404)
    expect((await get('/api/bots/nobody/og.png')).status).toBe(404)
  })
})

describe('GET /api/hills/:slug/og.svg and og.png', () => {
  it('draws the hill: its name, rules, and standings, king first', async () => {
    const svg = await svgOf('/api/hills/main/og.svg')
    expect(svg).toContain('>main</text>')
    expect(svg).toContain('2 of 32 places · 10 rounds · 80k cycles · 512 B')
    const kingAt = svg.indexOf('>#1</text>')
    expect(kingAt).toBeGreaterThan(0)
    expect(svg.indexOf('>#2</text>')).toBeGreaterThan(kingAt)
    await pngOf('/api/hills/main/og.png')
    expect((await get('/api/hills/nope/og.png')).status).toBe(404)
  })

  it('says so when nobody holds the hill', async () => {
    const hill = { name: 'empty', size: 8, rounds: 1, config: SEED_HILLS[0]?.config } as Hill
    const svg = hillCard(hill, [], 'asmbots.io')
    expect(wellFormed(svg)).toBe('svg')
    expect(svg).toContain('no entrants yet. submit a bot →')
  })
})

describe('GET /api/tournaments/:id/og.svg and og.png', () => {
  it('draws a round robin by the points its matches give, and its champion', async () => {
    const svg = await svgOf('/api/tournaments/rr/og.svg')
    expect(svg).toContain('>Round Robin 1</text>')
    expect(svg).toContain('round robin · 2 bots · finished')
    expect(svg).toContain('>7 pts</text>')
    expect(svg.indexOf('>Dwarf</text>')).toBeLessThan(svg.indexOf('>Spin</text>'))
    await pngOf('/api/tournaments/rr/og.png')
  })

  it('draws a bracket as a thumbnail of its drawing', async () => {
    const svg = await svgOf('/api/tournaments/br/og.svg')
    expect(svg).toContain('bracket · 2 bots · running')
    // `@asmbots/tourney`'s drawing, fitted into the card, with the entrants' names.
    expect(svg).toMatch(
      /<svg xmlns="http:\/\/www.w3.org\/2000\/svg" x="48" y="240"[^>]*preserveAspectRatio="xMinYMid meet"/,
    )
    expect(svg).toContain('data-match-id="0"')
    await pngOf('/api/tournaments/br/og.png')
  })

  it('has no card for a draft, which nobody shares yet', async () => {
    expect((await get('/api/tournaments/draft/og.svg')).status).toBe(404)
    expect((await get('/api/tournaments/nope/og.png')).status).toBe(404)
  })
})

describe('GET /api/pages/og.svg and og.png', () => {
  it('draws a page the build describes: its label, headline, and description', async () => {
    const svg = await svgOf(`/api/pages/og.svg?path=${encodeURIComponent('/docs/machine/memory')}`)
    expect(svg).toContain('>&#160;// DOCS</tspan>')
    expect(svg).toContain('>memory</text>')
    expect(svg).toContain('one 64 KB ring: wrap, zero as DAT, code as data, and ownership.')
    // The home page's, with no path.
    expect(await svgOf('/api/pages/og.svg')).toContain('Write 8086 assembly.')
    await pngOf('/api/pages/og.png')
  })

  it('draws nothing for a page the build did not describe', async () => {
    expect((await get('/api/pages/og.png?path=/nope')).status).toBe(404)
    expect((await get('/api/pages/og.svg?path=/bots/roster-dwarf')).status).toBe(404)
  })
})

describe('what is not shared', () => {
  it('has no card of a private bot or a draft for its owner either', async () => {
    const jar = new Jar()
    await signIn(jar, 'carder')
    const { user } = await me(jar)
    const insert = (sql: string, ...values: unknown[]) => env.DB.prepare(sql).bind(...values)
    const config = JSON.stringify({ rounds: 3, seed: 1, battle: SEED_HILLS[0]?.config })
    await env.DB.batch([
      insert(
        "INSERT INTO bots (id, owner_id, slug, name, visibility) VALUES ('mine', ?1, 'mine', 'Mine', 'private')",
        user.id,
      ),
      insert(
        `INSERT INTO bot_versions (id, bot_id, version, source, bytes_sha256, size, isa)
         VALUES ('mine-v1', 'mine', 1, 'nop', ?1, 1, 'x16c-v1')`,
        'cd'.repeat(32),
      ),
      insert(
        `INSERT INTO tournaments (id, slug, name, kind, status, config_json, owner_id)
         VALUES ('mydraft', 'mydraft', 'Draft', 'melee', 'draft', ?1, ?2)`,
        config,
        user.id,
      ),
    ])
    // The owner sees both, but neither has a card: a card is for sharing.
    expect((await send(jar, '/api/bots/mine')).status).toBe(200)
    expect((await send(jar, '/api/bots/mine/og.png')).status).toBe(404)
    expect((await send(jar, '/api/tournaments/mydraft')).status).toBe(200)
    expect((await send(jar, '/api/tournaments/mydraft/og.svg')).status).toBe(404)
  })
})

describe('card text', () => {
  it('wraps between words, cuts a word longer than a line, and ends what does not fit', () => {
    expect(wrap('bomb every fourth byte', 10, 3)).toEqual(['bomb every', 'fourth', 'byte'])
    expect(wrap('abcdefghijkl mn', 5, 4)).toEqual(['abcde', 'fghij', 'kl mn'])
    expect(wrap('one two three four five six', 9, 2)).toEqual(['one two', 'three…'])
    expect(wrap('  ', 9, 2)).toEqual([])
  })
})
