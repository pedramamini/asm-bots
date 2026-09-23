import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { writeFileSync, unlinkSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { spawnSync } from 'bun'

const TEST_DIR = join(tmpdir(), 'asm-bots-cli-test')
const DWARF_PATH = join(TEST_DIR, 'dwarf.asm')
const DWARF_BIN_PATH = join(TEST_DIR, 'dwarf.bin')
const DWARF_OUTPUT_BIN_PATH = join(TEST_DIR, 'dwarf-output.bin')

const DWARF_SOURCE = `%name "Dwarf"
%author "ASM Bots"
%strategy "Bomb every 4th byte"

STRIDE equ 4
SIZE equ end - start
LAP equ (0x10000 - SIZE) / STRIDE

start: call .here
.here: pop bx
       sub bx, .here

lap:   mov di, bx
       mov cx, LAP
.bomb: sub di, STRIDE
       mov word [di], 0
       loop .bomb
       jmp lap

end:`

beforeAll(() => {
  const fs = require('fs')
  if (!fs.existsSync(TEST_DIR)) {
    fs.mkdirSync(TEST_DIR, { recursive: true })
  }
  writeFileSync(DWARF_PATH, DWARF_SOURCE, 'utf8')
})

afterAll(() => {
  const fs = require('fs')
  try {
    if (fs.existsSync(DWARF_PATH)) fs.unlinkSync(DWARF_PATH)
    if (fs.existsSync(DWARF_BIN_PATH)) fs.unlinkSync(DWARF_BIN_PATH)
    if (fs.existsSync(DWARF_OUTPUT_BIN_PATH)) fs.unlinkSync(DWARF_OUTPUT_BIN_PATH)
    if (fs.existsSync(TEST_DIR)) fs.rmdirSync(TEST_DIR)
  } catch {
    // Ignore cleanup errors
  }
})

describe('asmbots CLI', () => {
  it('assembles a bot file and returns 0', () => {
    const proc = spawnSync({
      cmd: ['bun', './apps/cli/src/main.ts', 'asm', DWARF_PATH],
      cwd: process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe',
    })

    expect(proc.success).toBe(true)
    const output = new TextDecoder().decode(proc.stdout!)
    expect(output).toContain('bytes')
  })

  it('writes binary with --bin flag', () => {
    const proc = spawnSync({
      cmd: ['bun', './apps/cli/src/main.ts', 'asm', DWARF_PATH, '--bin', DWARF_OUTPUT_BIN_PATH],
      cwd: process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe',
    })

    expect(proc.success).toBe(true)

    const fs = require('fs')
    expect(fs.existsSync(DWARF_OUTPUT_BIN_PATH)).toBe(true)

    const bytes = readFileSync(DWARF_OUTPUT_BIN_PATH)
    expect(bytes.length).toBeGreaterThan(0)
  })

  it('shows help with --help flag', () => {
    const proc = spawnSync({
      cmd: ['bun', './apps/cli/src/main.ts', 'asm', '--help'],
      cwd: process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe',
    })

    expect(proc.success).toBe(true)
    const output = new TextDecoder().decode(proc.stdout!)
    expect(output).toContain('asm <file.asm>')
  })

  it('disassembles a binary file', () => {
    // First assemble the file
    spawnSync({
      cmd: ['bun', './apps/cli/src/main.ts', 'asm', DWARF_PATH, '--bin', DWARF_BIN_PATH],
      cwd: process.cwd(),
    })

    // Then disassemble it
    const proc = spawnSync({
      cmd: ['bun', './apps/cli/src/main.ts', 'dis', DWARF_BIN_PATH],
      cwd: process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe',
    })

    expect(proc.success).toBe(true)
    const output = new TextDecoder().decode(proc.stdout!)
    expect(output).toContain('call')
    expect(output).toContain('0x0000')
  })

  it('disassembles with --base flag', () => {
    // First assemble the file
    spawnSync({
      cmd: ['bun', './apps/cli/src/main.ts', 'asm', DWARF_PATH, '--bin', DWARF_BIN_PATH],
      cwd: process.cwd(),
    })

    // Then disassemble with base
    const proc = spawnSync({
      cmd: ['bun', './apps/cli/src/main.ts', 'dis', DWARF_BIN_PATH, '--base', '0x1000'],
      cwd: process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe',
    })

    expect(proc.success).toBe(true)
    const output = new TextDecoder().decode(proc.stdout!)
    expect(output).toContain('0x1000')
  })

  it('returns 1 when asm is called without arguments', () => {
    const proc = spawnSync({
      cmd: ['bun', './apps/cli/src/main.ts', 'asm'],
      cwd: process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe',
    })

    expect(proc.success).toBe(false)
    expect(proc.exitCode).toBe(1)
  })

  it('returns 1 when dis is called without arguments', () => {
    const proc = spawnSync({
      cmd: ['bun', './apps/cli/src/main.ts', 'dis'],
      cwd: process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe',
    })

    expect(proc.success).toBe(false)
    expect(proc.exitCode).toBe(1)
  })

  it('runs a fight between two roster bots with fixed seed', () => {
    const proc = spawnSync({
      cmd: ['bun', './apps/cli/src/main.ts', 'fight', 'roster:dwarf', 'roster:imp', '--seed', '42', '--cycles', '100'],
      cwd: process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe',
    })

    expect(proc.success).toBe(true)
    const output = new TextDecoder().decode(proc.stdout!)
    expect(output).toContain('Placement:')
    expect(output).toContain('Dwarf')
    expect(output).toContain('Imp')
    expect(output).toContain('Bot statistics:')
    expect(output).toContain('Instructions:')
  })

  it('returns 1 when fight is called without enough arguments', () => {
    const proc = spawnSync({
      cmd: ['bun', './apps/cli/src/main.ts', 'fight', 'roster:dwarf'],
      cwd: process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe',
    })

    expect(proc.success).toBe(false)
    expect(proc.exitCode).toBe(1)
  })

  it('outputs valid JSON with --json flag', () => {
    const proc = spawnSync({
      cmd: ['bun', './apps/cli/src/main.ts', 'fight', 'roster:dwarf', 'roster:imp', '--seed', '42', '--cycles', '50', '--json'],
      cwd: process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe',
    })

    expect(proc.success).toBe(true)
    const output = new TextDecoder().decode(proc.stdout!)
    const json = JSON.parse(output)
    expect(json.result).toBeDefined()
    expect(json.result.cycles).toBe(50)
    expect(json.result.bots).toBeDefined()
    expect(json.result.bots.length).toBe(2)
    expect(json.result.bots[0]!.name).toBe('Dwarf')
    expect(json.result.bots[1]!.name).toBe('Imp')
  })

  it('produces trace output with --trace flag', () => {
    const proc = spawnSync({
      cmd: ['bun', './apps/cli/src/main.ts', 'fight', 'roster:dwarf', 'roster:imp', '--seed', '42', '--cycles', '10', '--trace'],
      cwd: process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe',
    })

    expect(proc.success).toBe(true)
    const output = new TextDecoder().decode(proc.stdout!)
    expect(output).toContain('Trace')
    expect(output).toContain('|')
  })
})
