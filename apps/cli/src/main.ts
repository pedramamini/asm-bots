#!/usr/bin/env bun

import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import { assemble, disassemble, type AssembleOptions, type DisassembleOptions, formatDiag } from '@asmbots/asm'
import { Battle, type LoadedBot, type BattleConfigInput, type Result, DEFAULT_CONFIG } from '@asmbots/engine'
import { fighter } from '@asmbots/bots'
import type { EventSink } from '@asmbots/engine'
import { NullSink } from '@asmbots/engine'
import {
  bracketSvg,
  iterateRoundRobin,
  createBracket,
  iterateBracket,
  iterateMelee,
  submitToHill,
  runMatch,
  type HillMatchRunner,
} from '@asmbots/tourney'

declare const process: { env: Record<string, string | undefined>; argv: string[]; cwd(): string; stdout: { isTTY: boolean }; exit(code: number): never }

interface ParsedArgs {
  command: string
  args: string[]
  flags: Record<string, string | boolean>
}

function parseArgs(argv: string[]): ParsedArgs {
  const command = argv[0] ?? 'help'
  const rest = argv.slice(1)
  const flags: Record<string, string | boolean> = {}
  const args: string[] = []

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!
    if (arg.startsWith('--')) {
      const parts = arg.slice(2).split('=')
      const flag = parts[0]!
      const value = parts.slice(1).join('=')
      if (value.length > 0) {
        flags[flag] = value
      } else if (i + 1 < rest.length && !(rest[i + 1]?.startsWith('--'))) {
        flags[flag] = rest[++i]!
      } else {
        flags[flag] = true
      }
    } else if (arg.startsWith('-') && arg !== '-') {
      const flag = arg.slice(1)
      if (i + 1 < rest.length && !(rest[i + 1]?.startsWith('-'))) {
        flags[flag] = rest[++i]!
      } else {
        flags[flag] = true
      }
    } else {
      args.push(arg)
    }
  }

  return { command, args, flags }
}

function useColor(): boolean {
  return process.stdout.isTTY && !process.env.NO_COLOR && !(process.argv.includes('--no-color') || process.argv.includes('--json'))
}

function colorize(text: string, color: 'red' | 'yellow' | 'green' | 'cyan'): string {
  if (!useColor()) return text
  const colors = {
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    green: '\x1b[32m',
    cyan: '\x1b[36m',
  }
  return `${colors[color]}${text}\x1b[0m`
}

interface TableRow {
  [key: string]: string | number | boolean
}

interface TableColumn {
  key: string
  header: string
  align?: 'left' | 'right'
  width?: number
}

function formatTable(rows: TableRow[], columns: TableColumn[]): string[] {
  if (rows.length === 0) return []

  // Calculate column widths
  const widths: Record<string, number> = {}
  for (const col of columns) {
    let maxWidth = col.header.length
    for (const row of rows) {
      const val = String(row[col.key] ?? '')
      maxWidth = Math.max(maxWidth, val.length)
    }
    widths[col.key] = col.width ?? maxWidth
  }

  // Header row
  const headerCells = columns.map((col) => col.header.padEnd(widths[col.key]))
  const result = [headerCells.join('  ')]

  // Separator
  const separators = columns.map((col) => '-'.repeat(widths[col.key]))
  result.push(separators.join('  '))

  // Data rows
  for (const row of rows) {
    const cells = columns.map((col) => {
      const val = String(row[col.key] ?? '')
      const align = col.align ?? 'left'
      if (align === 'right') {
        return val.padStart(widths[col.key])
      }
      return val.padEnd(widths[col.key])
    })
    result.push(cells.join('  '))
  }

  return result
}

async function loadBot(fileOrSlug: string): Promise<LoadedBot> {
  if (fileOrSlug.startsWith('roster:')) {
    const slug = fileOrSlug.slice(7)
    try {
      return fighter(slug)
    } catch (err) {
      throw new Error(`unknown roster bot: ${slug}`)
    }
  }

  const path = resolve(fileOrSlug)
  if (path.endsWith('.asm')) {
    const source = readFileSync(path, 'utf8')
    const result = assemble(source)
    if (result.diagnostics.length > 0 && result.diagnostics.some((d: any) => d.severity === 'error')) {
      throw new Error(`assembly error in ${fileOrSlug}`)
    }
    return {
      name: result.name || path,
      bytes: result.bytes,
      meta: { author: result.author, strategy: result.strategy, version: result.version },
    }
  } else if (path.endsWith('.bin')) {
    const bytes = readFileSync(path)
    return { name: path, bytes: new Uint8Array(bytes) }
  }

  throw new Error(`unsupported file type: ${fileOrSlug} (use .asm or .bin)`)
}

class TraceEventSink implements EventSink {
  readonly traces: string[] = []

  private execs: Map<number, { bot: number; proc: number; addr: number; len: number; cycle: number }> = new Map()

  constructor(private battle: Battle, private botFilter?: number) {}

  exec(cycle: number, bot: number, proc: number, addr: number, len: number): void {
    this.execs.set(bot, { bot, proc, addr, len, cycle })
  }

  write(): void {}

  spawn(): void {}

  death(): void {}

  botDead(): void {}

  cycleEnd(cycle: number): void {
    const bots = this.battle.bots
    const core = this.battle.core
    for (const bot of bots) {
      if (this.botFilter !== undefined && bot.index !== this.botFilter) continue
      if (bot.queue.size === 0) continue
      const info = this.execs.get(bot.index)
      if (!info) continue

      const row = bot.queue.rows[bot.queue.front()]!
      const ax = row[0]
      const cx = row[1]
      const dx = row[2]
      const bx = row[3]
      const si = row[6]
      const di = row[7]
      const bp = row[5]
      const sp = row[4]
      const flags = row[9]

      // Read the instruction bytes
      const bytes: number[] = []
      for (let i = 0; i < Math.min(info.len, 6); i++) {
        bytes.push(core.bytes[(info.addr + i) & 0xffff] as number)
      }
      const bytesHex = bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ')

      const flagStr = this.formatFlags(flags)
      const addr = `0x${info.addr.toString(16).padStart(4, '0')}`
      const trace = `${cycle.toString().padStart(6, ' ')} ${bot.index} ${bot.queue.front()} ${addr} ${bytesHex.padEnd(17)} ??? | ` +
        `${ax.toString(16).padStart(4, '0')} ${cx.toString(16).padStart(4, '0')} ${dx.toString(16).padStart(4, '0')} ` +
        `${bx.toString(16).padStart(4, '0')} ${si.toString(16).padStart(4, '0')} ${di.toString(16).padStart(4, '0')} ` +
        `${bp.toString(16).padStart(4, '0')} ${sp.toString(16).padStart(4, '0')} | ${flagStr}`

      this.traces.push(trace)
    }
    this.execs.clear()
  }

  private formatFlags(flags: number): string {
    const flags_status = [
      flags & 0x0001 ? 'C' : 'c',
      flags & 0x0004 ? 'P' : 'p',
      flags & 0x0010 ? 'A' : 'a',
      flags & 0x0040 ? 'Z' : 'z',
      flags & 0x0080 ? 'S' : 's',
      flags & 0x0100 ? 'T' : 't',
      flags & 0x0200 ? 'I' : 'i',
      flags & 0x0400 ? 'D' : 'd',
      flags & 0x0800 ? 'O' : 'o',
    ]
    return flags_status.join('')
  }
}

async function cmdFight(inputs: string[], flags: Record<string, string | boolean>): Promise<number> {
  try {
    if (inputs.length < 2) {
      console.error(colorize('error: fight requires at least 2 bot files or roster slugs', 'red'))
      printHelp('fight')
      return 1
    }

    let seed = flags.seed ? parseInt(String(flags.seed), 10) : Math.floor(Math.random() * 0xffffffff)
    const rounds = flags.rounds ? parseInt(String(flags.rounds), 10) : 1
    const cycles = flags.cycles ? parseInt(String(flags.cycles), 10) : 100000
    const procs = flags.procs ? parseInt(String(flags.procs), 10) : 64
    const spacing = flags.spacing ? parseInt(String(flags.spacing), 10) : 1024
    const hasTrace = !!flags.trace
    const traceBotName = flags['trace-bot'] ? String(flags['trace-bot']) : undefined
    const json = !!flags.json

    const bots: LoadedBot[] = []
    for (const input of inputs) {
      bots.push(await loadBot(input))
    }

    // Find the bot index for trace filtering
    let traceBotIndex: number | undefined
    if (traceBotName) {
      const idx = bots.findIndex((b) => b.name === traceBotName)
      if (idx === -1) {
        console.error(colorize(`error: no bot named '${traceBotName}'`, 'red'))
        return 1
      }
      traceBotIndex = idx
    }

    let totalResult: Result | null = null
    let lastBattle: Battle | null = null
    const allTraces: string[] = []

    for (let round = 0; round < rounds; round++) {
      const roundSeed = (seed + round) >>> 0
      const config: BattleConfigInput = {
        seed: roundSeed,
        maxCycles: cycles,
        maxProcesses: procs,
        minSpacing: spacing,
      }

      const eventSink = hasTrace ? new TraceEventSink(null as any, traceBotIndex) : new NullSink()
      const battle = new Battle(bots, config, eventSink)
      if (hasTrace && eventSink instanceof TraceEventSink) {
        ;(eventSink as any).battle = battle
      }

      battle.run()
      totalResult = battle.result()
      lastBattle = battle

      if (hasTrace && eventSink instanceof TraceEventSink) {
        allTraces.push(...eventSink.traces)
      }
    }

    if (!totalResult) {
      console.error(colorize('error: battle did not complete', 'red'))
      return 3
    }

    if (json) {
      console.log(JSON.stringify({ result: totalResult, traces: allTraces }, null, 2))
    } else {
      console.log(`Placement:`)
      for (let i = 0; i < totalResult.bots.length; i++) {
        const bot = totalResult.bots[i]!
        const status = bot.alive ? colorize('ALIVE', 'green') : colorize('DEAD', 'red')
        const base = lastBattle ? lastBattle.bots[i]!.base : 0
        const size = lastBattle ? lastBattle.bots[i]!.size : 0
        const baseHex = `0x${base.toString(16).padStart(4, '0')}`
        console.log(`  ${bot.name.padEnd(20)} base=${baseHex}  size=${size.toString().padStart(4)}  ${status}`)
      }

      console.log(`\nRound results:`)
      console.log(`  Cycles: ${totalResult.cycles}`)
      console.log(`  Survivors: ${totalResult.survivors.map((i) => totalResult!.bots[i]!.name).join(', ')}`)
      console.log(`\nBot statistics:`)
      for (const bot of totalResult.bots) {
        console.log(`  ${bot.name}:`)
        console.log(`    Instructions: ${bot.cycles}`)
        console.log(`    Memory writes: ${bot.writes}`)
        console.log(`    Peak processes: ${bot.peakProcs}`)
        console.log(`    Points: ${bot.points}`)
        if (bot.deathCycle !== null) {
          console.log(`    Died at cycle ${bot.deathCycle}: ${bot.deathReason}`)
        }
      }

      if (hasTrace && allTraces.length > 0) {
        console.log(`\nTrace (${allTraces.length} instructions):`)
        for (const trace of allTraces.slice(0, 100)) {
          console.log(trace)
        }
        if (allTraces.length > 100) {
          console.log(`... (${allTraces.length - 100} more instructions)`)
        }
      }
    }

    return 0
  } catch (err) {
    console.error(colorize(`error: ${err instanceof Error ? err.message : String(err)}`, 'red'))
    return 3
  }
}

async function cmdAsm(inputPath: string, flags: Record<string, string | boolean>): Promise<number> {
  try {
    const path = resolve(inputPath)
    const source = readFileSync(path, 'utf8')

    const opts: AssembleOptions = {
      maxBytes: flags['max-bytes'] ? parseInt(String(flags['max-bytes']), 10) : undefined,
    }

    const result = assemble(source, opts)

    if (result.diagnostics.length > 0) {
      for (const diag of result.diagnostics) {
        const formatted = formatDiag(diag, path)
        console.log(formatted)
      }
    }

    if (result.bytes.length > 0) {
      const size = result.bytes.length
      console.log(`${colorize(path, 'cyan')}: ${size} bytes`)

      if (flags.listing && result.listing) {
        console.log('')
        console.log('Address  Bytes                              Source')
        console.log('--------  -------                           ------')
        for (const line of result.listing) {
          const addr = `0x${line.address.toString(16).padStart(4, '0')}`
          const bytesStr = line.bytesHex.padEnd(36)
          console.log(`${addr}     ${bytesStr}  ${line.source}`)
        }
      }

      if (flags['bin']) {
        const outPath = resolve(String(flags['bin']))
        writeFileSync(outPath, result.bytes)
        console.log(`Binary written to ${colorize(outPath, 'green')}`)
      }

      return 0
    } else if (result.diagnostics.some((d: any) => d.severity === 'error')) {
      return 2
    }

    return 0
  } catch (err) {
    console.error(colorize(`error: ${err instanceof Error ? err.message : String(err)}`, 'red'))
    return 3
  }
}

async function cmdDis(inputPath: string, flags: Record<string, string | boolean>): Promise<number> {
  try {
    const path = resolve(inputPath)
    const bytes = readFileSync(path)

    const base = flags.base ? parseInt(String(flags.base), 16) : 0

    const opts: DisassembleOptions = {}

    const lines = disassemble(bytes, base, opts)

    console.log('Address  Bytes                              Text')
    console.log('--------  -------                           ----')

    for (const line of lines) {
      const addr = `0x${line.address.toString(16).padStart(4, '0')}`
      const bytesStr = line.bytesHex.padEnd(36)
      console.log(`${addr}     ${bytesStr}  ${line.text}`)
    }

    return 0
  } catch (err) {
    console.error(colorize(`error: ${err instanceof Error ? err.message : String(err)}`, 'red'))
    return 3
  }
}

async function cmdTourney(inputs: string[], flags: Record<string, string | boolean>): Promise<number> {
  try {
    if (inputs.length < 2) {
      console.error(colorize('error: tourney requires a format (roundrobin/bracket/melee) and at least 2 bots', 'red'))
      printHelp('tourney')
      return 1
    }

    const format = inputs[0]!.toLowerCase()
    const botInputs = inputs.slice(1)

    if (!['roundrobin', 'bracket', 'melee'].includes(format)) {
      console.error(colorize(`error: unknown tournament format '${format}', must be roundrobin, bracket, or melee`, 'red'))
      return 1
    }

    const rounds = flags.rounds ? parseInt(String(flags.rounds), 10) : 1
    const json = !!flags.json

    const bots: LoadedBot[] = []
    for (const input of botInputs) {
      bots.push(await loadBot(input))
    }

    const config: BattleConfigInput = {
      seed: Math.floor(Math.random() * 0xffffffff),
      maxCycles: DEFAULT_CONFIG.maxCycles,
      maxProcesses: DEFAULT_CONFIG.maxProcesses,
      minSpacing: DEFAULT_CONFIG.minSpacing,
    }

    let results: any = null

    if (format === 'roundrobin') {
      results = await runTourneyRoundRobin(bots, config, rounds, !json)
      if (json) {
        console.log(JSON.stringify({ results }, null, 2))
      } else {
        printStandings(results.standings)
      }
    } else if (format === 'bracket') {
      results = await runTourneyBracket(bots, config, rounds, !json)
      if (json) {
        console.log(JSON.stringify({ results }, null, 2))
      } else {
        const finalMatch = results.bracket.matches[results.bracket.final]
        if (finalMatch?.winner !== null) {
          const winner = results.bracket.names[finalMatch.winner]
          console.log(`Champion: ${colorize(winner, 'green')}`)
        }
      }
    } else if (format === 'melee') {
      results = await runTourneyMelee(bots, config, rounds, !json)
      if (json) {
        console.log(JSON.stringify({ results }, null, 2))
      } else {
        printMeleeStandings(results.standings)
      }
    }

    if (flags.svg && format === 'bracket') {
      const svgPath = resolve(String(flags.svg))
      writeFileSync(svgPath, bracketSvg(results.bracket, { title: 'asm bots bracket' }))
      console.log(`Bracket written to ${colorize(svgPath, 'green')}`)
    }

    if (flags.out) {
      const outPath = resolve(String(flags.out))
      writeFileSync(outPath, JSON.stringify(results, null, 2))
      console.log(`Results written to ${colorize(outPath, 'green')}`)
    }

    return 0
  } catch (err) {
    console.error(colorize(`error: ${err instanceof Error ? err.message : String(err)}`, 'red'))
    return 3
  }
}

async function runTourneyRoundRobin(
  bots: LoadedBot[],
  config: BattleConfigInput,
  rounds: number,
  verbose: boolean,
): Promise<any> {
  let standings: any[] = []
  let matchCount = 0
  let totalMatches = 0

  for await (const progress of iterateRoundRobin(bots, config, { rounds })) {
    matchCount = progress.match
    totalMatches = progress.of
    standings = progress.standings as any[]
    if (verbose) {
      console.log(`  ${colorize(`Match ${matchCount}/${totalMatches}`, 'cyan')}`)
    }
  }

  return { matches: matchCount, total: totalMatches, standings }
}

async function runTourneyBracket(
  bots: LoadedBot[],
  config: BattleConfigInput,
  rounds: number,
  verbose: boolean,
): Promise<any> {
  const entrants = bots.map((b) => ({ ...b, name: b.name }))
  let br = createBracket(entrants, { seeding: 'given' })
  let matchCount = 0

  for await (const progress of iterateBracket(br, async (indices) => {
    const [aIdx, bIdx] = indices
    const bots_ = [bots[aIdx]!, bots[bIdx]!]
    matchCount++
    if (verbose) {
      console.log(`  ${colorize(`Match ${matchCount}`, 'cyan')}`)
    }
    return runMatch(bots_, config, rounds)
  })) {
    br = progress.bracket
  }

  return { bracket: br, matchCount }
}

async function runTourneyMelee(
  bots: LoadedBot[],
  config: BattleConfigInput,
  rounds: number,
  verbose: boolean,
): Promise<any> {
  let standings: any[] = []
  let roundCount = 0

  for await (const progress of iterateMelee(bots, config, rounds)) {
    roundCount = progress.round
    standings = progress.partial.standings as any[]
    if (verbose) {
      console.log(`  ${colorize(`Round ${progress.round}/${progress.of}`, 'cyan')}`)
    }
  }

  return { standings, rounds: roundCount }
}

async function cmdHill(inputs: string[], flags: Record<string, string | boolean>): Promise<number> {
  try {
    if (inputs.length < 2 || inputs[0] !== 'submit') {
      console.error(colorize('error: hill requires "submit <hill.json> <bot.asm>"', 'red'))
      printHelp('hill')
      return 1
    }

    const hillPath = resolve(inputs[1]!)
    const botPath = resolve(inputs[2]!)

    let hillState: any = { entries: [], matches: [], config: { size: 10, rounds: 1, battle: DEFAULT_CONFIG } }
    try {
      const hillText = readFileSync(hillPath, 'utf8')
      hillState = JSON.parse(hillText)
    } catch {
      // New hill
    }

    const bot = await loadBot(botPath)
    const challenger = { id: `bot-${Date.now()}`, bot, rating: undefined }

    const hillMatchRunner: HillMatchRunner = (challenger, defender, config) => {
      return runMatch([challenger.bot, { name: defender.name, bytes: new Uint8Array(8192), meta: {} }], config.battle, config.rounds)
    }

    let finalResult: any = null
    for await (const progress of submitToHill(hillState, challenger, hillMatchRunner)) {
      if (progress.final) {
        finalResult = progress.final
      }
    }

    if (!finalResult) {
      console.error(colorize('error: hill submission failed', 'red'))
      return 3
    }

    const outPath = flags.out ? resolve(String(flags.out)) : hillPath
    writeFileSync(outPath, JSON.stringify(finalResult.state, null, 2))

    if (!!flags.json) {
      console.log(JSON.stringify(finalResult, null, 2))
    } else {
      console.log(`Hill updated: ${finalResult.board.length} entries`)
      if (finalResult.rank !== null) {
        console.log(colorize(`Challenger accepted at rank ${finalResult.rank}`, 'green'))
      } else {
        console.log(colorize('Challenger rejected', 'red'))
      }
    }

    return 0
  } catch (err) {
    console.error(colorize(`error: ${err instanceof Error ? err.message : String(err)}`, 'red'))
    return 3
  }
}

async function cmdBench(flags: Record<string, string | boolean>): Promise<number> {
  try {
    const seconds = flags.seconds ? parseInt(String(flags.seconds), 10) : 5

    const bot = fighter('dwarf')
    const config: BattleConfigInput = DEFAULT_CONFIG
    const bots = [bot, bot]

    const startTime = performance.now()
    let cycles = 0
    let battleCount = 0

    while (performance.now() - startTime < seconds * 1000) {
      const battle = new Battle(bots, { ...config, seed: Math.floor(Math.random() * 0xffffffff) }, new NullSink())
      battle.run()
      const result = battle.result()
      cycles += result.cycles
      battleCount++
    }

    const elapsed = (performance.now() - startTime) / 1000
    const ips = Math.round(cycles / elapsed)

    console.log(`Ran ${battleCount} battles in ${elapsed.toFixed(2)}s`)
    console.log(`${colorize(ips.toLocaleString(), 'green')} instructions/sec`)

    return 0
  } catch (err) {
    console.error(colorize(`error: ${err instanceof Error ? err.message : String(err)}`, 'red'))
    return 3
  }
}

async function cmdGolden(inputs: string[], flags: Record<string, string | boolean>): Promise<number> {
  try {
    // Import the golden function from the scripts package
    // Since it's not easily importable from outside, we use bun.run
    const result = await Bun.run({
      cmd: ['bun', 'run', 'scripts/golden.ts', flags.update ? '--update' : ''],
      stdout: 'inherit',
      stderr: 'inherit',
    })
    return result.exitCode
  } catch (err) {
    console.error(colorize(`error: ${err instanceof Error ? err.message : String(err)}`, 'red'))
    return 3
  }
}

function printStandings(standings: any[]): void {
  if (standings.length === 0) {
    console.log('No standings')
    return
  }

  console.log('Standings:')
  const sorted = [...standings].sort((a, b) => (b.points ?? 0) - (a.points ?? 0))
  const rows = sorted.map((s, i) => ({
    rank: i + 1,
    name: s.name || `Bot ${s.entrant}`,
    points: s.points ?? 0,
  }))

  const columns: TableColumn[] = [
    { key: 'rank', header: 'Rank', align: 'right', width: 4 },
    { key: 'name', header: 'Name', align: 'left' },
    { key: 'points', header: 'Points', align: 'right' },
  ]

  const lines = formatTable(rows, columns)
  for (const line of lines) {
    console.log(`  ${line}`)
  }
}

function printMeleeStandings(standings: any[]): void {
  if (standings.length === 0) {
    console.log('No standings')
    return
  }

  console.log('Melee Standings:')
  const sorted = [...standings].sort((a, b) => (b.points ?? 0) - (a.points ?? 0))
  const rows = sorted.map((s, i) => ({
    rank: i + 1,
    name: s.name || `Bot ${s.entrant}`,
    points: s.points ?? 0,
    wins: s.wins ?? 0,
    ties: s.ties ?? 0,
    losses: s.losses ?? 0,
  }))

  const columns: TableColumn[] = [
    { key: 'rank', header: 'Rank', align: 'right', width: 4 },
    { key: 'name', header: 'Name', align: 'left' },
    { key: 'points', header: 'Points', align: 'right' },
    { key: 'wins', header: 'W', align: 'right' },
    { key: 'ties', header: 'T', align: 'right' },
    { key: 'losses', header: 'L', align: 'right' },
  ]

  const lines = formatTable(rows, columns)
  for (const line of lines) {
    console.log(`  ${line}`)
  }
}

function printHelp(command?: string): void {
  if (!command || command === 'asm') {
    console.log(`asm <file.asm> [--listing] [--bin out.bin] [--max-bytes N]
  Assemble x16c source into a binary. Diagnostics use editor-clickable format.

  Options:
    --listing       Print instruction listing table
    --bin <file>    Write binary output (default: stdout)
    --max-bytes <N> Fail if binary exceeds N bytes
    --help          Show this help
    --json          Output JSON (not yet implemented)

  Exit codes:
    0  Success
    1  Usage error
    2  Assembly error
    3  Runtime error`)
  }

  if (!command || command === 'dis') {
    console.log(`dis <file.bin> [--base 0x0000]
  Disassemble a binary file.

  Options:
    --base <addr>   Base address for display (hex, default: 0x0000)
    --help          Show this help
    --json          Output JSON (not yet implemented)

  Exit codes:
    0  Success
    1  Usage error
    3  Runtime error`)
  }

  if (!command || command === 'fight') {
    console.log(`fight <bot1> <bot2> [more...] [--seed N] [--rounds K] [--cycles N] [--procs N] [--spacing N] [--trace] [--trace-bot NAME] [--json]
  Run a match between bots. Accept roster slugs (roster:dwarf) or paths to .asm or .bin files.

  Options:
    --seed <N>      Random seed for placement (default: random)
    --rounds <K>    Number of rounds to run (default: 1)
    --cycles <N>    Maximum cycles per round (default: 100000)
    --procs <N>     Maximum processes per bot (default: 64)
    --spacing <N>   Minimum bytes between bot placements (default: 1024)
    --trace         Print execution trace
    --trace-bot NAME Print trace only for this bot
    --json          Machine-readable output
    --help          Show this help

  Exit codes:
    0  Success
    1  Usage error
    3  Runtime error`)
  }

  if (!command || command === 'tourney') {
    console.log(`tourney roundrobin|bracket|melee <files or roster:*> [--rounds K] [--out results.json] [--svg bracket.svg]
  Run a tournament. Accepts roster slugs (roster:dwarf) or paths to .asm or .bin files.

  Options:
    --rounds <K>    Number of rounds per match (default: 1)
    --out <file>    Write results to JSON file
    --svg <file>    Write SVG bracket (bracket format only)
    --json          Machine-readable output
    --help          Show this help

  Exit codes:
    0  Success
    1  Usage error
    3  Runtime error`)
  }

  if (!command || command === 'hill') {
    console.log(`hill submit <hill.json> <bot.asm> [--out hill.json]
  Submit a bot to a local King of the Hill.

  Options:
    --out <file>    Write updated hill to file (default: overwrite input)
    --json          Machine-readable output
    --help          Show this help

  Exit codes:
    0  Success
    1  Usage error
    3  Runtime error`)
  }

  if (!command || command === 'bench') {
    console.log(`bench [--seconds 5]
  Benchmark the engine.

  Options:
    --seconds <N>   Seconds to run (default: 5)
    --help          Show this help

  Exit codes:
    0  Success
    3  Runtime error`)
  }

  if (!command || command === 'golden') {
    console.log(`golden [--update]
  Verify golden test data.

  Options:
    --update        Update the golden results file
    --help          Show this help

  Exit codes:
    0  Success
    1  Mismatch or error
    2  Unknown argument`)
  }

  if (!command) {
    console.log(`Usage: asmbots <command> [options] [args]

Commands:
  asm       Assemble x16c source into a binary
  dis       Disassemble a binary file
  fight     Run a match between bots
  tourney   Run a tournament
  hill      Manage a King of the Hill
  bench     Benchmark the engine
  golden    Verify golden test data

Global options:
  --help    Show command-specific help
  --json    Machine-readable output
  --no-color  Disable colored output`)
  }
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)

  if (argv.length === 0) {
    printHelp()
    return 1
  }

  const parsed = parseArgs(argv)

  if (parsed.flags.help) {
    printHelp(parsed.command)
    return 0
  }

  switch (parsed.command) {
    case 'asm': {
      if (parsed.args.length === 0) {
        console.error(colorize('error: asm requires a file argument', 'red'))
        printHelp('asm')
        return 1
      }
      return await cmdAsm(parsed.args[0]!, parsed.flags)
    }

    case 'dis': {
      if (parsed.args.length === 0) {
        console.error(colorize('error: dis requires a file argument', 'red'))
        printHelp('dis')
        return 1
      }
      return await cmdDis(parsed.args[0]!, parsed.flags)
    }

    case 'fight': {
      return await cmdFight(parsed.args, parsed.flags)
    }

    case 'tourney': {
      return await cmdTourney(parsed.args, parsed.flags)
    }

    case 'hill': {
      return await cmdHill(parsed.args, parsed.flags)
    }

    case 'bench': {
      return await cmdBench(parsed.flags)
    }

    case 'golden': {
      return await cmdGolden(parsed.args, parsed.flags)
    }

    default: {
      console.error(colorize(`error: unknown command '${parsed.command}'`, 'red'))
      printHelp()
      return 1
    }
  }
}

process.exit(await main())
