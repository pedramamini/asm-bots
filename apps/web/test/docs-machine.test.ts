/**
 * The start page and the machine pages (EXEC 2.6 task 3) against the engine: each bot on them is
 * lint-clean, and each thing a page says a bot does (its bytes, its cycles, how it dies, what it
 * bombs, who wins at a seed) is run here. Edit a page's code or its prose, and this says whether
 * the two still agree.
 */
import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { type Assembled, assemble, lint } from '@asmbots/asm'
import { fighter } from '@asmbots/bots'
import {
  Battle,
  type Bot,
  DEATH_REASONS,
  type DeathReason,
  IP,
  type LoadedBot,
  pmarsPoints,
  SP,
  simulate,
} from '@asmbots/engine'
import { SHOT_PATH } from '../src/docs/blocks'
import { reasonText } from '../src/features/arena/battle/log'

const DOCS_DIR = new URL('../src/docs/', import.meta.url).pathname
const PUBLIC_DIR = new URL('../public', import.meta.url).pathname

const PAGES = [
  'start/index',
  'machine/memory',
  'machine/registers',
  'machine/processes',
  'machine/death',
  'machine/placement',
  'machine/scoring',
  'machine/position-independence',
  'machine/debugger',
]

const mdx = (page: string): string => readFileSync(`${DOCS_DIR}${page}.mdx`, 'utf8')

/** The page's fenced x16c blocks: each one's meta and source. */
function blocks(page: string): { meta: string; source: string }[] {
  return [...mdx(page).matchAll(/^```asm ?([^\n]*)\n([\s\S]*?)^```$/gm)].map((m) => ({
    meta: m[1] as string,
    source: m[2] as string,
  }))
}

/** The whole bot named `name` on `page`. */
function bot(page: string, name: string): string {
  const found = blocks(page).find((b) => new RegExp(`%name\\s+"${name}"`).test(b.source))
  if (found === undefined) throw new Error(`no bot "${name}" on ${page}`)
  return found.source
}

function build(source: string): Assembled {
  const assembled = assemble(source)
  expect(assembled.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  return assembled
}

const load = (source: string): LoadedBot => {
  const assembled = build(source)
  return { name: assembled.name, bytes: assembled.bytes }
}

/** `source` with `from` swapped for `to`, which must be there. */
function edit(source: string, from: string, to: string): string {
  expect(source).toContain(from)
  return source.replace(from, to)
}

/** The bot's front process: its ip and sp, as offsets from its base. */
function front(b: Bot): { ip: number; sp: number } {
  const row = b.queue.rows[b.queue.front()] as Float64Array | Uint16Array | number[]
  return {
    ip: ((row[IP] as number) - b.base) & 0xffff,
    sp: ((row[SP] as number) - b.base) & 0xffff,
  }
}

/** Whether the core still holds the bot's image at its base. */
function intact(battle: Battle, index: number, bytes: Uint8Array): boolean {
  const { base } = battle.bots[index] as Bot
  return bytes.every((byte, at) => battle.core.bytes[(base + at) & 0xffff] === byte)
}

const IMP = bot('start/index', 'Imp')

describe('the bots on the pages', () => {
  it('assemble lint-clean, but for a missing %strategy and the hlt that dies-hlt is for', () => {
    for (const page of PAGES) {
      for (const { meta, source } of blocks(page)) {
        if (meta.includes('fragment')) continue
        const assembled = build(source)
        const codes = lint(source, assembled)
          .map((d) => d.code)
          .filter((code) => code !== 'no-strategy')
        expect({ page, name: assembled.name, codes }).toEqual({
          page,
          name: assembled.name,
          codes: assembled.name === 'dies-hlt' ? ['hlt-in-code'] : [],
        })
      }
    }
  })

  it('each <Shot> has its file in public/docs-shots', () => {
    for (const page of PAGES) {
      for (const [, src] of mdx(page).matchAll(/<Shot src="([^"]+)"/g)) {
        expect({ src, there: existsSync(`${PUBLIC_DIR}${SHOT_PATH}${src}.webp`) }).toEqual({
          src,
          there: true,
        })
      }
    }
  })
})

describe('start here: the imp', () => {
  it('assembles to the bytes of the line-by-line table', () => {
    const rows = [...mdx('start/index').matchAll(/^\| `([^`]+)` \| `([0-9A-F ]+)` \|/gm)]
    expect(rows).toHaveLength(7)
    const squash = (text: string) => text.replace(/;.*/, '').replace(/\s+/g, ' ').trim()
    const listing = build(IMP).listing
    for (const [, line, bytes] of rows) {
      const found = listing.find((l) => squash(l.source) === line)
      expect({ line, bytes: found?.bytesHex }).toEqual({ line, bytes })
    }
  })

  it('runs 5 setup instructions, then moves one byte a cycle', () => {
    const assembled = build(IMP)
    expect(assembled.symbols.get('imp')).toBe(13)
    const battle = new Battle([load(IMP)], { seed: 7 })
    const imp = battle.bots[0] as Bot
    battle.run(1)
    expect(front(imp).sp).toBe(0xfffe) // the call pushed at base - 2
    battle.run(4)
    expect(front(imp).ip).toBe(13)
    battle.run(100)
    expect(front(imp).ip).toBe(113)
  })

  it('with imp+4, dies with dat on its 8th instruction, at cycle 7', () => {
    const r = simulate([load(edit(IMP, '[bx+imp+2]', '[bx+imp+4]'))], { seed: 7 })
    expect(r.bots[0]).toMatchObject({ alive: false, deathReason: 'dat', deathCycle: 7 })
  })

  it('placed first vs the dwarf, seeds 1..20: 1 win, 10 ties, 9 losses', () => {
    const tally = { win: 0, tie: 0, loss: 0 }
    for (let seed = 1; seed <= 20; seed++) {
      const [imp, dwarf] = simulate([load(IMP), fighter('dwarf')], { seed }).bots
      if (imp?.alive && dwarf?.alive) tally.tie++
      else if (imp?.alive) tally.win++
      else tally.loss++
    }
    expect(tally).toEqual({ win: 1, tie: 10, loss: 9 })
  })
})

describe('memory', () => {
  const RING = bot('machine/memory', 'Ring walker')

  it('names the bytes of a bomb', () => {
    expect(build('%name "b"\nmov word [di], 0\nstosw').listing.map((l) => l.bytesHex)).toEqual([
      '',
      'C7 05 00 00',
      'AB',
    ])
  })

  it('bombs one lap of the ring, never itself, the last bomb 128 bytes before end', () => {
    const assembled = build(RING)
    const end = assembled.symbols.get('end') as number
    expect(end).toBeLessThan(128)
    const battle = new Battle([load(RING)], { seed: 3 })
    const result = battle.run()
    expect(result?.bots[0]).toMatchObject({ alive: true, cycles: 100_000 })
    expect(intact(battle, 0, assembled.bytes)).toBe(true)
    const { base, tag } = battle.bots[0] as Bot
    expect(battle.core.owner[(base + end - 128) & 0xffff]).toBe(tag)
    expect(battle.core.owner[(base + end - 64) & 0xffff]).toBe(0)
  })

  it('at stride 2, the lap comes home and the bot dies before it ends', () => {
    const stride2 = edit(
      edit(RING, 'add     di, 64', 'add     di, 2'),
      'mov     cx, 0x10000 / 64 - 1',
      'mov     cx, 0x10000 / 2 - 1',
    )
    const r = simulate([load(stride2)], { seed: 3 })
    expect(r.bots[0]?.alive).toBe(false)
    expect(r.bots[0]?.deathCycle).toBeLessThan(5 + 3 * 32767)
  })
})

describe('registers: Backstep', () => {
  const BACKSTEP = bot('machine/registers', 'Backstep')

  it('fills 32,512 words down, one a cycle, ending 512 bytes above the base', () => {
    const assembled = build(BACKSTEP)
    const rep = assembled.listing.find((l) => l.source.includes('rep'))?.address as number
    const battle = new Battle([load(BACKSTEP)], { seed: 5 })
    const b = battle.bots[0] as Bot
    battle.run(7 + 32512 - 1)
    expect(front(b).ip).toBe(rep)
    battle.run(1)
    expect(front(b).ip).toBe(rep + 2)
    expect(battle.core.owner[(b.base + 512) & 0xffff]).toBe(b.tag)
    expect(battle.core.owner[(b.base + 510) & 0xffff]).toBe(0)
    expect(intact(battle, 0, assembled.bytes)).toBe(true)
  })

  it('without std, the tenth zero word lands on rep stosw and it dies with dat', () => {
    const r = simulate([load(edit(BACKSTEP, '        std', '        nop'))], { seed: 5 })
    // The call's push, then 10 words of the fill.
    expect(r.bots[0]).toMatchObject({ alive: false, deathReason: 'dat', writes: 11 })
  })
})

describe('processes: Spinners', () => {
  const SPINNERS = bot('machine/processes', 'Spinners')

  it('holds 4 processes six cycles in, on 4 addresses', () => {
    const battle = new Battle([load(SPINNERS)], { seed: 2 })
    const b = battle.bots[0] as Bot
    battle.run(5)
    expect(b.queue.size).toBe(3)
    battle.run(1)
    expect(b.queue.size).toBe(4)
    const ips = new Set<number>()
    for (let k = 0; k < 4; k++) {
      ips.add(front(b).ip)
      battle.run(1)
    }
    expect(ips.size).toBe(4)
  })

  it('with spl $ + 2 three times, holds 8 processes, all on d', () => {
    const chain = SPINNERS.replace(
      /^start:.*\n.*\n.*\n/m,
      'start:  spl $ + 2\n spl $ + 2\n spl $ + 2\n',
    )
    const assembled = build(chain)
    const d = assembled.symbols.get('d')
    const battle = new Battle([load(chain)], { seed: 2 })
    const b = battle.bots[0] as Bot
    battle.run(40)
    expect(b.queue.size).toBe(8)
    for (let k = 0; k < 8; k++) {
      expect(front(b).ip).toBe(d as number)
      battle.run(1)
    }
  })
})

describe('death', () => {
  it('each dies-<reason> bot dies alone, of that reason', () => {
    const named = blocks('machine/death')
      .map(({ source }) => [/%name "dies-(\w+)"/.exec(source)?.[1], source] as const)
      .filter((pair): pair is readonly [string, string] => pair[0] !== undefined)
    expect(named.map(([reason]) => reason)).toEqual(['dat', 'undefined', 'hlt', 'int3', 'div'])
    for (const [reason, source] of named) {
      expect({ reason, bot: simulate([load(source)], { seed: 1 }).bots[0] }).toMatchObject({
        reason,
        bot: { alive: false, deathReason: reason },
      })
    }
  })

  it("names each reason as the arena's log does", () => {
    const rows = [...mdx('machine/death').matchAll(/^\| `(\w+)` \| ([a-z0-9 ]+) \|/gm)]
    expect(rows.map((r) => r[1]).sort()).toEqual([...DEATH_REASONS].sort())
    for (const [, reason, says] of rows) {
      expect({ reason, says }).toEqual({ reason, says: reasonText(reason as DeathReason) })
    }
  })

  it('kills on the idiv the page names', () => {
    const r = simulate([load('%name "x"\nmov ax, -32768\nmov bl, -128\nidiv bl')], { seed: 1 })
    expect(r.bots[0]).toMatchObject({ alive: false, deathReason: 'div' })
  })
})

describe('placement', () => {
  it('seed 1: the imp outlives the dwarf; seed 20: the dwarf wins before cycle 6,500', () => {
    const imp = load(bot('machine/placement', 'Imp'))
    expect(blocks('machine/placement')[0]?.meta).toBe('run="vs=dwarf seed=1"')
    const one = simulate([imp, fighter('dwarf')], { seed: 1 })
    expect(one.bots.map((b) => b.alive)).toEqual([true, false])
    const twenty = simulate([imp, fighter('dwarf')], { seed: 20 })
    expect(twenty.bots.map((b) => b.alive)).toEqual([false, true])
    expect(twenty.bots[0]?.deathCycle).toBeLessThan(6500)
  })
})

describe('scoring', () => {
  it("the page's table is pMARS points", () => {
    const rows = [...mdx('machine/scoring').matchAll(/^\| (\d+) \|((?: [\d ]*\|)+)$/gm)]
    expect(rows.map((r) => r[1])).toEqual(['2', '3', '4', '8'])
    const columns = [1, 2, 3, 4, 8]
    for (const [, n, cells] of rows) {
      const shown = (cells as string)
        .split('|')
        .slice(0, -1)
        .map((c) => c.trim())
      const want = columns.map((s) => (s <= Number(n) ? String(pmarsPoints(Number(n), s)) : ''))
      expect({ n, shown }).toEqual({ n, shown: want })
    }
  })
})

describe('position independence', () => {
  const CARRIER = bot('machine/position-independence', 'Carrier')

  it('names the bytes the page gives', () => {
    expect(build('%name "x"\n jmp next\nnext: loop next').listing.map((l) => l.bytesHex)).toEqual([
      '',
      'EB 00',
      'E2 FE',
    ])
    const idiom = build('%name "x"\nstart: call .here\n.here: pop bx\n sub bx, .here')
    expect(idiom.bytes).toHaveLength(7)
    const carrier = build(CARRIER)
    expect(carrier.symbols.get('bomb')).toBe(24)
    const mov = (source: string) => source.split('\n').find((l) => l.includes('mov     ax'))
    expect(carrier.listing.find((l) => l.source === mov(CARRIER))?.bytesHex).toBe('8B 47 18')
    const absolute = edit(CARRIER, '[bx+bomb]', '[bomb]')
    expect(build(absolute).listing.find((l) => l.source === mov(absolute))?.bytesHex).toBe(
      'A1 18 00',
    )
  })

  it('warns on [bomb] with the words the page quotes', () => {
    const absolute = edit(CARRIER, '[bx+bomb]', '[bomb]')
    const warning = lint(absolute, build(absolute)).find((d) => d.code === 'absolute-address')
    expect(mdx('machine/position-independence')).toContain(`"${warning?.message}."`)
    expect(warning?.fix).toContain('`[bx+bomb]`')
  })

  it('drops its own 0xCCCC for a lap, never on itself', () => {
    const assembled = build(CARRIER)
    const end = assembled.symbols.get('end') as number
    const battle = new Battle([load(CARRIER)], { seed: 9 })
    expect(battle.run()?.bots[0]?.alive).toBe(true)
    expect(intact(battle, 0, assembled.bytes)).toBe(true)
    const { base } = battle.bots[0] as Bot
    expect(battle.core.read16((base + end) & 0xffff)).toBe(0xcccc)
    expect(battle.core.read16((base + end + 16) & 0xffff)).toBe(0xcccc)
  })
})
