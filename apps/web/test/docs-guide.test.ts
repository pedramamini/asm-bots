/**
 * The tournament, tools, changelog, and ISA pages (EXEC 2.6 task 4) against the code they
 * describe: the entrant limits, the bracket pairings, the rating examples, the hash of the
 * verification example, the replay example (run again), the share link example and its limits,
 * the CLI's flags, exit codes, and known gaps, and the keyboard map against the key tables. Edit
 * a page or the code under it, and this says whether the two still agree.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { MAX_BOT_BYTES } from '@asmbots/asm'
import { fighter, GOLDEN_MATCHUPS, HILL_RULES, ROSTER } from '@asmbots/bots'
import { DEFAULT_CONFIG, resultHash, simulate } from '@asmbots/engine'
import { ISA as REPLAY_ISA, replayConfig, replayMatch, sha256Hex } from '@asmbots/protocol'
import {
  createBracket,
  csv,
  DEFAULT_RATING,
  type Rating,
  roundRobinSchedule,
  runMatch,
  updateRating,
} from '@asmbots/tourney'
import { ISA, NAV } from '../src/app/Frame'
import {
  ARENA_KEYS,
  DEBUG_FUNCTION_KEYS,
  DEBUG_KEYS,
  EDITOR_KEYS,
  GLOBAL_KEYS,
  SOURCE_KEYS,
} from '../src/app/keymaps'
import { allBindings } from '../src/docs/keymap'
import { replayName } from '../src/features/arena/battle/files'
import { readReplay } from '../src/features/arena/battle/replay'
import {
  CYCLES,
  MAX_ARENA_BOTS,
  PRESET_NAMES,
  PRESETS,
  PROCS,
  ROUNDS,
  SEED,
  SPACING,
} from '../src/features/arena/setup/config'
import { shareUrl } from '../src/features/arena/setup/url'
import {
  ENTRANT_LIMITS,
  INSTRUCTIONS_PER_SECOND,
  ROUND_ROBIN_WARN_ABOVE,
} from '../src/features/tournaments/create'

const DOCS_DIR = new URL('../src/docs/', import.meta.url).pathname
const CLI = new URL('../../cli/src/main.ts', import.meta.url).pathname
const ROSTER_DIR = new URL('../../../packages/bots/roster/', import.meta.url).pathname

const mdx = (page: string): string => readFileSync(`${DOCS_DIR}${page}.mdx`, 'utf8')

/** The rows of the first table on `page` whose header row is `header`, as cells. */
function table(page: string, header: string): string[][] {
  const lines = mdx(page).split('\n')
  const at = lines.indexOf(header)
  expect(at).toBeGreaterThanOrEqual(0)
  const rows: string[][] = []
  for (const line of lines.slice(at + 2)) {
    if (!line.startsWith('|')) break
    rows.push(
      line
        .slice(1, -1)
        .split('|')
        .map((cell) => cell.trim()),
    )
  }
  return rows
}

describe('tournaments/formats', () => {
  it('the entrant limits, the match counts, and the estimate', () => {
    const rows = table('tournaments/formats', '| format | bots | plays | ranks by |')
    const limits = Object.fromEntries(rows.map(([kind, bots]) => [kind, bots]))
    expect(limits).toEqual({
      'round robin': `${ENTRANT_LIMITS['round-robin'].min} to ${ENTRANT_LIMITS['round-robin'].max}`,
      bracket: `${ENTRANT_LIMITS.bracket.min} to ${ENTRANT_LIMITS.bracket.max}`,
      melee: `${ENTRANT_LIMITS.melee.min} to ${ENTRANT_LIMITS.melee.max}`,
    })
    const page = mdx('tournaments/formats')
    const counts = [8, 12, 32].map((bots) => roundRobinSchedule(bots).length)
    expect(page).toContain(`${counts[0]} for 8 bots, ${counts[1]} for 12, ${counts[2]} for 32`)
    expect(page).toContain(`Above ${ROUND_ROBIN_WARN_ABOVE} bots the form warns`)
    expect(INSTRUCTIONS_PER_SECOND).toBe(20_000_000)
    expect(page).toContain('at 20 million instructions a second')
    for (const name of PRESET_NAMES) expect(page).toContain(`\`${name}\``)
    expect(page).toContain(`\`${csv([]).trim()}\``)
  })
})

describe('tournaments/brackets', () => {
  it('the first-round pairings of 8 places', () => {
    const rows = table(
      'tournaments/brackets',
      '| 8 places | match 1 | match 2 | match 3 | match 4 |',
    )
    for (const [label, ...cells] of rows) {
      const bots = Number(/^(\d+) bots$/.exec(label as string)?.[1])
      const bracket = createBracket(
        Array.from({ length: bots }, (_, i) => ({ name: `seed ${i + 1}` })),
        { seeding: 'given' },
      )
      expect(bracket.size).toBe(8)
      const firsts = bracket.matches
        .filter((m) => m.round === 0)
        .map((m) =>
          m.slots
            .map((s) => (s.state === 'bye' ? 'bye' : String((s.source as { seed: number }).seed)))
            .join(' v '),
        )
      expect({ bots, firsts }).toEqual({ bots, firsts: cells })
    }
  })
})

describe('tournaments/hills', () => {
  it('the hill rules preset is 10 rounds of 80,000 cycles', () => {
    expect(PRESETS['hill rules']).toMatchObject({ rounds: 10, maxCycles: 80_000 })
    expect(HILL_RULES.maxCycles).toBe(80_000)
    expect(mdx('tournaments/hills')).toContain('10 rounds of 80,000 cycles')
  })
})

describe('tournaments/ratings', () => {
  const parse = (text: string): Rating => {
    const m = /(\d+) ± (\d+)/.exec(text)
    if (m === null) throw new Error(`no rating in "${text}"`)
    return { rating: Number(m[1]), rd: Number(m[2]), volatility: DEFAULT_RATING.volatility }
  }
  const shown = (r: Rating) => `${Math.round(r.rating)} ± ${Math.round(r.rd)}`

  it('each example row is one rating period', () => {
    const rows = table('tournaments/ratings', '| before | the game | after |')
    expect(rows).toHaveLength(6)
    for (const [before, game, after] of rows) {
      const me = before?.startsWith('new') ? DEFAULT_RATING : parse(before as string)
      const games =
        game === 'no games'
          ? []
          : [
              {
                opponent: game?.includes('new') ? DEFAULT_RATING : parse(game as string),
                score: game?.startsWith('beats') ? 1 : game?.startsWith('ties') ? 0.5 : 0,
              } as const,
            ]
      expect({ before, game, after: shown(updateRating(me, games)) }).toEqual({
        before,
        game,
        after,
      })
    }
  })

  it("Glickman's example", () => {
    const after = updateRating({ rating: 1500, rd: 200, volatility: 0.06 }, [
      { opponent: { rating: 1400, rd: 30 }, score: 1 },
      { opponent: { rating: 1550, rd: 100 }, score: 0 },
      { opponent: { rating: 1700, rd: 300 }, score: 0 },
    ])
    expect(mdx('tournaments/ratings')).toContain(`After: ${shown(after)}.`)
    expect(DEFAULT_RATING).toEqual({ rating: 1500, rd: 350, volatility: 0.06 })
  })
})

describe('tournaments/verification', () => {
  it('the example result hash, and the golden count', () => {
    const result = simulate([fighter('dwarf'), fighter('imp')], { ...HILL_RULES, seed: 1 })
    expect(result.survivors).toEqual([0])
    const page = mdx('tournaments/verification')
    expect(page).toContain(`ends at cycle ${result.cycles.toLocaleString('en-US')} with the dwarf`)
    expect(page).toContain(`hashes to \`${resultHash(result)}\``)
    const rounds = GOLDEN_MATCHUPS.reduce((sum, m) => sum + m.seeds.length, 0)
    expect(page).toContain(`the roster's ${rounds} golden rounds`)
  })
})

describe('tools/replay-format', () => {
  const json = /```json\n([\s\S]*?)\n```/.exec(mdx('tools/replay-format'))?.[1] ?? ''

  it('the example is a replay the arena reads, and the match plays to what it records', async () => {
    const replay = readReplay(JSON.parse(json))
    expect(JSON.parse(json)).toEqual(replay)
    expect(replay.isa).toBe(REPLAY_ISA)
    const slugs = ['dwarf', 'imp']
    const bots = slugs.map((slug) => fighter(slug))
    for (const [i, bot] of replay.bots.entries()) {
      const bytes = (bots[i] as { bytes: Uint8Array }).bytes
      expect(bot.name).toBe(bots[i]?.name as string)
      expect(bot.bytes).toBe(Buffer.from(bytes).toString('base64'))
      expect(bot.sha256).toBe(await sha256Hex(bytes))
    }
    expect(replayConfig(replay)).toEqual({ ...DEFAULT_CONFIG, seed: 1 })
    expect(runMatch(bots, { seed: 1 }, 1)).toEqual(replayMatch(replay))
    expect(mdx('tools/replay-format')).toContain(`\`${replayName(['Dwarf', 'Imp'], 1)}\``)
  })

  it('the limits', () => {
    const page = mdx('tools/replay-format')
    expect(page).toContain(`${ROUNDS.min} to ${ROUNDS.max} rounds`)
    expect(page).toContain(`up to ${CYCLES.max.toLocaleString('en-US')} cycles`)
    expect(page).toContain(`up to ${PROCS.max} processes a bot`)
    expect(page).toContain(`2 to ${MAX_ARENA_BOTS} bots`)
  })
})

describe('tools/share-links', () => {
  it('the example link is the one the arena makes, and the ranges are the setup limits', () => {
    const page = mdx('tools/share-links')
    const example = /```text\n(\/arena\?[^\n]+)\n```/.exec(page)?.[1]
    const url = shareUrl(
      '',
      {
        bots: [
          { kind: 'roster', slug: 'dwarf' },
          { kind: 'roster', slug: 'imp' },
        ],
        config: { ...PRESETS.duel, preset: 'duel', seed: 42 },
      },
      [],
    )
    expect(url).toBe(example as string)
    const rows = Object.fromEntries(table('tools/share-links', '| key | holds |'))
    const range = (l: { min: number; max: number }) =>
      `${l.min.toLocaleString('en-US')} to ${l.max.toLocaleString('en-US')}`
    expect(rows['`seed`']).toContain(range(SEED))
    expect(rows['`cycles`']).toContain(range(CYCLES))
    expect(rows['`rounds`']).toContain(range(ROUNDS))
    expect(rows['`procs`']).toContain(range(PROCS))
    expect(rows['`spacing`']).toContain(`${range(SPACING)} bytes`)
    expect(rows['`b`']).toContain(`Up to ${MAX_ARENA_BOTS}.`)
  })
})

describe('tools/cli', () => {
  const run = (...args: string[]) => {
    const out = Bun.spawnSync(['bun', CLI, ...args, '--no-color'], { env: { ...process.env } })
    return { code: out.exitCode, text: `${out.stdout.toString()}${out.stderr.toString()}` }
  }

  it("every flag on the page is in its command's help", () => {
    const page = mdx('tools/cli')
    for (const command of ['asm', 'dis', 'fight', 'tourney', 'bench']) {
      const section = page.split(`## ${command}\n`)[1]?.split(/\n## |<Warn>/)[0] ?? ''
      const help = run(command, '--help').text
      for (const [flag] of section.matchAll(/--[a-z][a-z-]+/g)) {
        expect({ command, flag, inHelp: help.includes(flag) }).toEqual({
          command,
          flag,
          inHelp: true,
        })
      }
    }
  })

  it('the exit codes, and the gaps the page warns of', () => {
    expect(run('fight', 'roster:nope', 'roster:imp').code).toBe(3)
    expect(run('fight', 'roster:imp', 'roster:dwarf', '--trace-bot', 'Nobody').code).toBe(1)
    expect(run('asm', `${ROSTER_DIR}dwarf.asm`, '--max-bytes', '8').code).toBe(2)
    expect(run('golden').text).toContain('Bun.run is not a function')
    expect(run('asm', '--help').text).toContain('(not yet implemented)')
    expect(MAX_BOT_BYTES).toBe(512)
  })
})

describe('tools/keys', () => {
  it('the keyboard map holds every key the pages register', () => {
    const shown = allBindings().map((b) => `${b.keys.join(' ')}: ${b.description}`)
    const want = [
      ...Object.values(GLOBAL_KEYS),
      ...Object.values(ARENA_KEYS),
      ...Object.values(EDITOR_KEYS),
      ...Object.values(DEBUG_KEYS),
      ...Object.values(SOURCE_KEYS),
    ].map((b) => `${b.keys.join(' ')}: ${b.description}`)
    for (const line of want) expect(shown).toContain(line)
    for (const { key, label } of NAV) expect(shown).toContain(`g ${key}: go to ${label}`)
    const functionKeys = allBindings().filter(
      (b) => b.group === 'debugger' && /^(shift\+)?F\d+$/.test(b.keys.join(' ')),
    )
    expect(functionKeys).toHaveLength(DEBUG_FUNCTION_KEYS.length)
    expect(shown).toContain('1..9: isolate bot n')
  })
})

describe('changelog and isa versions', () => {
  it('the ISA names match the status bar and the replay format', () => {
    expect(ISA).toBe('x16c v1')
    expect(REPLAY_ISA).toBe('x16c-v1')
    const page = mdx('isa-versions')
    expect(page).toContain(`(\`${ISA}\`)`)
    expect(page).toContain(`(\`"isa": "${REPLAY_ISA}"\`)`)
  })

  it('the roster counts', () => {
    const tests = ROSTER.filter((r) => r.tier === 'test').length
    const page = mdx('changelog')
    expect(page).toContain(`${ROSTER.length - tests} fighters and painters`)
    expect(page).toContain(`plus ${tests} test bots`)
  })
})
