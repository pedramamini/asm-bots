import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type Assembled,
  assemble,
  DIAG_CODES,
  formatDiag,
  formatSource,
  lint,
  MAX_BOT_BYTES,
  tokenize,
} from '@asmbots/asm'
import * as byName from '@asmbots/bots'
import { loadRoster, ROSTER, ROSTER_FAMILIES, ROSTER_TIERS } from '../src/roster'

const PACKAGE = join(import.meta.dir, '..')
const ROSTER_DIR = join(PACKAGE, 'roster')

const bots = loadRoster()

/** The roster bot of `slug`. */
function botOf(slug: string) {
  const bot = bots.get(slug)
  if (bot === undefined) throw new Error(`loadRoster has no bot '${slug}'`)
  return bot
}

/** An allow comment, `; lint: allow <code>: <reason>`: a `code` warning on its line is allowed. */
interface Allow {
  line: number
  code: string
}

const ALLOW = /^;\s*lint:\s*allow\s+([\w-]+)\s*:\s*\S/

/** The allow comments of `source`, and a problem for each comment that starts `; lint:` badly. */
function allowsOf(file: string, source: string) {
  const allows: Allow[] = []
  const problems: string[] = []
  for (const t of tokenize(source, [], { comments: true })) {
    if (t.kind !== 'comment' || !/^;\s*lint:/.test(t.text)) continue
    const at = `${file}:${t.line}:${t.col}`
    const code = ALLOW.exec(t.text)?.[1]
    if (code === undefined) {
      problems.push(`${at}: an allow comment reads \`; lint: allow <code>: <reason>\``)
    } else if (!(DIAG_CODES as readonly string[]).includes(code)) {
      problems.push(`${at}: \`${code}\` is not a diagnostic code`)
    } else {
      allows.push({ line: t.line, code })
    }
  }
  return { allows, problems }
}

/**
 * What keeps `source` from being lint-clean: bad allow comments, warnings that no allow comment
 * on their line allows, and allow comments that allow no warning. Empty when it is clean.
 */
function lintProblems(file: string, source: string, assembled: Assembled): string[] {
  const { allows, problems } = allowsOf(file, source)
  const used = new Set<Allow>()
  for (const warning of lint(source, assembled)) {
    const allow = allows.find((a) => a.line === warning.line && a.code === warning.code)
    if (allow === undefined) problems.push(formatDiag(warning, file))
    else used.add(allow)
  }
  for (const a of allows) {
    if (used.has(a)) continue
    problems.push(`${file}:${a.line}: allows \`${a.code}\`, but no warning to allow`)
  }
  return problems
}

/** The leading `;` lines of `source`, without the `;`, as one line of text. */
const headerOf = (source: string) =>
  (/^(?:;.*\n)+/.exec(source)?.[0] ?? '').replace(/^;/gm, '').replace(/\s+/g, ' ')

/** The sentences in `text`: each ends in `.`, `!`, or `?` before a space or the end. */
const sentences = (text: string) => (text.match(/[.!?](?=\s|$)/g) ?? []).length

/** A bot file to check: its path, its text, and what `assemble` made of it. */
interface BotFile {
  file: string
  source: string
  assembled: Assembled
}

/** The rules of the house style (roster/README.md) that a test can check without a roster entry. */
const HOUSE_STYLE: Record<string, (bot: BotFile) => void> = {
  'assembles with zero errors': ({ file, assembled }) => {
    expect(assembled.diagnostics.map((d) => formatDiag(d, file))).toEqual([])
  },
  'has zero warnings that no allow comment allows': ({ file, source, assembled }) => {
    expect(lintProblems(file, source, assembled)).toEqual([])
  },
  [`is 1..${MAX_BOT_BYTES} bytes`]: ({ assembled }) => {
    expect(assembled.bytes.length).toBeGreaterThan(0)
    expect(assembled.bytes.length).toBeLessThanOrEqual(MAX_BOT_BYTES)
  },
  'is formatter-clean': ({ source }) => {
    expect(formatSource(source)).toBe(source)
  },
  'starts with a header comment of three or more sentences': ({ source }) => {
    expect(sentences(headerOf(source))).toBeGreaterThanOrEqual(3)
  },
}

describe('roster: entries', () => {
  it('exports the roster API by the package name', () => {
    expect(byName).toMatchObject({ loadRoster, ROSTER, ROSTER_FAMILIES, ROSTER_TIERS })
  })

  it('has unique kebab-case slugs and unique names', () => {
    for (const { slug } of ROSTER) expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    expect(new Set(ROSTER.map((e) => e.slug)).size).toBe(ROSTER.length)
    expect(new Set(ROSTER.map((e) => e.name)).size).toBe(ROSTER.length)
  })

  it('keeps a test bot in roster/test/ and every other bot in roster/', () => {
    for (const e of ROSTER) {
      const file = e.tier === 'test' ? `roster/test/${e.slug}.asm` : `roster/${e.slug}.asm`
      expect({ slug: e.slug, file: e.file, family: e.family === 'test' }).toEqual({
        slug: e.slug,
        file,
        family: e.tier === 'test',
      })
    }
  })

  it('gives each entry a known family and tier, an author, and a one-line blurb', () => {
    for (const e of ROSTER) {
      expect(ROSTER_FAMILIES).toContain(e.family)
      expect(ROSTER_TIERS).toContain(e.tier)
      expect(e.author.trim()).not.toBe('')
      expect(e.blurb).toMatch(/^\S[^\n]*$/)
    }
  })

  it('has an entry for every .asm file under roster/', () => {
    const files = readdirSync(ROSTER_DIR, { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.asm'))
      .map((f) => `roster/${f}`)
    expect(files.sort()).toEqual(ROSTER.map((e) => e.file).sort())
  })

  it('loads each bot from its file, once', () => {
    expect([...bots.keys()]).toEqual(ROSTER.map((e) => e.slug))
    for (const e of ROSTER) {
      expect(botOf(e.slug).source).toBe(readFileSync(join(PACKAGE, e.file), 'utf8'))
    }
    expect(loadRoster()).toBe(bots)
  })
})

describe('roster: bots', () => {
  for (const entry of ROSTER) {
    describe(entry.file, () => {
      const bot = { file: entry.file, ...botOf(entry.slug) }
      for (const [rule, check] of Object.entries(HOUSE_STYLE)) it(rule, () => check(bot))

      it('has the %name and %author of its entry', () => {
        const { name, author } = bot.assembled
        expect({ name, author }).toEqual({ name: entry.name, author: entry.author })
      })
    })
  }
})

describe('roster: lint allow comments', () => {
  /** The lint problems of a bot around `code`, which starts on line 3. */
  const problems = (code: string) => {
    const source = `%name "t"\n%strategy "s"\n${code}\n`
    return lintProblems('t.asm', source, assemble(source))
  }
  const hlt = (line: number) =>
    `t.asm:${line}:1: warning: \`hlt\` is the first instruction: the bot halts itself at once [hlt-in-code]`
  const FORM = 'an allow comment reads `; lint: allow <code>: <reason>`'

  it('allows a warning that a comment on its line names, with a reason', () => {
    expect(problems('hlt')).toEqual([hlt(3)])
    expect(problems('hlt ; lint: allow hlt-in-code: a test')).toEqual([])
    expect(problems('hlt ;lint:allow hlt-in-code:a test')).toEqual([])
  })

  it('does not allow a warning from another line or under another code', () => {
    expect(problems('; lint: allow hlt-in-code: above\nhlt')).toEqual([
      hlt(4),
      't.asm:3: allows `hlt-in-code`, but no warning to allow',
    ])
    expect(problems('hlt ; lint: allow unreachable: wrong code')).toEqual([
      hlt(3),
      't.asm:3: allows `unreachable`, but no warning to allow',
    ])
  })

  it('rejects an allow comment without a reason, or with an unknown code', () => {
    for (const comment of [
      '; lint: allow hlt-in-code',
      '; lint: allow hlt-in-code:   ',
      '; lint: hlt-in-code is fine here',
    ]) {
      expect(problems(`hlt ${comment}`)).toEqual([`t.asm:3:5: ${FORM}`, hlt(3)])
    }
    expect(problems('hlt ; lint: allow hlt-is-fine: why')).toEqual([
      't.asm:3:5: `hlt-is-fine` is not a diagnostic code',
      hlt(3),
    ])
  })

  it('rejects an allow comment that allows nothing', () => {
    expect(problems('jmp $ ; lint: allow hlt-in-code: stale')).toEqual([
      't.asm:3: allows `hlt-in-code`, but no warning to allow',
    ])
  })

  it('reads comments, not strings', () => {
    expect(problems('jmp $\nmsg: db "; lint: allow hlt-in-code: text"')).toEqual([])
  })
})

describe('roster: README', () => {
  const readme = readFileSync(join(ROSTER_DIR, 'README.md'), 'utf8')

  it('has a row for each family and each tier', () => {
    for (const name of [...ROSTER_FAMILIES, ...ROSTER_TIERS]) {
      expect(readme).toContain(`\n| \`${name}\` |`)
    }
  })

  describe('shows a bot in the house style', () => {
    const source = /^```nasm\n([\s\S]*?)^```$/m.exec(readme)?.[1] ?? ''
    const bot = { file: 'Sketch in README.md', source, assembled: assemble(source) }

    it('names it Sketch', () => {
      expect(bot.assembled.name).toBe('Sketch')
    })
    for (const [rule, check] of Object.entries(HOUSE_STYLE)) it(rule, () => check(bot))
  })
})
