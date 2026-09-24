import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { decode, MNEMONICS, TABLE } from '../packages/codec/src/index'
import { hasModrm } from '../packages/codec/src/table'
import {
  AF,
  CF,
  Core,
  CX,
  DF,
  EXEC_KILLED,
  ExecContext,
  execOne,
  FLAGS,
  FLAGS_INIT,
  FLAGS_WRITABLE,
  IP,
  OF,
  Pcg32,
  PF,
  ProcQueue,
  SF,
  ZF,
} from '../packages/engine/src/index'
import {
  FAMILY,
  FLAGS as FLAG_CLAIMS,
  FLAG_NAMES,
  generate,
  NOTES,
  type Notes,
  type OpcodeDocs,
  OUT,
  render,
} from './gen-opcode-docs'

const notes: Notes = JSON.parse(readFileSync(NOTES, 'utf8'))
const docs: OpcodeDocs = generate(notes)

describe('gen-opcode-docs: the file', () => {
  it('is what the generator writes: run `bun run opcodes` after changing the table or notes', () => {
    expect(readFileSync(OUT, 'utf8')).toBe(render(notes))
  })

  it('says so from the command line with --check', () => {
    const run = Bun.spawnSync(['bun', 'scripts/gen-opcode-docs.ts', '--check'], {
      cwd: `${import.meta.dir}/..`,
    })
    expect(run.stdout.toString()).toBe('docs/opcodes.json is up to date\n')
    expect(run.exitCode).toBe(0)
  })
})

describe('gen-opcode-docs: the entries', () => {
  it('documents every mnemonic and prefix, each in a family', () => {
    expect(Object.keys(docs.mnemonics)).toEqual([...MNEMONICS])
    expect(Object.keys(docs.prefixes)).toEqual(['rep', 'repe', 'repne'])
    for (const m of MNEMONICS) expect([m, FAMILY.has(m)]).toEqual([m, true])
    expect(docs.mnemonics.jz?.aliases).toEqual(['je'])
    expect(docs.mnemonics.jc?.aliases).toEqual(['jb', 'jnae'])
    expect(docs.prefixes.repne?.aliases).toEqual(['repnz'])
    expect(docs.prefixes.repe?.takes).toEqual(['cmpsb', 'cmpsw', 'scasb', 'scasw'])
  })

  it('gives each table row a form of its mnemonic', () => {
    for (const row of TABLE) {
      const forms = docs.mnemonics[row.mnemonic]?.forms ?? []
      expect(forms.length).toBeGreaterThan(0)
    }
    const form = (m: string, syntax: string) =>
      docs.mnemonics[m]?.forms.find((f) => f.syntax === syntax)?.encoding
    expect(form('mov', 'mov r16, imm16')).toBe('B8+r iw')
    expect(form('mov', 'mov al, [moffs16]')).toBe('A0 iw')
    expect(form('mov', 'mov r/m16, imm16')).toBe('C7 /0 iw')
    expect(form('xchg', 'xchg ax, r16')).toBe('90+r')
    expect(form('add', 'add r/m16, imm8')).toBe('83 /0 ib')
    expect(form('add', 'add r/m8, r8')).toBeUndefined()
    expect(form('lea', 'lea r16, m')).toBe('8D /r')
    expect(form('jz', 'jz rel8')).toBe('74 cb')
    expect(form('ret', 'ret imm16')).toBe('C2 iw')
    expect(form('movsw', 'rep movsw')).toBe('F3 A5')
    expect(form('scasb', 'repne scasb')).toBe('F2 AE')
    expect(form('spl', 'spl r/m16')).toBe('62 /0')
    expect(form('dat', 'dat imm8')).toBe('00 ib')
    expect(form('shl', 'shl r/m16, cl')).toBe('D3 /4')
  })

  it('assembles each example, which shows its own mnemonic', () => {
    for (const [what, doc] of [
      ...Object.entries(docs.mnemonics),
      ...Object.entries(docs.prefixes),
    ]) {
      const words = doc.example.flatMap((l) => l.source.toLowerCase().split(/[\s,:]+/))
      const spellings = [what, ...doc.aliases]
      expect([what, spellings.some((s) => words.includes(s))]).toEqual([what, true])
      expect([what, doc.example.every((l) => l.bytes !== '' || /:$/.test(l.source))]).toEqual([
        what,
        true,
      ])
    }
    expect(docs.mnemonics.mov?.example).toEqual([
      { source: 'mov     word [di], 0', bytes: 'C7 05 00 00' },
    ])
    expect(docs.mnemonics.call?.example).toEqual([
      { source: 'start:  call    .here', bytes: 'E8 00 00' },
      { source: '.here:  pop     bx', bytes: '5B' },
    ])
  })

  it('names the file to fix when a note is missing or an example is wrong', () => {
    const { mov: _, ...rest } = notes.mnemonics
    expect(() => generate({ ...notes, mnemonics: rest })).toThrow(
      '`mov` needs a summary and an example',
    )
    const bad = { ...notes.mnemonics, mov: { summary: 's', example: 'mov [bx], 0' } }
    expect(() => generate({ ...notes, mnemonics: bad })).toThrow(
      'the example of mov does not assemble:\n  1:5: error: operation size not specified',
    )
    const extra = { ...notes.mnemonics, movq: { summary: 's', example: 'nop' } }
    expect(() => generate({ ...notes, mnemonics: extra })).toThrow('`movq` is not a mnemonic')
  })
})

/** FLAGS bits in `FLAG_NAMES` order. I and T are not x16c flags: they read 0 (ISA §1). */
const FLAG_BITS = [OF, DF, 0x0200, 0x0100, SF, ZF, AF, PF, CF]

/** Values that make flags flip: signs, carries, zero, in the low byte and in the word. */
const EDGE_BYTES = [0x00, 0x01, 0x0f, 0x10, 0x7f, 0x80, 0xfe, 0xff]
const EDGE_WORDS = [0x0000, 0x0001, 0x007f, 0x0080, 0x00ff, 0x7fff, 0x8000, 0xffff]

/**
 * Every row of the table runs in the engine from random states, and each flag must do what the
 * reference says: `-` never changes, `0` and `1` always end so, and `*` ends both ways and
 * changes. A row runs `MIN_TRIALS` times, and on until its mnemonic's `*` flags have done so
 * (`MAX_TRIALS` at most): equal words, which set ZF after CMPSW, are rare in random data. Kills
 * (divide errors, DAT, HLT, INT3) show nothing and are skipped.
 */
describe('gen-opcode-docs: FLAGS against the engine', () => {
  const MIN_TRIALS = 300
  const MAX_TRIALS = 20_000
  const BASE = 0x4000
  const rng = new Pcg32(0x0dc5, 7)
  const byte = () =>
    rng.nextInt(4) === 0 ? (EDGE_BYTES[rng.nextInt(8)] as number) : rng.nextInt(256)
  const word = () =>
    rng.nextInt(4) === 0 ? (EDGE_WORDS[rng.nextInt(8)] as number) : byte() | (byte() << 8)

  const core = new Core()
  for (let a = 0; a < 0x10000; a += 2) core.write16(a, word(), 0)
  const read = (a: number) => core.bytes[a & 0xffff] as number
  const ctx = new ExecContext()

  /** Per mnemonic and flag: seen ending 0, ending 1, and changing. */
  const seen = new Map<string, { end0: boolean; end1: boolean; changed: boolean }[]>()
  const wrong: string[] = []

  for (const row of TABLE) {
    if (row.kills === true) continue
    const claim = FLAG_CLAIMS.get(row.mnemonic) ?? '---------'
    const marks =
      seen.get(row.mnemonic) ?? FLAG_BITS.map(() => ({ end0: false, end1: false, changed: false }))
    seen.set(row.mnemonic, marks)
    const settled = () => marks.every((m, k) => claim[k] !== '*' || (m.end0 && m.end1 && m.changed))
    for (let trial = 0; trial < MIN_TRIALS || (trial < MAX_TRIALS && !settled()); trial++) {
      const queue = new ProcQueue(4)
      const proc = queue.rows[queue.push()] as Uint16Array
      for (let r = 0; r < 8; r++) proc[r] = word()
      // A count of 0 changes no flag (ISA §4), which the reference says apart.
      if (row.operands.includes('CL') && ((proc[CX] as number) & 0xff) === 0) proc[CX] = word() | 1
      proc[IP] = BASE
      const before = (word() & FLAGS_WRITABLE) | FLAGS_INIT
      proc[FLAGS] = before
      // The row's opcode, ModR/M with its extension (memory only for `m`), and random fields.
      const bytes = [row.opcode]
      if (hasModrm(row)) {
        let modrm = byte()
        if (row.ext !== undefined) modrm = (modrm & 0xc7) | (row.ext << 3)
        if (row.operands.includes('m') && modrm >= 0xc0) modrm &= 0x3f
        bytes.push(modrm)
      }
      for (let k = 0; k < 4; k++) bytes.push(byte())
      core.fill(BASE, bytes, 0)
      const decoded = decode(read, BASE)
      if (!decoded.ok || decoded.instr.mnemonic !== row.mnemonic) {
        throw new Error(`${row.mnemonic}: bytes ${bytes} decode to something else`)
      }
      if (execOne({ tag: 1, queue }, proc, core, decoded.instr, ctx) === EXEC_KILLED) continue
      const after = proc[FLAGS] as number
      FLAG_BITS.forEach((bit, k) => {
        const was = (before & bit) !== 0
        const is = (after & bit) !== 0
        const mark = marks[k] as (typeof marks)[number]
        if (is) mark.end1 = true
        else mark.end0 = true
        if (is !== was) mark.changed = true
        const c = claim[k]
        const ok = c === '-' ? is === was : c === '0' ? !is : c === '1' ? is : true
        if (!ok)
          wrong.push(`${row.mnemonic} (${bytes.map((b) => b.toString(16))}): ${FLAG_NAMES[k]}`)
      })
    }
  }

  it('changes no flag the reference says is kept, cleared, or set', () => {
    expect(wrong.slice(0, 10)).toEqual([])
  })

  it('changes both ways each flag the reference says comes from the result', () => {
    const idle: string[] = []
    for (const [mnemonic, marks] of seen) {
      const claim = FLAG_CLAIMS.get(mnemonic) ?? '---------'
      marks.forEach((m, k) => {
        if (claim[k] === '*' && !(m.end0 && m.end1 && m.changed)) {
          idle.push(`${mnemonic} ${FLAG_NAMES[k]}`)
        }
      })
    }
    expect(idle).toEqual([])
    // Every mnemonic ran without a kill at least once, DIV and IDIV included.
    expect(seen.size).toBe(MNEMONICS.length - 3)
  })
})
