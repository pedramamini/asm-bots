#!/usr/bin/env bun

import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import { assemble, disassemble, type AssembleOptions, type DisassembleOptions, formatDiag } from '@asmbots/asm'
import { Battle, type LoadedBot, type BattleConfigInput, type Result } from '@asmbots/engine'
import { fighter } from '@asmbots/bots'
import type { EventSink } from '@asmbots/engine'
import { NullSink } from '@asmbots/engine'

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

    case 'tourney':
    case 'hill':
    case 'bench':
    case 'golden': {
      console.error(colorize(`error: ${parsed.command} command not yet implemented`, 'red'))
      return 1
    }

    default: {
      console.error(colorize(`error: unknown command '${parsed.command}'`, 'red'))
      printHelp()
      return 1
    }
  }
}

process.exit(await main())
