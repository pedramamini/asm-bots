/**
 * A page's `<head>` for link previews and crawlers (PRODUCT_SPEC §10). A page the web build knows
 * (`manifest.ts`) takes its words from the manifest; an arena link that names bots (`?b=`) says
 * which. A page of data takes its words from the data: a stored replay, a bot, a hill, a
 * tournament, a profile, each with its share card as the image. A lookup that finds nothing, fails,
 * or takes past `LOOKUP_MS` gives the route's plain head: its tab title, and the home page's words
 * and card. The tab title is the one the route's `head` writes in the browser, so a page's title
 * does not change as the app starts. Every URL is on `SITE_URL`.
 */
import {
  BRAND,
  DELETED_HANDLE,
  decodeShare,
  entrantNames,
  type PageHead,
  type PageMeta,
  routeTitle,
  SHA256,
} from '@asmbots/protocol'
import type { Context } from 'hono'
import {
  getBot,
  getHillBySlug,
  getTournament,
  getUser,
  getUserByHandle,
  listBotPlacements,
  listBotsByOwner,
  listBotVersions,
  listHillStandings,
  listTournamentEntrants,
} from '../db/queries'
import type { AppEnv } from '../env'
import { log } from '../middleware'
import { bestPlacement } from '../og/bot'
import { clip, count, plural } from '../og/card'
import { winnerLine } from '../og/replay'
import { getReplay } from '../storage'
import { pagesManifest } from './manifest'

/** How long a page waits for its data before it takes its plain head, ms. */
export const LOOKUP_MS = 1000

/** The home page's words when the assets have no manifest. */
export const HOME: PageMeta = {
  title: routeTitle('home'),
  description:
    'A Core War arena for 8086 assembly: up to 16 bots share one 64 KB core, with an editor, a debugger, tournaments, and hills.',
  label: '',
  headline: 'Write 8086 assembly. Fight for 64 KB.',
}

/** The longest description a head carries, in characters. */
const DESCRIPTION = 200

/** What a page of data says of itself; the rest of its head comes from its route. */
interface Found {
  readonly cardTitle: string
  readonly description: string
  /** Its card's path on the site: `/api/bots/b-1/og.png`. */
  readonly image: string
  readonly imageAlt: string
  readonly noindex?: boolean | undefined
}

type Lookup = (c: Context<AppEnv>, key: string) => Promise<Found | null>

/** A route of data: its path, its label and title detail as the web's route writes them. */
interface DataRoute {
  readonly pattern: RegExp
  readonly label: string
  readonly detail: (key: string) => string
  readonly lookup: Lookup
  /** Kept out of search engines, whatever its data says: an embed. */
  readonly noindex?: boolean | undefined
}

/** The site's origin, without a trailing slash. */
export function siteOrigin(env: AppEnv['Bindings']): string {
  return new URL(env.SITE_URL).origin
}

/** The head of the page `c` asks for. */
export async function pageHead(c: Context<AppEnv>): Promise<PageHead> {
  const url = new URL(c.req.url)
  const site = siteOrigin(c.env)
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname
  const pages = (await pagesManifest(c.env, url.origin))?.pages ?? {}
  const home = pages['/'] ?? HOME
  const known = pages[path]
  if (known !== undefined) {
    const head = pageOf(site, path, known)
    return path === '/arena' ? withBattle(head, site, url) : head
  }
  for (const route of DATA_ROUTES) {
    const match = route.pattern.exec(path)
    if (match === null) continue
    const key = decoded(match[1] ?? '')
    const title = routeTitle(route.label, route.detail(key))
    const found = await within(route.lookup(c, key), LOOKUP_MS).catch((error: unknown) => {
      log('warn', 'page head lookup failed', { path, error: String(error) })
      return null
    })
    const canonical = `${site}${path}`
    if (found === null) {
      return {
        ...pageOf(site, '/', home),
        title,
        canonical,
        url: canonical,
        noindex: route.noindex,
      }
    }
    return {
      title,
      cardTitle: found.cardTitle,
      description: clip(found.description, DESCRIPTION),
      canonical,
      url: canonical,
      image: `${site}${found.image}`,
      imageAlt: found.imageAlt,
      noindex: route.noindex === true || found.noindex === true,
    }
  }
  // A path no route owns (the app shows 0x404) or a page the manifest lacks: the home page's
  // words, under index.html's own title.
  return {
    ...pageOf(site, '/', home),
    title: BRAND,
    canonical: `${site}${path}`,
    url: `${site}${path}`,
  }
}

/** The head of a manifest page, its card drawn from its words. */
function pageOf(site: string, path: string, page: PageMeta): PageHead {
  const url = `${site}${path}`
  return {
    title: page.title,
    description: page.description,
    canonical: url,
    url,
    image: `${site}/api/pages/og.png?path=${encodeURIComponent(path)}`,
    imageAlt: `ASM BOTS: ${page.headline}`,
    noindex: page.noindex,
  }
}

/**
 * An arena link that names its bots (`/arena?b=roster:dwarf,roster:imp&seed=7`): the preview says
 * which bots fight, and links the battle; the canonical page stays the arena. A bot of the sharer's
 * browser travels in the fragment, which never reaches the server: it reads as `a local bot`.
 */
function withBattle(head: PageHead, site: string, url: URL): PageHead {
  const link = decodeShare(url.pathname + url.search)
  if (link.bots.length === 0) return head
  const names = link.bots.map((ref) =>
    ref.startsWith('roster:') ? ref.slice('roster:'.length) : 'a local bot',
  )
  const facts = [
    plural(names.length, 'bot'),
    ...(link.rounds === undefined ? [] : [plural(link.rounds, 'round')]),
    ...(link.seed === undefined ? [] : [`seed ${link.seed}`]),
  ]
  return {
    ...head,
    cardTitle: versus(names),
    description: `${facts.join(' · ')}. Open the link to watch the battle live in the arena.`,
    url: `${site}${url.pathname}${url.search}`,
  }
}

/** `dwarf vs imp`, up to three names; more are a count and the first names. */
function versus(names: readonly string[]): string {
  if (names.length <= 3) return names.join(' vs ')
  return `${names.length} bots: ${names.slice(0, 3).join(', ')}, …`
}

/** `text` percent-decoded, or as it is when it does not decode. */
function decoded(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

/** `promise`'s value, or null when it takes past `ms`. */
async function within<T>(promise: Promise<T | null>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms)
  })
  try {
    return await Promise.race([promise, late])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** A replay the server stores: `/arena/<replay key>`. A local replay link's key names nothing here. */
const replayFound: Lookup = async (c, key) => {
  if (!SHA256.test(key)) return null
  const replay = await getReplay(c.env.REPLAYS, key)
  if (replay === null) return null
  const n = replay.bots.length
  const facts = [plural(n, 'bot'), plural(replay.rounds, 'round'), `seed ${replay.seed}`]
  return {
    cardTitle: `${winnerLine(replay)}: ${versus(replay.bots.map((bot) => bot.name))}`,
    description: `${facts.join(' · ')}. Watch the replay: your browser runs every round again and checks its result.`,
    image: `/api/replays/${key}/og.png`,
    imageAlt: `ASM BOTS: ${winnerLine(replay)}`,
  }
}

/** A public or unlisted bot; an unlisted one stays out of search. */
const botFound: Lookup = async (c, id) => {
  const bot = await getBot(c.env.DB, id)
  if (bot === null || bot.visibility === 'private') return null
  const [owner, versions, placements] = await Promise.all([
    getUser(c.env.DB, bot.ownerId),
    listBotVersions(c.env.DB, bot.id),
    listBotPlacements(c.env.DB, bot.id),
  ])
  if (owner === null) return null
  const latest = versions[0]
  const best = bestPlacement(placements)
  const what = latest?.strategy ?? `A ${count(latest?.size ?? 0)}-byte bot for the x16c arena.`
  const where = best === null ? '' : ` #${best.entry.rank} on the ${best.hill.name} hill.`
  return {
    cardTitle: `${bot.name} by ${owner.handle}`,
    description: `${what}${/[.!?]$/.test(what) ? '' : '.'}${where}`,
    image: `/api/bots/${bot.id}/og.png`,
    imageAlt: `ASM BOTS: ${bot.name} by ${owner.handle}`,
    noindex: bot.visibility !== 'public',
  }
}

const hillFound: Lookup = async (c, slug) => {
  const hill = await getHillBySlug(c.env.DB, slug)
  if (hill === null) return null
  const standings = await listHillStandings(c.env.DB, hill.id)
  const king = standings[0]
  const holds =
    king === undefined
      ? 'No entrants yet: submit a bot.'
      : `King: ${king.bot.name} by ${king.bot.owner}, score ${count(king.entry.score)}.`
  return {
    cardTitle: `the ${hill.name} hill`,
    description: `${hill.description} ${standings.length} of ${plural(hill.size, 'place')} taken. ${holds}`,
    image: `/api/hills/${hill.slug}/og.png`,
    imageAlt: `ASM BOTS: the ${hill.name} hill`,
  }
}

const KINDS = { roundrobin: 'round robin', bracket: 'bracket', melee: 'melee' } as const

/** A server tournament; a draft is its owner's, and no one shares it yet. */
const tournamentFound: Lookup = async (c, id) => {
  const t = await getTournament(c.env.DB, id)
  if (t === null || t.status === 'draft') return null
  const entrants = await listTournamentEntrants(c.env.DB, t.id)
  const names = entrantNames(entrants)
  const winner = entrants.findIndex((label) => label.versionId === t.championId)
  const crown = t.status === 'finished' && winner >= 0 ? ` Champion: ${names[winner]}.` : ''
  return {
    cardTitle: t.name,
    description: `A ${KINDS[t.kind]} of ${plural(entrants.length, 'bot')}, ${t.status}.${crown}`,
    image: `/api/tournaments/${t.id}/og.png`,
    imageAlt: `ASM BOTS: ${t.name}`,
  }
}

/** A profile: its public bots and when it joined, under the home page's card. */
const profileFound: Lookup = async (c, handle) => {
  const user = await getUserByHandle(c.env.DB, handle)
  if (user === null || user.handle === DELETED_HANDLE) return null
  const bots = await listBotsByOwner(c.env.DB, user.id, true)
  return {
    cardTitle: `${user.handle} on ASM BOTS`,
    description: `${plural(bots.length, 'public bot')} · joined ${user.createdAt.slice(0, 10)}.`,
    image: `/api/pages/og.png?path=${encodeURIComponent('/')}`,
    imageAlt: 'ASM BOTS: Write 8086 assembly. Fight for 64 KB.',
  }
}

/** Nothing the server can say: a bot of the visitor's browser. */
const nothing: Lookup = async () => null

/** The routes of data, as `apps/web/src/routes` names them and titles them. */
const DATA_ROUTES: readonly DataRoute[] = [
  {
    pattern: /^\/arena\/([^/]+)$/,
    label: 'arena',
    detail: (key) => `replay ${key}`,
    lookup: replayFound,
  },
  {
    pattern: /^\/embed\/arena\/([^/]+)$/,
    label: 'embed',
    detail: (key) => `replay ${key}`,
    lookup: replayFound,
    noindex: true,
  },
  { pattern: /^\/bots\/([^/]+)$/, label: 'bots', detail: (id) => id, lookup: botFound },
  { pattern: /^\/hills\/([^/]+)$/, label: 'hills', detail: (slug) => slug, lookup: hillFound },
  {
    pattern: /^\/tournaments\/([^/]+)$/,
    label: 'tournaments',
    detail: (id) => id,
    lookup: tournamentFound,
  },
  {
    pattern: /^\/u\/([^/]+)$/,
    label: 'profile',
    detail: (handle) => handle,
    lookup: profileFound,
  },
  { pattern: /^\/editor\/([^/]+)$/, label: 'editor', detail: (id) => id, lookup: nothing },
]
