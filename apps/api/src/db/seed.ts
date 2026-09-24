/**
 * The launch seed (PRODUCT_SPEC §5), so the site is never empty: the three default hills, and a
 * `system` user whose roster bots stand on them as public bot versions.
 *
 * `buildSeed` assembles each bot's source with `@asmbots/asm` and fights the hills with the engine
 * (a few seconds for the roster): the duel hills take the bots one challenge at a time
 * (`@asmbots/tourney` `hill`), each challenge a Glicko-2 rating period as a submission is
 * (`rateChallenge`), and the melee hill is one melee of the bots marked for it. The
 * result is rows and R2 objects: its `statements` are D1 statements, every one an `INSERT ... ON
 * CONFLICT DO NOTHING`, so a second run adds nothing. `scripts/seed.ts` loads it
 * into local or remote D1 and R2 with wrangler; the tests load it with `applySeed`.
 */
import { assembleOrThrow } from '@asmbots/asm'
import { DEFAULT_CONFIG, type LoadedBot } from '@asmbots/engine'
import {
  buildReplay,
  HILL_SEED,
  ISA,
  type MatchOutcome,
  type Replay,
  type ReplayConfig,
  replayKey,
  sha256Hex,
} from '@asmbots/protocol'
import {
  createHill,
  DEFAULT_RATING,
  type HillState,
  hill,
  type MatchResult,
  melee,
  type Rating,
} from '@asmbots/tourney'
import { rateChallenge } from '../runner/rating'
import { botBytesKey, replayObjectKey } from '../storage'

/** A bot to seed: its source, and whether it enters the melee hill. */
export interface SeedSource {
  /** The bot's slug and the tail of its ids: `roster-<slug>`. */
  readonly slug: string
  readonly source: string
  readonly melee: boolean
}

/** How a hill scores: one duel per pair, or all its entrants in one core. */
export type HillScoring = 'duel' | 'melee'

export interface SeedHill {
  readonly slug: string
  readonly name: string
  readonly description: string
  readonly size: number
  readonly rounds: number
  readonly config: ReplayConfig
  readonly scoring: HillScoring
}

/** The engine defaults as a hill's config: everything but the seed. */
const { seed: _, ...DEFAULTS } = DEFAULT_CONFIG

/** The hills of PRODUCT_SPEC §5, as `docs/tournaments/hills` gives their rules. */
export const SEED_HILLS: readonly SeedHill[] = [
  {
    slug: 'main',
    name: 'main',
    description: 'the ladder: duels of 10 rounds, 80,000 cycles a round, bots up to 512 bytes.',
    size: 32,
    rounds: 10,
    config: { ...DEFAULTS, maxCycles: 80_000, maxBotBytes: 512 },
    scoring: 'duel',
  },
  {
    slug: 'tiny',
    name: 'tiny',
    description: 'duels of bots up to 256 bytes, 50,000 cycles a round.',
    size: 16,
    rounds: 10,
    config: { ...DEFAULTS, maxBotBytes: 256, maxCycles: 50_000 },
    scoring: 'duel',
  },
  {
    slug: 'melee',
    name: 'melee',
    description: 'eight bots in one core, 10 rounds: ranked by melee points.',
    size: 8,
    rounds: 10,
    config: { ...DEFAULTS },
    scoring: 'melee',
  },
]

/** Every seeded match's seed: the hills' (`HILL_SEED`). */
export const SEED_MATCH_SEED = HILL_SEED

export const SYSTEM_USER = { id: 'system', handle: 'system' } as const

/** A value D1 binds. */
export type SqlValue = string | number | null

export interface SqlStatement {
  readonly sql: string
  readonly params: readonly SqlValue[]
}

export interface SeedObject {
  readonly key: string
  readonly body: Uint8Array | string
  readonly contentType: string
}

export interface Seed {
  readonly statements: readonly SqlStatement[]
  readonly objects: readonly SeedObject[]
}

/** A seeded bot, assembled. */
interface Made {
  readonly slug: string
  readonly botId: string
  readonly versionId: string
  readonly source: string
  readonly bot: LoadedBot
  readonly sha256: string
  readonly author: string | null
  readonly strategy: string | null
  readonly melee: boolean
}

const insert = (table: string, row: Record<string, SqlValue>): SqlStatement => {
  const columns = Object.keys(row)
  return {
    sql: `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')}) ON CONFLICT DO NOTHING`,
    params: Object.values(row),
  }
}

async function make(entry: SeedSource): Promise<Made> {
  const assembled = assembleOrThrow(entry.source, { file: `${entry.slug}.asm` })
  const meta = {
    ...(assembled.author !== '' && { author: assembled.author }),
    ...(assembled.strategy !== '' && { strategy: assembled.strategy }),
  }
  return {
    slug: entry.slug,
    botId: `roster-${entry.slug}`,
    versionId: `roster-${entry.slug}-v1`,
    source: entry.source,
    bot: { name: assembled.name, bytes: assembled.bytes, meta },
    sha256: await sha256Hex(assembled.bytes),
    author: assembled.author || null,
    strategy: assembled.strategy || null,
    melee: entry.melee,
  }
}

/** A seeded match: its row, and its replay for R2. */
interface Fought {
  readonly id: string
  readonly participants: readonly Made[]
  readonly replay: Replay
  readonly key: string
}

async function fought(
  hillSlug: string,
  config: ReplayConfig,
  rounds: number,
  participants: readonly Made[],
  match: MatchResult,
  createdAt: Date,
): Promise<Fought> {
  const replay = await buildReplay({
    bots: participants.map((m) => ({ ...m.bot, source: m.source })),
    config: { ...config, seed: SEED_MATCH_SEED },
    rounds,
    match,
    createdAt,
  })
  return { id: `${hillSlug}-${match.key}`, participants, replay, key: await replayKey(replay) }
}

interface Standing {
  readonly made: Made
  readonly score: number
  readonly wins: number
  readonly ties: number
  readonly losses: number
  readonly age: number
}

/**
 * The duel hill `spec` after each bot, in order, challenges it: its board, its matches, and the
 * ratings the challenges left, by bot version (the entries' and those pushed off).
 */
async function duelHill(spec: SeedHill, bots: readonly Made[], now: Date) {
  const byId = new Map(bots.map((m) => [m.versionId, m]))
  const results = new Map<string, MatchResult>()
  const ratings = new Map<string, Rating>()
  let state: HillState = createHill({
    size: spec.size,
    rounds: spec.rounds,
    battle: { ...spec.config, seed: SEED_MATCH_SEED },
  })
  for (const made of bots) {
    if (made.bot.bytes.length > spec.config.maxBotBytes) continue
    const result = hill(state, { id: made.versionId, bot: made.bot }, (entry) => {
      const defender = byId.get(entry.id)
      if (defender === undefined) throw new Error(`seed: no bot ${entry.id}`)
      return defender.bot
    })
    for (const match of result.matches) results.set(match.key, match)
    const defenders = state.entries.filter((e) => e.id !== result.replaced?.id).map((e) => e.id)
    const rated = rateChallenge((id) => ratings.get(id), made.versionId, defenders, result.matches)
    for (const [id, rating] of rated) ratings.set(id, rating)
    state = result.state
  }
  const matches = await Promise.all(
    state.matches.map((m) => {
      const match = results.get(m.key)
      if (match === undefined) throw new Error(`seed: no match ${m.key}`)
      const participants = m.entries.map((id) => byId.get(id) as Made)
      return fought(spec.slug, spec.config, spec.rounds, participants, match, now)
    }),
  )
  const standings: Standing[] = state.entries.map((e) => ({
    made: byId.get(e.id) as Made,
    score: e.points,
    wins: e.wins,
    ties: e.ties,
    losses: e.losses,
    age: e.age,
  }))
  return { standings, matches, ratings }
}

/** The melee hill `spec`: one melee of the bots marked for it, up to its size. */
async function meleeHill(spec: SeedHill, bots: readonly Made[], now: Date) {
  const entrants = bots
    .filter((m) => m.melee && m.bot.bytes.length <= spec.config.maxBotBytes)
    .slice(0, spec.size)
  if (entrants.length < 2) {
    return { standings: [], matches: [], ratings: new Map<string, Rating>() }
  }
  const result = melee(
    entrants.map((m) => m.bot),
    { ...spec.config, seed: SEED_MATCH_SEED },
    spec.rounds,
  )
  const standings: Standing[] = result.standings.map((s) => ({
    made: entrants[s.entrant] as Made,
    score: s.points,
    wins: s.wins,
    ties: s.ties,
    losses: s.losses,
    age: 0,
  }))
  const match = await fought(spec.slug, spec.config, spec.rounds, entrants, result.match, now)
  return { standings, matches: [match], ratings: new Map<string, Rating>() }
}

/**
 * The seed of `sources` on `hills`: rows for the system user, each bot and its version 1, each
 * hill, its standings, and its matches; R2 objects for each bot's bytes and each match's replay.
 * Throws `AssembleError` for a source with errors. `now` stamps every row: the matches finish a
 * second apart in the order the hill played them, so the newest is the last challenger's.
 */
export async function buildSeed(
  sources: readonly SeedSource[],
  { hills = SEED_HILLS, now = new Date() }: { hills?: readonly SeedHill[]; now?: Date } = {},
): Promise<Seed> {
  const at = now.toISOString()
  const bots = await Promise.all(sources.map(make))
  const statements: SqlStatement[] = [
    insert('users', { id: SYSTEM_USER.id, handle: SYSTEM_USER.handle, created_at: at }),
  ]
  const objects: SeedObject[] = []
  for (const m of bots) {
    statements.push(
      insert('bots', {
        id: m.botId,
        owner_id: SYSTEM_USER.id,
        slug: m.slug,
        name: m.bot.name,
        visibility: 'public',
        created_at: at,
        updated_at: at,
      }),
      insert('bot_versions', {
        id: m.versionId,
        bot_id: m.botId,
        version: 1,
        source: m.source,
        bytes_sha256: m.sha256,
        size: m.bot.bytes.length,
        author: m.author,
        strategy: m.strategy,
        isa: ISA,
        created_at: at,
      }),
    )
    objects.push({
      key: botBytesKey(m.sha256),
      body: m.bot.bytes,
      contentType: 'application/octet-stream',
    })
  }
  for (const spec of hills) {
    const hillId = `hill-${spec.slug}`
    statements.push(
      insert('hills', {
        id: hillId,
        slug: spec.slug,
        name: spec.name,
        description: spec.description,
        size: spec.size,
        rounds: spec.rounds,
        config_json: JSON.stringify(spec.config),
        scoring: spec.scoring,
        created_at: at,
      }),
    )
    const { standings, matches, ratings } =
      spec.scoring === 'duel' ? await duelHill(spec, bots, now) : await meleeHill(spec, bots, now)
    for (const [versionId, r] of ratings) {
      statements.push(
        insert('ratings', {
          bot_version_id: versionId,
          hill_id: hillId,
          rating: r.rating,
          rd: r.rd,
          volatility: r.volatility,
          updated_at: at,
        }),
      )
    }
    standings.forEach((s, i) => {
      statements.push(
        insert('hill_entries', {
          hill_id: hillId,
          bot_version_id: s.made.versionId,
          score: s.score,
          rating: ratings.get(s.made.versionId)?.rating ?? DEFAULT_RATING.rating,
          wins: s.wins,
          ties: s.ties,
          losses: s.losses,
          age: s.age,
          entered_at: at,
          rank: i + 1,
        }),
      )
    })
    matches.forEach((m, i) => {
      const { points, survivors, resultHash } = m.replay.result
      const duel = m.participants.length === 2
      statements.push(
        insert('matches', {
          id: m.id,
          hill_id: hillId,
          a_version_id: duel ? (m.participants[0]?.versionId ?? null) : null,
          b_version_id: duel ? (m.participants[1]?.versionId ?? null) : null,
          participants_json: JSON.stringify(m.participants.map((p) => p.versionId)),
          rounds: spec.rounds,
          seed: SEED_MATCH_SEED,
          result_json: JSON.stringify({ points, survivors, resultHash } satisfies MatchOutcome),
          replay_key: m.key,
          finished_at: new Date(now.getTime() + i * 1000).toISOString(),
        }),
      )
      objects.push({
        key: replayObjectKey(m.key),
        body: JSON.stringify(m.replay),
        contentType: 'application/json',
      })
    })
  }
  return { statements, objects }
}

/** Loads `seed` into the Worker's bindings: every row in one D1 batch, then every object. */
export async function applySeed(
  env: { readonly DB: D1Database; readonly REPLAYS: R2Bucket },
  seed: Seed,
): Promise<void> {
  await env.DB.batch(seed.statements.map(({ sql, params }) => env.DB.prepare(sql).bind(...params)))
  await Promise.all(
    seed.objects.map(({ key, body, contentType }) =>
      env.REPLAYS.put(key, body, { httpMetadata: { contentType } }),
    ),
  )
}

/** `value` as a SQL literal. */
function literal(value: SqlValue): string {
  if (value === null) return 'NULL'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new RangeError(`seed: ${value} is not a SQL number`)
    return String(value)
  }
  return `'${value.replaceAll("'", "''")}'`
}

/** `statements` as one SQL script, the values inlined: what `wrangler d1 execute --file` runs. */
export function sqlScript(statements: readonly SqlStatement[]): string {
  return statements
    .map(({ sql, params }) => {
      let i = 0
      return `${sql.replace(/\?/g, () => literal(params[i++] as SqlValue))};\n`
    })
    .join('')
}
