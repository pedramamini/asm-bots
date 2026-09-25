/**
 * Each page's head for link previews and crawlers (PRODUCT_SPEC §10), the sitemap, and who may
 * frame what. The Worker writes into index.html the web build's words (the test site's
 * `meta/pages.json`), or a replay's, a bot's, a hill's, a tournament's, or a profile's own, and
 * each one's share card as the image. Every URL is on `SITE_URL`, `https://asmbots.io`.
 */
import { env, exports } from 'cloudflare:workers'
import { beforeAll, describe, expect, it } from 'vitest'
import { applySeed, buildSeed, SEED_HILLS } from '../src/db/seed'
import { wellFormed } from './xml'

const worker = exports.default
const SITE = 'https://asmbots.io'
/** What a browser sends when it loads a page. */
const NAVIGATE = { headers: { Accept: 'text/html', 'Sec-Fetch-Mode': 'navigate' } }

function get(path: string, init: RequestInit = NAVIGATE): Promise<Response> {
  return worker.fetch(new Request(`https://asmbots.test${path}`, init))
}

/** The page at `path`, and what its head says. */
async function page(path: string) {
  const res = await get(path)
  expect(res.status, path).toBe(200)
  const html = await res.text()
  const head = html.slice(0, html.indexOf('</head>'))
  /** Every `content` of the `<meta>` named `name` (a property or a name). */
  const all = (name: string) =>
    [...head.matchAll(/<meta (?:name|property)="([^"]+)" content="([^"]*)"/g)]
      .filter((m) => m[1] === name)
      .map((m) => m[2])
  const one = (name: string) => {
    const found = all(name)
    expect(found, `${path}: ${name}`).toHaveLength(1)
    return found[0] as string
  }
  return {
    res,
    html,
    head,
    title: /<title>([^<]*)<\/title>/.exec(head)?.[1],
    canonical: [...head.matchAll(/<link rel="canonical" href="([^"]*)"/g)].map((m) => m[1]),
    all,
    one,
  }
}

const SOURCES = [
  {
    slug: 'spin',
    melee: true,
    source: '%name "Spin"\n%author "ASM Bots"\n%strategy "Jump to itself"\nstart: jmp $\n',
  },
  {
    slug: 'halt',
    melee: true,
    source: '%name "Halt"\n%author "ASM Bots"\nstart: hlt ; lint: allow hlt-in-code\n',
  },
]

/** A match of the seed that has a replay in R2. */
let replayKey = ''

beforeAll(async () => {
  await applySeed(env, await buildSeed(SOURCES, { now: new Date('2026-09-24T12:00:00.000Z') }))
  const insert = (sql: string, ...values: unknown[]) => env.DB.prepare(sql).bind(...values)
  const config = JSON.stringify({ rounds: 3, seed: 1, battle: SEED_HILLS[0]?.config })
  await env.DB.batch([
    insert("INSERT INTO users (id, handle) VALUES ('u1', 'pedram')"),
    insert(
      `INSERT INTO bots (id, owner_id, slug, name, visibility, updated_at) VALUES
       ('secret', 'u1', 'secret', 'Secret', 'private', '2026-09-20T00:00:00.000Z'),
       ('quiet', 'u1', 'quiet', 'Quiet', 'unlisted', '2026-09-20T00:00:00.000Z')`,
    ),
    insert(
      `INSERT INTO tournaments (id, slug, name, kind, status, config_json, owner_id, starts_at, champion_id)
       VALUES ('t1', 'weekly-1', 'Weekly 1', 'roundrobin', 'finished', ?1, NULL, '2026-09-19T18:00:00Z', 'roster-spin-v1'),
              ('t2', 'my-draft', 'My draft', 'melee', 'draft', ?1, 'u1', NULL, NULL)`,
      config,
    ),
    insert(
      `INSERT INTO tournament_entries (tournament_id, bot_version_id, seed) VALUES
       ('t1', 'roster-spin-v1', 1), ('t1', 'roster-halt-v1', 2)`,
    ),
  ])
  replayKey =
    (await env.DB.prepare(
      'SELECT replay_key FROM matches WHERE replay_key IS NOT NULL',
    ).first<string>('replay_key')) ?? ''
})

describe('a page the web build describes', () => {
  it('takes the manifest’s words in place of index.html’s, and its card', async () => {
    const home = await page('/')
    expect(home.title).toBe('ASM BOTS // HOME')
    expect(home.one('description')).toBe('Write 8086 assembly. Fight for 64 KB.')
    expect(home.one('og:title')).toBe('ASM BOTS // HOME')
    expect(home.one('og:image')).toBe(`${SITE}/api/pages/og.png?path=%2F`)
    expect(home.one('og:image:width')).toBe('1200')
    expect(home.one('twitter:card')).toBe('summary_large_image')
    expect(home.one('twitter:image')).toBe(home.one('og:image'))
    expect(home.canonical).toEqual([`${SITE}/`])
    expect(home.all('robots')).toEqual([])
    expect(home.head).not.toContain('the build')
    // The body is the app's, and the ETag named the file, not this page.
    expect(home.html).toContain('spa shell')
    expect(home.res.headers.get('ETag')).toBeNull()

    const docs = await page('/docs/machine/memory/')
    expect(docs.title).toBe('ASM BOTS // DOCS · memory')
    expect(docs.one('og:description')).toBe(
      'one 64 KB ring: wrap, zero as DAT, code as data, and ownership.',
    )
    expect(docs.one('og:image')).toBe(`${SITE}/api/pages/og.png?path=%2Fdocs%2Fmachine%2Fmemory`)
    expect(docs.canonical).toEqual([`${SITE}/docs/machine/memory`])
  })

  it('names the bots an arena link fights, and links the battle', async () => {
    const arena = await page('/arena?b=roster:dwarf,roster:imp,local:x1&seed=7&rounds=3')
    expect(arena.title).toBe('ASM BOTS // ARENA')
    expect(arena.one('og:title')).toBe('dwarf vs imp vs a local bot')
    expect(arena.one('og:description')).toBe(
      '3 bots · 3 rounds · seed 7. Open the link to watch the battle live in the arena.',
    )
    expect(arena.one('og:url')).toBe(
      `${SITE}/arena?b=roster:dwarf,roster:imp,local:x1&amp;seed=7&amp;rounds=3`,
    )
    expect(arena.canonical).toEqual([`${SITE}/arena`])
    // The arena alone says what the arena is.
    expect((await page('/arena')).one('og:title')).toBe('ASM BOTS // ARENA')
  })

  it('keeps an embed and the settings out of search', async () => {
    expect((await page('/embed/arena?b=roster:dwarf,roster:imp')).one('robots')).toBe('noindex')
    expect((await page('/settings')).one('robots')).toBe('noindex')
  })

  it('leaves the title of a path no route owns, and says what the site is', async () => {
    const nope = await page('/nope/nothing')
    expect(nope.title).toBe('ASM BOTS')
    expect(nope.one('description')).toBe('Write 8086 assembly. Fight for 64 KB.')
  })
})

describe('a page of data', () => {
  it('a stored replay: who won, and its card', async () => {
    expect(replayKey).toMatch(/^[0-9a-f]{64}$/)
    const replay = await page(`/arena/${replayKey}`)
    expect(replay.title).toBe(`ASM BOTS // ARENA · replay ${replayKey}`)
    expect(replay.one('og:title')).toMatch(/^(.+ wins|a draw|no winner|.+ tie): .+ vs .+$/)
    expect(replay.one('og:description')).toMatch(
      /^2 bots · \d+ rounds? · seed \d+\. Watch the replay/,
    )
    expect(replay.one('og:image')).toBe(`${SITE}/api/replays/${replayKey}/og.png`)
    expect(replay.canonical).toEqual([`${SITE}/arena/${replayKey}`])
    // A replay the server does not store (a link's own): the route's title, the site's words.
    const linked = await page(`/arena/${'0'.repeat(64)}`)
    expect(linked.title).toBe(`ASM BOTS // ARENA · replay ${'0'.repeat(64)}`)
    expect(linked.one('og:image')).toBe(`${SITE}/api/pages/og.png?path=%2F`)
    // Its embed: the same words, kept out of search.
    const embed = await page(`/embed/arena/${replayKey}`)
    expect(embed.title).toBe(`ASM BOTS // EMBED · replay ${replayKey}`)
    expect(embed.one('og:image')).toBe(`${SITE}/api/replays/${replayKey}/og.png`)
    expect(embed.one('robots')).toBe('noindex')
  })

  it('a bot: its name and owner, its strategy, its card; an unlisted one kept out of search', async () => {
    const spin = await page('/bots/roster-spin')
    expect(spin.title).toBe('ASM BOTS // BOTS · roster-spin')
    expect(spin.one('og:title')).toBe('Spin by system')
    expect(spin.one('og:description')).toMatch(/^Jump to itself\. #\d+ on the \w+ hill\.$/)
    expect(spin.one('og:image')).toBe(`${SITE}/api/bots/roster-spin/og.png`)
    expect(spin.all('robots')).toEqual([])
    expect((await page('/bots/quiet')).one('robots')).toBe('noindex')
    // A private bot says nothing of itself.
    const secret = await page('/bots/secret')
    expect(secret.title).toBe('ASM BOTS // BOTS · secret')
    expect(secret.head).not.toContain('Secret')
    expect(secret.one('og:image')).toBe(`${SITE}/api/pages/og.png?path=%2F`)
  })

  it('a hill: its king, and its standings card', async () => {
    const main = await page('/hills/main')
    expect(main.title).toBe('ASM BOTS // HILLS · main')
    expect(main.one('og:title')).toBe('the main hill')
    expect(main.one('og:description')).toMatch(/2 of 32 places taken\. King: \w+ by system, score/)
    expect(main.one('og:image')).toBe(`${SITE}/api/hills/main/og.png`)
  })

  it('a tournament: its kind, state, and champion; a draft says nothing', async () => {
    const weekly = await page('/tournaments/t1')
    expect(weekly.title).toBe('ASM BOTS // TOURNAMENTS · t1')
    expect(weekly.one('og:title')).toBe('Weekly 1')
    expect(weekly.one('og:description')).toBe('A round robin of 2 bots, finished. Champion: Spin.')
    expect(weekly.one('og:image')).toBe(`${SITE}/api/tournaments/t1/og.png`)
    const draft = await page('/tournaments/t2')
    expect(draft.head).not.toContain('My draft')
  })

  it('a profile: its public bots, under the site’s card', async () => {
    const profile = await page('/u/pedram')
    expect(profile.title).toBe('ASM BOTS // PROFILE · pedram')
    expect(profile.one('og:title')).toBe('pedram on ASM BOTS')
    expect(profile.one('og:description')).toMatch(/^0 public bots · joined \d{4}-\d{2}-\d{2}\.$/)
  })
})

describe('what may frame a page', () => {
  it('lets any site frame an embed, only the site frame the rest, and keeps the API’s policy', async () => {
    const embed = await get('/embed/arena?b=roster:dwarf,roster:imp')
    expect(embed.headers.get('Content-Security-Policy')).toBe('frame-ancestors *')
    const arena = await get('/arena')
    expect(arena.headers.get('Content-Security-Policy')).toBe("frame-ancestors 'self'")
    expect(arena.headers.get('Strict-Transport-Security')).toContain('max-age=')
    const api = await get('/api/health')
    expect(api.headers.get('Content-Security-Policy')).toContain("default-src 'self'")
  })

  it('answers a HEAD of a page with its headers alone', async () => {
    const res = await get('/', { method: 'HEAD' })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/html')
  })
})

describe('GET /sitemap.xml', () => {
  it('is the build’s sitemap with each hill and each public bot added', async () => {
    const res = await get('/sitemap.xml', {})
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/xml; charset=utf-8')
    const xml = await res.text()
    expect(wellFormed(xml)).toBe('urlset')
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
    // The build's pages first.
    expect(locs.slice(0, 3)).toEqual([`${SITE}/`, `${SITE}/arena`, `${SITE}/docs/machine/memory`])
    for (const slug of ['main', 'melee', 'tiny']) expect(locs).toContain(`${SITE}/hills/${slug}`)
    expect(locs).toContain(`${SITE}/bots/roster-spin`)
    expect(xml).toMatch(
      /<loc>https:\/\/asmbots\.io\/bots\/roster-spin<\/loc><lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/,
    )
    // Not a private bot, nor one only its link finds.
    expect(locs).not.toContain(`${SITE}/bots/secret`)
    expect(locs).not.toContain(`${SITE}/bots/quiet`)
  })
})
