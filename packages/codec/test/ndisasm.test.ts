import { describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hasNasm } from '../../../scripts/has-nasm'
import { type Decoded, decode, format, type Reader } from '../src/index'

const hex = (bytes: ArrayLike<number>) =>
  Array.from(bytes, (b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')
const bytesOf = (text: string) => text.split(' ').map((h) => Number.parseInt(h, 16))
const reader =
  (bytes: ArrayLike<number>): Reader =>
  (addr) =>
    bytes[addr] ?? 0

/** A deterministic stream of bytes. */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0
    return s >>> 24
  }
}

/** ISA §8, transcribed from the spec: source and bytes. */
const ISA_VECTORS: readonly (readonly [string, string])[] = [
  ['mov ax, 0x1234', 'B8 34 12'],
  ['mov word [bx], 0', 'C7 07 00 00'],
  ['mov byte [bx+si+4], 0x41', 'C6 40 04 41'],
  ['mov ax, [0x0100]', 'A1 00 01'],
  ['mov cx, [bp]', '8B 4E 00'],
  ['add bx, 4', '83 C3 04'],
  ['add bx, 0x100', '81 C3 00 01'],
  ['cmp al, 0', '3C 00'],
  ['xor ax, ax', '31 C0'],
  ['inc bx', '43'],
  ['dec word [di]', 'FF 0D'],
  ['shl ax, 1', 'D1 E0'],
  ['shr ax, cl', 'D3 E8'],
  ['jmp short $', 'EB FE'],
  ['jmp $ + 0x200', 'E9 FD 01'],
  ['jnz $ - 10', '75 F4'],
  ['loop $ - 4', 'E2 FA'],
  ['call $ + 3', 'E8 00 00'],
  ['pop bx', '5B'],
  ['push word [bx]', 'FF 37'],
  ['rep movsw', 'F3 A5'],
  ['repne scasb', 'F2 AE'],
  ['spl $ + 2', '60 00'],
  ['spl $ + 0x300', '61 FD 02'],
  // ISA §8 prints `62 03`, which ISA §2.2 reads as `spl [bp+di]` (see decode.test.ts).
  ['spl bx', '62 C3'],
  ['dat', '00 00'],
  ['hlt', 'F4'],
  ['int3', 'CC'],
  ['nop', '90'],
  ['lea si, [bx+di-2]', '8D 71 FE'],
  // The bytes ISA §8 prints for `spl bx`. ndisasm, like ISA §2.2, reads ModR/M 03 as [bp+di].
  ['spl word [bp+di]', '62 03'],
]

/*
 * Normalization. ndisasm and `format` write the same instruction differently, and ndisasm 2.16
 * (Ubuntu's, in CI) and 3.02 (Homebrew's) differ from each other. `normalize` maps all three to
 * one form. Our text is `format(x, { base })` with `base` the offset of x in the file ndisasm
 * reads, so relative targets print as ndisasm prints them: absolute addresses, mod 0x10000.
 *
 * 1. Lowercase. Operands split at commas and are trimmed: `mov ax, [bx]`, `mov ax,[bx]`.
 * 2. `short`, `near`, and `strict` go. We write them where NASM needs them to pick the encoding
 *    (`jmp short`, `jmp near`, `strict word 5`); 2.16 writes `jmp short 0x23`, 3.02 writes
 *    `call word near [bx]`.
 * 3. A size before a number goes: it sizes the immediate field, not the data. 2.16 writes
 *    `add bx,byte +0x4`, 3.02 writes `ret word 0x4`, we write `strict word 5`.
 * 4. A size inside brackets goes: it sizes the displacement field (`[byte bx+0]`).
 * 5. Numbers compare as 16-bit values. The sign-extended imm8 of `83 /n` is `-1` to us,
 *    `byte -0x1` to 2.16, and `0xffffffffffffffff` to 3.02.
 * 6. Memory is the registers, then the displacement unless it is 0: ndisasm writes `[bp+0x0]`
 *    and `[bx-0x2]` where we write `[bp]` and `[bx-2]`.
 * 7. `word` on the memory operand of `call` and `jmp` goes. 2.16 writes `call [bx]`, 3.02
 *    `call word near [bx]`, we `call word [bx]`. `FF /2` and `FF /4` have only a word form
 *    (ISA §3.3), so NASM needs no size.
 * 8. `xchg` operands are sorted. ndisasm puts the ModR/M `reg` operand first (`xchg ax,[bx]`);
 *    ISA §3.1 (`XCHG r/m16, r16`) and `format` put `r/m` first. The exchange is symmetric.
 *
 * Everything else must match as written. Rules 4 and 6 hide the displacement field, so lengths
 * must match too: ndisasm's instruction at our address has as many bytes as ours.
 */

const REGISTERS = new Set('ax cx dx bx sp bp si di al cl dl bl ah ch dh bh'.split(' '))
const SIZES = new Set(['byte', 'word'])
const DISTANCES = new Set(['short', 'near', 'strict'])
const PREFIXES = new Set(['rep', 'repe', 'repne'])

/** A number as a 16-bit value in hex (rule 5), or undefined for anything else. */
function value(text: string): string | undefined {
  const m = /^([+-]?)(0x[0-9a-f]+|[0-9]+)$/.exec(text)
  if (m === null) return undefined
  const n = BigInt(m[2] as string)
  return `0x${BigInt.asUintN(16, m[1] === '-' ? -n : n).toString(16)}`
}

/** One operand of `mnemonic`, normalized; a `?` marks text the rules do not cover. */
function operand(raw: string, mnemonic: string): string {
  const words = raw.split(' ').filter((w) => w !== '' && !DISTANCES.has(w))
  const text = words.join(' ')
  const open = text.indexOf('[')
  if (open < 0) {
    const [first = '', second = ''] = words
    if (words.length === 1 && REGISTERS.has(first)) return first
    const n = words.length === 1 ? first : words.length === 2 && SIZES.has(first) ? second : ''
    return value(n) ?? `?${raw}`
  }
  const size = text.slice(0, open).trim()
  const terms = text
    .slice(open + 1, text.lastIndexOf(']'))
    .split(' ')
    .filter((w) => !SIZES.has(w))
    .join('')
  const regs: string[] = []
  let disp = 0n
  for (const term of terms.match(/[+-]?[^+-]+/g) ?? []) {
    const name = term.replace(/^\+/, '')
    const n = value(term)
    if (REGISTERS.has(name)) regs.push(name)
    else if (n !== undefined) disp += BigInt(n)
    else return `?${raw}`
  }
  const d = `0x${BigInt.asUintN(16, disp).toString(16)}`
  const ea = regs.length === 0 ? d : d === '0x0' ? regs.join('+') : `${regs.join('+')}+${d}`
  const word = size === 'word' && (mnemonic === 'call' || mnemonic === 'jmp')
  return `${size === '' || word ? '' : `${size} `}[${ea}]`
}

/** ndisasm's text or ours in one form (rules 1..8). */
function normalize(text: string): string {
  const words = text.toLowerCase().trim().split(/\s+/)
  const n = PREFIXES.has(words[0] ?? '') ? 2 : 1
  const mnemonic = words[n - 1] ?? ''
  const rest = words.slice(n).join(' ')
  const operands = rest === '' ? [] : rest.split(',').map((op) => operand(op, mnemonic))
  if (mnemonic === 'xchg') operands.sort()
  const head = words.slice(0, n).join(' ')
  return operands.length === 0 ? head : `${head} ${operands.join(',')}`
}

/**
 * ISA §9: bytes x16c v1 reads one way and ndisasm, which decodes the 8086 and its successors,
 * another. Each entry has our leading bytes and ndisasm's normalized text from ours. No other
 * difference is allowed, and each entry must occur.
 */
interface Divergence {
  readonly bytes: RegExp
  readonly ndisasm: (ours: string) => string
  readonly why: string
}

const DIVERGENCES: readonly Divergence[] = [
  {
    bytes: /^00 00$/,
    ndisasm: () => 'add [bx+si],al',
    why: 'ISA §9.1: 00 is DAT; the 8086 reads 00 /r as ADD r/m8, r8',
  },
  {
    bytes: /^60 /,
    ndisasm: () => 'pusha',
    why: 'ISA §9.2: 60 cb is SPL rel8; the 80186 reads 60 as PUSHA',
  },
  {
    bytes: /^61 /,
    ndisasm: () => 'popa',
    why: 'ISA §9.2: 61 cw is SPL rel16; the 80186 reads 61 as POPA',
  },
  {
    bytes: /^62 [C-F]/,
    ndisasm: () => 'db 0x62',
    why: 'ISA §9.2: 62 /0 is SPL r/m16; BOUND has no register form',
  },
  {
    bytes: /^62 /,
    ndisasm: (ours) => ours.replace(/^spl word /, 'bound ax,'),
    why: 'ISA §9.2: 62 /0 is SPL r/m16; the 80186 reads 62 /r as BOUND r16, m',
  },
]

describe('ndisasm normalization', () => {
  /** Bytes; ndisasm 2.16.01 and 3.02 output for them at offset 0; the normal form of both. */
  const SEEN: readonly (readonly [string, string, string, string])[] = [
    ['83 C3 FF', 'add bx,byte -0x1', 'add bx,0xffffffffffffffff', 'add bx,0xffff'],
    ['83 C3 04', 'add bx,byte +0x4', 'add bx,0x4', 'add bx,0x4'],
    [
      '83 07 80',
      'add word [bx],byte -0x80',
      'add word [bx],0xffffffffffffff80',
      'add word [bx],0xff80',
    ],
    ['81 C3 05 00', 'add bx,0x5', 'add bx,0x5', 'add bx,0x5'],
    ['EB 80', 'jmp short 0xff82', 'jmp 0xff82', 'jmp 0xff82'],
    ['E9 02 00', 'jmp 0x5', 'jmp 0x5', 'jmp 0x5'],
    ['C2 04 00', 'ret 0x4', 'ret word 0x4', 'ret 0x4'],
    ['FF 17', 'call [bx]', 'call word near [bx]', 'call [bx]'],
    ['FF 27', 'jmp [bx]', 'jmp word near [bx]', 'jmp [bx]'],
    ['FF 37', 'push word [bx]', 'push word [bx]', 'push word [bx]'],
    ['87 07', 'xchg ax,[bx]', 'xchg ax,[bx]', 'xchg [bx],ax'],
    ['87 D8', 'xchg bx,ax', 'xchg bx,ax', 'xchg ax,bx'],
    ['8B 47 00', 'mov ax,[bx+0x0]', 'mov ax,[bx+0x0]', 'mov ax,[bx]'],
    ['8B 4E 00', 'mov cx,[bp+0x0]', 'mov cx,[bp+0x0]', 'mov cx,[bp]'],
    ['8B 87 FE FF', 'mov ax,[bx-0x2]', 'mov ax,[bx-0x2]', 'mov ax,[bx+0xfffe]'],
    ['8B 06 00 01', 'mov ax,[0x100]', 'mov ax,[0x100]', 'mov ax,[0x100]'],
    ['D2 27', 'shl byte [bx],cl', 'shl byte [bx],cl', 'shl byte [bx],cl'],
    ['F3 A6', 'repe cmpsb', 'repe cmpsb', 'repe cmpsb'],
  ]

  for (const [bytes, v216, v302, normal] of SEEN) {
    it(`reads ${bytes} from ndisasm 2.16, ndisasm 3.02, and format as ${normal}`, () => {
      const ours = format(decode(reader(bytesOf(bytes)), 0), { base: 0 })
      expect([ours, v216, v302].map(normalize)).toEqual([normal, normal, normal])
    })
  }

  it('keeps far, so a far call never passes for a near one, and marks text it cannot read', () => {
    expect(normalize('call far [bx]')).toBe('call far [bx]')
    expect(normalize('jmp $ + 2')).toBe('jmp ?$ + 2')
    expect(normalize('mov ax,[bx+label]')).toBe('mov ax,?[bx+label]')
  })
})

/** An instruction in the file ndisasm reads: its bytes, at `offset`, and our decoding of them. */
interface Sample {
  readonly vector: boolean
  readonly offset: number
  readonly bytes: readonly number[]
  readonly decoded: Decoded
}

/** ndisasm's first line at an address: the bytes it took and its text. */
interface Line {
  readonly length: number
  readonly text: string
}

/** The ISA §8 vectors, then 2,000 random ok decodes, laid end to end. */
function samples(): Sample[] {
  const out: Sample[] = []
  let offset = 0
  const add = (vector: boolean, bytes: readonly number[], decoded: Decoded) => {
    out.push({ vector, offset, bytes, decoded })
    offset += bytes.length
  }
  for (const [, text] of ISA_VECTORS) {
    const bytes = bytesOf(text)
    add(true, bytes, decode(reader(bytes), 0))
  }
  const next = lcg(0x0d15)
  for (let n = 0; n < 2000; ) {
    const bytes = Array.from({ length: 8 }, next)
    const decoded = decode(reader(bytes), 0)
    if (!decoded.ok) continue
    add(false, bytes.slice(0, decoded.length), decoded)
    n++
  }
  return out
}

/**
 * Runs `ndisasm -b16` once over every sample. A sync point (`-s`) at each sample, and at the end,
 * makes ndisasm start a line at each of our addresses; where its instruction would cross the next
 * one, it prints `db` instead. NASM 3.02's ndisasm garbles long output sent to a pipe, so its
 * output goes to a file.
 */
function ndisasm(all: readonly Sample[]): Map<number, Line> {
  const dir = mkdtempSync(join(tmpdir(), 'codec-ndisasm-'))
  try {
    const bin = join(dir, 'samples.bin')
    const listing = join(dir, 'samples.txt')
    writeFileSync(bin, Uint8Array.from(all.flatMap((s) => s.bytes)))
    const end = all.reduce((n, s) => n + s.bytes.length, 0)
    const sync = [...all.map((s) => s.offset), end].flatMap((o) => ['-s', String(o)])
    const fd = openSync(listing, 'w')
    const run = spawnSync('ndisasm', ['-b16', ...sync, bin], {
      stdio: ['ignore', fd, 'pipe'],
      encoding: 'utf8',
    })
    closeSync(fd)
    if (run.status !== 0) throw new Error(`ndisasm failed: ${run.stderr || run.error}`)
    const lines = new Map<number, Line>()
    for (const line of readFileSync(listing, 'utf8').split('\n')) {
      if (line === '') continue
      const m = /^([0-9A-F]{8}) {2}([0-9A-F]+) +(\S.*)$/.exec(line)
      if (m === null) throw new Error(`unreadable ndisasm line \`${line}\``)
      const [, address = '', code = '', text = ''] = m
      lines.set(Number.parseInt(address, 16), { length: code.length / 2, text })
    }
    return lines
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** How ndisasm's reading of `s` differs from ours, or undefined if it does not. */
function compare(s: Sample, line: Line | undefined, used: Set<Divergence>): string | undefined {
  const tag = `${hex(s.bytes)} \`${format(s.decoded)}\``
  if (s.decoded.length !== s.bytes.length) return `${tag}: we decode ${s.decoded.length} bytes`
  if (line === undefined) return `${tag}: no ndisasm line at ${s.offset}`
  const ours = normalize(format(s.decoded, { base: s.offset }))
  const theirs = normalize(line.text)
  const divergence = DIVERGENCES.find((d) => d.bytes.test(hex(s.bytes)))
  if (divergence !== undefined) {
    used.add(divergence)
    const allowed = divergence.ndisasm(ours)
    if (theirs === allowed) return undefined
    return `${tag}: ndisasm \`${line.text}\`, not \`${allowed}\` (${divergence.why})`
  }
  if (theirs === ours && line.length === s.bytes.length) return undefined
  return `${tag}: ndisasm \`${line.text}\` (${line.length} bytes) is \`${theirs}\`, ours \`${ours}\``
}

describe.skipIf(!hasNasm())('ndisasm -b16 cross-check', () => {
  // Built on first use: a skipped describe still runs this callback.
  let result: { vectors: string[]; random: string[]; used: Set<Divergence> } | undefined
  const run = () => {
    if (result !== undefined) return result
    const all = samples()
    const lines = ndisasm(all)
    const used = new Set<Divergence>()
    const differences = (vector: boolean) =>
      all
        .filter((s) => s.vector === vector)
        .flatMap((s) => compare(s, lines.get(s.offset), used) ?? [])
    result = { vectors: differences(true), random: differences(false), used }
    return result
  }

  it('reads every ISA §8 vector as we do, but for the ISA §9 divergences', () => {
    expect(run().vectors).toEqual([])
  })

  it('reads 2,000 random ok decodes as we do, but for the ISA §9 divergences', () => {
    expect(run().random.slice(0, 20)).toEqual([])
  })

  it('meets every allowed divergence', () => {
    const { used } = run()
    expect(DIVERGENCES.filter((d) => !used.has(d)).map((d) => d.why)).toEqual([])
  })
})
