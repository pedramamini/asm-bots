#!/usr/bin/env bun

import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import { assemble, disassemble, type AssembleOptions, type DisassembleOptions, formatDiag } from '@asmbots/asm'

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

    case 'fight':
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
