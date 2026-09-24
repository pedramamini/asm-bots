/**
 * `bun run seed:local` / `bun run seed:remote` (in `apps/api`): the launch seed (`src/db/seed.ts`)
 * of the roster's bots, less its test bots, into D1 and R2 through wrangler. The showcase bots
 * enter the melee hill. Apply the migrations first; running it again adds nothing.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadRoster, ROSTER } from '@asmbots/bots'
import { buildSeed, type SeedObject, sqlScript } from '../src/db/seed'

const where = process.argv[2]
if (where !== '--local' && where !== '--remote') {
  console.error('usage: bun run scripts/seed.ts --local | --remote')
  process.exit(2)
}

// The package's wrangler, not a global one.
const wrangler = fileURLToPath(new URL('../node_modules/.bin/wrangler', import.meta.url))
const cwd = fileURLToPath(new URL('..', import.meta.url))
const run = (...args: string[]) =>
  execFileSync(wrangler, [...args, where], { cwd, stdio: 'inherit' })

const roster = loadRoster()
const started = performance.now()
const seed = await buildSeed(
  ROSTER.filter((entry) => entry.tier !== 'test').map((entry) => {
    const bot = roster.get(entry.slug)
    if (bot === undefined) throw new Error(`the roster has no bot ${entry.slug}`)
    return { slug: entry.slug, source: bot.source, melee: entry.tier === 'showcase' }
  }),
)
console.log(
  `seed: ${seed.statements.length} rows, ${seed.objects.length} objects in ${Math.round(performance.now() - started)} ms`,
)

const dir = mkdtempSync(join(tmpdir(), 'asmbots-seed-'))
try {
  const sql = join(dir, 'seed.sql')
  writeFileSync(sql, sqlScript(seed.statements))
  run('d1', 'execute', 'asmbots', '--file', sql, '--yes')

  // One bulk put per content type: wrangler takes the type for the whole batch.
  const byType = Map.groupBy(seed.objects, (o: SeedObject) => o.contentType)
  for (const [contentType, objects] of byType) {
    const files = join(dir, contentType.replace('/', '-'))
    mkdirSync(files)
    const list = objects.map((o, i) => {
      const file = join(files, String(i))
      writeFileSync(file, o.body)
      return { key: o.key, file }
    })
    const listFile = join(dir, `${contentType.replace('/', '-')}.json`)
    writeFileSync(listFile, JSON.stringify(list))
    run('r2', 'bulk', 'put', 'asmbots-replays', '--filename', listFile, '--ct', contentType)
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}
