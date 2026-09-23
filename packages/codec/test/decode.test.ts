import { describe, expect, it } from 'bun:test'
import {
  DECODE_DAT,
  DECODE_HLT,
  DECODE_INT3,
  DECODE_UNDEFINED,
  type Decoded,
  decode,
  decodeInto,
  type Instr,
  type MemOperand,
  type Mnemonic,
  type Operand,
  PREFIX_BYTE,
  type Prefix,
  type Reader,
  Reg8,
  Reg16,
  TABLE,
} from '../src/index'

const hex = (b: number) => b.toString(16).toUpperCase().padStart(2, '0')
const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i)
const bytesOf = (text: string) => text.split(' ').map((h) => Number.parseInt(h, 16))

/** A reader over `bytes` placed at `base` that logs every address it is asked for. */
function spy(bytes: readonly number[], base = 0) {
  const reads: number[] = []
  const read: Reader = (addr) => {
    reads.push(addr)
    return bytes[addr - base] ?? 0xee
  }
  return { read, reads }
}

const at = (bytes: readonly number[]) => decode(spy(bytes).read, 0)

const r16 = (name: keyof typeof Reg16): Operand => ({ kind: 'reg16', reg: Reg16[name] })
const r8 = (name: keyof typeof Reg8): Operand => ({ kind: 'reg8', reg: Reg8[name] })
const imm = (value: number, size: 8 | 16, signed = false): Operand => ({
  kind: 'imm',
  value,
  size,
  signed,
})
const rel = (target: number, size: 8 | 16): Operand => ({ kind: 'rel', target, size })
const moffs = (addr: number, size: 8 | 16): Operand => ({ kind: 'moffs', addr, size })
type Ea = Partial<Pick<MemOperand, 'base' | 'index' | 'disp' | 'dispSize'>>
const mem = (size: MemOperand['size'], ea: Ea = {}): Operand => ({
  kind: 'mem',
  base: ea.base,
  index: ea.index,
  disp: ea.disp ?? 0,
  dispSize: ea.dispSize ?? 0,
  size,
})

const ok = (length: number, mnemonic: Mnemonic, operands: Operand[] = [], prefix?: Prefix) =>
  ({ ok: true, instr: { mnemonic, operands, prefix, length }, length }) satisfies Decoded
const undef = (byte: number) =>
  ({ ok: false, reason: 'undefined', byte, length: 1 }) satisfies Decoded

/** One line per operand with only the fields its kind defines, so scratch operands compare. */
function text(op: Operand | undefined): string {
  switch (op?.kind) {
    case 'reg16':
    case 'reg8':
      return `${op.kind} ${op.reg}`
    case 'imm':
      return `imm ${op.value} ${op.size} ${op.signed}`
    case 'mem':
      return `mem ${op.base} ${op.index} ${op.disp} ${op.dispSize} ${op.size}`
    case 'rel':
      return `rel ${op.target} ${op.size}`
    case 'moffs':
      return `moffs ${op.addr} ${op.size}`
    case undefined:
      return 'none'
  }
}
const instrText = (i: Instr) =>
  `${i.prefix ?? ''} ${i.mnemonic} [${i.operands.map(text).join(', ')}] ${i.length}`
const newOut = (): Instr => ({ mnemonic: 'nop', operands: [], length: 1 })

/** ISA §8, transcribed from the spec: source, bytes, and the decode the source means. */
const ISA_VECTORS: readonly [string, string, Mnemonic, Operand[], Prefix?][] = [
  ['mov ax, 0x1234', 'B8 34 12', 'mov', [r16('ax'), imm(0x1234, 16)]],
  ['mov word [bx], 0', 'C7 07 00 00', 'mov', [mem(16, { base: 'bx' }), imm(0, 16)]],
  [
    'mov byte [bx+si+4], 0x41',
    'C6 40 04 41',
    'mov',
    [mem(8, { base: 'bx', index: 'si', disp: 4, dispSize: 8 }), imm(0x41, 8)],
  ],
  ['mov ax, [0x0100]', 'A1 00 01', 'mov', [r16('ax'), moffs(0x100, 16)]],
  ['mov cx, [bp]', '8B 4E 00', 'mov', [r16('cx'), mem(16, { base: 'bp', dispSize: 8 })]],
  ['add bx, 4', '83 C3 04', 'add', [r16('bx'), imm(4, 8, true)]],
  ['add bx, 0x100', '81 C3 00 01', 'add', [r16('bx'), imm(0x100, 16)]],
  ['cmp al, 0', '3C 00', 'cmp', [r8('al'), imm(0, 8)]],
  ['xor ax, ax', '31 C0', 'xor', [r16('ax'), r16('ax')]],
  ['inc bx', '43', 'inc', [r16('bx')]],
  ['dec word [di]', 'FF 0D', 'dec', [mem(16, { index: 'di' })]],
  ['shl ax, 1', 'D1 E0', 'shl', [r16('ax'), imm(1, 8)]],
  ['shr ax, cl', 'D3 E8', 'shr', [r16('ax'), r8('cl')]],
  ['jmp short $', 'EB FE', 'jmp', [rel(0, 8)]],
  ['jmp $ + 0x200', 'E9 FD 01', 'jmp', [rel(0x200, 16)]],
  ['jnz $ - 10', '75 F4', 'jnz', [rel(-10, 8)]],
  ['loop $ - 4', 'E2 FA', 'loop', [rel(-4, 8)]],
  ['call $ + 3', 'E8 00 00', 'call', [rel(3, 16)]],
  ['pop bx', '5B', 'pop', [r16('bx')]],
  ['push word [bx]', 'FF 37', 'push', [mem(16, { base: 'bx' })]],
  ['rep movsw', 'F3 A5', 'movsw', [], 'rep'],
  ['repne scasb', 'F2 AE', 'scasb', [], 'repne'],
  ['spl $ + 2', '60 00', 'spl', [rel(2, 8)]],
  ['spl $ + 0x300', '61 FD 02', 'spl', [rel(0x300, 16)]],
  // ISA §8 prints `62 03`. Under §2.2 that is `spl [bp+di]` (see the erratum test below);
  // `spl bx` needs mod=11.
  ['spl bx', '62 C3', 'spl', [r16('bx')]],
  ['nop', '90', 'nop', []],
  [
    'lea si, [bx+di-2]',
    '8D 71 FE',
    'lea',
    [r16('si'), mem(undefined, { base: 'bx', index: 'di', disp: -2, dispSize: 8 })],
  ],
]

/** The ISA §8 rows that decode to a kill. */
const ISA_KILLS: readonly [string, 'dat' | 'hlt' | 'int3', Operand[]][] = [
  ['00 00', 'dat', [imm(0, 8)]],
  ['F4', 'hlt', []],
  ['CC', 'int3', []],
]

describe('decode: ISA §8 vectors', () => {
  // Away from 0, to show that reads start at addr and targets stay relative.
  const base = 0x4000

  for (const [source, bytesText, mnemonic, operands, prefix] of ISA_VECTORS) {
    it(`decodes ${bytesText} as ${source}`, () => {
      const bytes = bytesOf(bytesText)
      const { read, reads } = spy(bytes, base)
      expect(decode(read, base)).toEqual(ok(bytes.length, mnemonic, operands, prefix))
      expect(reads).toEqual(range(base, base + bytes.length - 1))
    })
  }

  for (const [bytesText, reason, operands] of ISA_KILLS) {
    it(`decodes ${bytesText} as ${reason}, which kills`, () => {
      const bytes = bytesOf(bytesText)
      const { read, reads } = spy(bytes, base)
      const length = bytes.length
      expect(decode(read, base)).toEqual({
        ok: false,
        reason,
        instr: { mnemonic: reason, operands, prefix: undefined, length },
        length,
      })
      expect(reads).toEqual(range(base, base + length - 1))
    })
  }

  it('decodes 62 03, printed in ISA §8 as `spl bx`, as spl [bp+di] per ISA §2.2', () => {
    // ModR/M 03 is mod=00 reg=/0 rm=011. The register form of `spl bx` is 62 C3.
    expect(at([0x62, 0x03])).toEqual(ok(2, 'spl', [mem(16, { base: 'bp', index: 'di' })]))
  })

  it('decodes DAT with any second byte', () => {
    expect(at([0x00, 0x41])).toEqual({
      ok: false,
      reason: 'dat',
      instr: { mnemonic: 'dat', operands: [imm(0x41, 8)], prefix: undefined, length: 2 },
      length: 2,
    })
  })
})

describe('decode: group opcodes select the row by /n', () => {
  const ALU: Mnemonic[] = ['add', 'or', 'adc', 'sbb', 'and', 'sub', 'xor', 'cmp']
  const SHIFT = ['rol', 'ror', 'rcl', 'rcr', 'shl', 'shr', undefined, 'sar'] as const
  const UNARY = ['test', undefined, 'not', 'neg', 'mul', 'imul', 'div', 'idiv'] as const
  const only = (m: Mnemonic) => [m, ...Array<undefined>(7).fill(undefined)]

  interface After {
    tail: number[]
    operand?: Operand
  }
  const NONE: After = { tail: [] }
  const IMM8: After = { tail: [0xfc], operand: imm(0xfc, 8) }
  const IMM16: After = { tail: [0xfc, 0xff], operand: imm(0xfffc, 16) }
  const SIMM8: After = { tail: [0xfc], operand: imm(-4, 8, true) }
  const ONE: After = { tail: [], operand: imm(1, 8) }
  const CL: After = { tail: [], operand: r8('cl') }

  /** Per group opcode: r/m size, mnemonic per /n, and what follows the r/m operand per /n. */
  const GROUPS: readonly [
    number,
    8 | 16,
    readonly (Mnemonic | undefined)[],
    (n: number) => After,
  ][] = [
    [0x80, 8, ALU, () => IMM8],
    [0x81, 16, ALU, () => IMM16],
    [0x83, 16, ALU, () => SIMM8],
    [0x8f, 16, only('pop'), () => NONE],
    [0x62, 16, only('spl'), () => NONE],
    [0xc6, 8, only('mov'), () => IMM8],
    [0xc7, 16, only('mov'), () => IMM16],
    [0xd0, 8, SHIFT, () => ONE],
    [0xd1, 16, SHIFT, () => ONE],
    [0xd2, 8, SHIFT, () => CL],
    [0xd3, 16, SHIFT, () => CL],
    [0xf6, 8, UNARY, (n) => (n === 0 ? IMM8 : NONE)],
    [0xf7, 16, UNARY, (n) => (n === 0 ? IMM16 : NONE)],
    [0xfe, 8, ['inc', 'dec', ...Array<undefined>(6).fill(undefined)], () => NONE],
    [0xff, 16, ['inc', 'dec', 'call', undefined, 'jmp', undefined, 'push', undefined], () => NONE],
  ]

  it('covers every group opcode in the table', () => {
    const groups = [...new Set(TABLE.filter((r) => r.ext !== undefined).map((r) => r.opcode))]
    expect(GROUPS.map(([op]) => op).sort((a, b) => a - b)).toEqual(groups.sort((a, b) => a - b))
  })

  it('decodes /0../7 of every group opcode in register and memory form', () => {
    for (const [opcode, size, mnemonics, after] of GROUPS) {
      for (const n of range(0, 7)) {
        const mnemonic = mnemonics[n]
        const { tail, operand } = after(n)
        const forms: [number[], Operand][] = [
          // mod=11 rm=011: bx or bl.
          [[opcode, 0xc0 | (n << 3) | 3, ...tail], size === 8 ? r8('bl') : r16('bx')],
          // mod=01 rm=010: [bp+si+disp8].
          [
            [opcode, 0x40 | (n << 3) | 2, 0x10, ...tail],
            mem(size, { base: 'bp', index: 'si', disp: 0x10, dispSize: 8 }),
          ],
        ]
        for (const [bytes, rm] of forms) {
          const expected =
            mnemonic === undefined
              ? undef(opcode)
              : ok(bytes.length, mnemonic, operand ? [rm, operand] : [rm])
          expect([hex(opcode), n, at(bytes)]).toEqual([hex(opcode), n, expected])
        }
      }
    }
  })
})

describe('decode: ModR/M addressing (ISA §2.2)', () => {
  const EA: readonly Pick<MemOperand, 'base' | 'index'>[] = [
    { base: 'bx', index: 'si' },
    { base: 'bx', index: 'di' },
    { base: 'bp', index: 'si' },
    { base: 'bp', index: 'di' },
    { index: 'si' },
    { index: 'di' },
    { base: 'bp' },
    { base: 'bx' },
  ]

  /**
   * The r/m operand for `mod` and `rm`, and the displacement bytes after ModR/M. disp8 `9C` is
   * -100; disp16 `01 80` is -32767 as a displacement and 0x8001 as an absolute `[disp16]`.
   */
  function rmOperand(mod: number, rm: number, size: 8 | 16): [Operand, number[]] {
    if (mod === 3) {
      const reg: Operand =
        size === 8 ? { kind: 'reg8', reg: rm as Reg8 } : { kind: 'reg16', reg: rm as Reg16 }
      return [reg, []]
    }
    if (mod === 0 && rm === 6) return [mem(size, { disp: 0x8001, dispSize: 16 }), [0x01, 0x80]]
    const ea = EA[rm]
    if (mod === 0) return [mem(size, ea), []]
    if (mod === 1) return [mem(size, { ...ea, disp: -100, dispSize: 8 }), [0x9c]]
    return [mem(size, { ...ea, disp: -32767, dispSize: 16 }), [0x01, 0x80]]
  }

  const FORMS = [
    [0x88, 8, 'r/m first'],
    [0x89, 16, 'r/m first'],
    [0x8a, 8, 'reg first'],
    [0x8b, 16, 'reg first'],
  ] as const

  for (const [opcode, size, order] of FORMS) {
    it(`decodes all 32 mod × rm forms of ${hex(opcode)} (${size}-bit, ${order})`, () => {
      // reg=101: ch or bp.
      const reg = size === 8 ? r8('ch') : r16('bp')
      for (const mod of range(0, 3)) {
        for (const rm of range(0, 7)) {
          const [rmOp, disp] = rmOperand(mod, rm, size)
          const bytes = [opcode, (mod << 6) | (5 << 3) | rm, ...disp]
          const operands = order === 'r/m first' ? [rmOp, reg] : [reg, rmOp]
          const { read, reads } = spy(bytes)
          expect([mod, rm, decode(read, 0)]).toEqual([mod, rm, ok(bytes.length, 'mov', operands)])
          expect([mod, rm, reads]).toEqual([mod, rm, range(0, bytes.length - 1)])
        }
      }
    })
  }

  it('reads [bp] as mod=01 with disp8 0, and mod=00 rm=110 as [disp16]', () => {
    expect(at([0x8b, 0x46, 0x00])).toEqual(
      ok(3, 'mov', [r16('ax'), mem(16, { base: 'bp', dispSize: 8 })]),
    )
    expect(at([0x8b, 0x06, 0x34, 0x12])).toEqual(
      ok(4, 'mov', [r16('ax'), mem(16, { disp: 0x1234, dispSize: 16 })]),
    )
  })

  it('sign-extends disp8 and based disp16 but keeps [disp16] unsigned', () => {
    const cases: [number[], Ea][] = [
      [[0x47, 0x7f], { base: 'bx', disp: 127, dispSize: 8 }],
      [[0x47, 0x80], { base: 'bx', disp: -128, dispSize: 8 }],
      [[0x87, 0xff, 0x7f], { base: 'bx', disp: 32767, dispSize: 16 }],
      [[0x87, 0x00, 0x80], { base: 'bx', disp: -32768, dispSize: 16 }],
      [[0x87, 0xfe, 0xff], { base: 'bx', disp: -2, dispSize: 16 }],
      [[0x06, 0xfe, 0xff], { disp: 0xfffe, dispSize: 16 }],
    ]
    for (const [tail, ea] of cases) {
      expect(at([0x8b, ...tail])).toEqual(ok(1 + tail.length, 'mov', [r16('ax'), mem(16, ea)]))
    }
  })

  it('gives LEA an r/m operand with no data size and no register form', () => {
    expect(at([0x8d, 0x00])).toEqual(
      ok(2, 'lea', [r16('ax'), mem(undefined, { base: 'bx', index: 'si' })]),
    )
    for (const m of range(0xc0, 0xff)) {
      const { read, reads } = spy([0x8d, m])
      expect([hex(m), decode(read, 0), reads]).toEqual([hex(m), undef(0x8d), [0, 1]])
    }
  })
})

describe('decode: prefixes (ISA §2.1, §3.4)', () => {
  /** String op → [mnemonic, F3 reading, F2 reading]; ISA §3.4 pairs F2 with CMPS/SCAS only. */
  const STRING = new Map<number, [Mnemonic, Prefix, Prefix | undefined]>([
    [0xa4, ['movsb', 'rep', undefined]],
    [0xa5, ['movsw', 'rep', undefined]],
    [0xa6, ['cmpsb', 'repe', 'repne']],
    [0xa7, ['cmpsw', 'repe', 'repne']],
    [0xaa, ['stosb', 'rep', undefined]],
    [0xab, ['stosw', 'rep', undefined]],
    [0xac, ['lodsb', 'rep', undefined]],
    [0xad, ['lodsw', 'rep', undefined]],
    [0xae, ['scasb', 'repe', 'repne']],
    [0xaf, ['scasw', 'repe', 'repne']],
  ])

  it('reads F3 as rep before MOVS/STOS/LODS and as repe before CMPS/SCAS', () => {
    for (const [op, [mnemonic, f3]] of STRING) {
      expect([hex(op), at([0xf3, op])]).toEqual([hex(op), ok(2, mnemonic, [], f3)])
    }
  })

  it('reads F2 as repne before CMPS/SCAS and nothing else', () => {
    for (const [op, [mnemonic, , f2]] of STRING) {
      const expected = f2 === undefined ? undef(0xf2) : ok(2, mnemonic, [], f2)
      expect([hex(op), at([0xf2, op])]).toEqual([hex(op), expected])
    }
  })

  it('makes a prefix before any other byte undefined, reading no further', () => {
    for (const prefix of [0xf2, 0xf3]) {
      for (const next of range(0, 255).filter((b) => !STRING.has(b))) {
        const { read, reads } = spy([prefix, next, 0xa4, 0xa4])
        expect([hex(prefix), hex(next), decode(read, 0), reads]).toEqual([
          hex(prefix),
          hex(next),
          undef(prefix),
          [0, 1],
        ])
      }
    }
  })

  it('allows one prefix: a second prefix is undefined', () => {
    for (const [a, b] of [
      [0xf3, 0xf3],
      [0xf3, 0xf2],
      [0xf2, 0xf3],
      [0xf2, 0xf2],
    ] as const) {
      expect(at([a, b, 0xa4])).toEqual(undef(a))
    }
  })
})

describe('decode: undefined encodings (ISA §3.7)', () => {
  /** The opcodes ISA §3.7 names, transcribed. */
  const LISTED = [
    ...[0x0f, 0x26, 0x2e, 0x36, 0x3e, 0x27, 0x2f, 0x37, 0x3f],
    ...range(0x63, 0x6f),
    ...[0x9a, 0x9b, 0xc4, 0xc5],
    ...range(0xc8, 0xcb),
    ...[0xcd, 0xce, 0xcf],
    ...range(0xd4, 0xd7),
    ...range(0xd8, 0xdf),
    ...range(0xe4, 0xe7),
    0xea,
    ...range(0xec, 0xef),
    ...[0xf0, 0xf1, 0xfa, 0xfb],
  ]

  it('kills on every opcode ISA §3.7 lists after reading one byte, whatever follows', () => {
    for (const op of LISTED) {
      for (const next of [0x00, 0x06, 0x46, 0x86, 0xc0, 0xff]) {
        const { read, reads } = spy([op, next, 0, 0, 0, 0])
        expect([hex(op), decode(read, 0), reads]).toEqual([hex(op), undef(op), [0]])
      }
    }
  })

  it('kills on FF /3 /5 /7 and F6/F7 /1 in every mod and rm', () => {
    const extensions = [
      [0xff, 3],
      [0xff, 5],
      [0xff, 7],
      [0xf6, 1],
      [0xf7, 1],
    ] as const
    for (const [op, n] of extensions) {
      for (const m of range(0, 255).filter((b) => ((b >> 3) & 7) === n)) {
        expect([hex(op), hex(m), at([op, m, 0, 0, 0, 0])]).toEqual([hex(op), hex(m), undef(op)])
      }
    }
  })
})

describe('decode: every two-byte start', () => {
  const MODRM = new Set<string>(['r/m8', 'r/m16', 'm', 'r8', 'r16'])

  /** What ISA §2 and TABLE say bytes `b0 b1` start, worked out row by row without the decoder. */
  function model(b0: number, b1: number): string {
    const prefixes = (Object.keys(PREFIX_BYTE) as Prefix[]).filter((p) => PREFIX_BYTE[p] === b0)
    if (prefixes.length > 0) {
      const row = TABLE.find(
        (r) => r.opcode === b1 && r.prefixes?.some((p) => prefixes.includes(p)),
      )
      const prefix = row?.prefixes?.find((p) => prefixes.includes(p))
      return row ? `${prefix} ${row.mnemonic} length 2` : 'undefined length 1'
    }
    const row = TABLE.find(
      (r) => r.opcode === b0 && (r.ext === undefined || r.ext === ((b1 >> 3) & 7)),
    )
    if (row === undefined) return 'undefined length 1'
    let length = 1 + row.immSize / 8
    if (row.ext !== undefined || row.operands.some((t) => MODRM.has(t))) {
      const mod = b1 >> 6
      if (mod === 3 && row.operands.includes('m')) return 'undefined length 1'
      const disp = mod === 1 ? 1 : mod === 2 || (mod === 0 && (b1 & 7) === 6) ? 2 : 0
      length += 1 + disp
    }
    return `${row.kills ? 'kill ' : ''}${row.mnemonic} length ${length}`
  }

  function summary(d: Decoded): string {
    if (d.ok) return `${d.instr.prefix ?? ''} ${d.instr.mnemonic} length ${d.length}`.trim()
    if (d.reason === 'undefined') return `undefined length ${d.length}`
    return `kill ${d.instr.mnemonic} length ${d.length}`
  }

  it('matches the table on mnemonic, prefix, length, and the bytes read', () => {
    const wrong: string[] = []
    for (const b0 of range(0, 255)) {
      for (const b1 of range(0, 255)) {
        const { read, reads } = spy([b0, b1, 0x12, 0x34, 0x56, 0x78])
        const d = decode(read, 0)
        // An instruction reads exactly its own bytes, in order; an undefined one at most two.
        const readsOk =
          d.ok || d.reason !== 'undefined'
            ? reads.join() === range(0, d.length - 1).join()
            : reads.length <= 2 && reads.every((a, i) => a === i)
        const want = model(b0, b1)
        const got = summary(d)
        if (got !== want || !readsOk) {
          wrong.push(`${hex(b0)} ${hex(b1)}: want ${want}, got ${got}, read ${reads.join()}`)
        }
      }
    }
    expect(wrong.slice(0, 20)).toEqual([])
  })
})

describe('decode: immediates, targets, and fixed registers', () => {
  it('sign-extends rel8 and rel16 and measures targets from the instruction start', () => {
    expect(at([0xeb, 0x7f])).toEqual(ok(2, 'jmp', [rel(0x81, 8)]))
    expect(at([0xeb, 0x80])).toEqual(ok(2, 'jmp', [rel(-126, 8)]))
    expect(at([0xe9, 0xff, 0x7f])).toEqual(ok(3, 'jmp', [rel(0x8002, 16)]))
    expect(at([0xe9, 0x00, 0x80])).toEqual(ok(3, 'jmp', [rel(-0x7ffd, 16)]))
    expect(at([0xe3, 0xfe])).toEqual(ok(2, 'jcxz', [rel(0, 8)]))
    expect(at([0x7c, 0x00])).toEqual(ok(2, 'jl', [rel(2, 8)]))
  })

  it('sign-extends imm8 for 83 /n only', () => {
    expect(at([0x83, 0xc3, 0xfc])).toEqual(ok(3, 'add', [r16('bx'), imm(-4, 8, true)]))
    expect(at([0x83, 0xfb, 0x7f])).toEqual(ok(3, 'cmp', [r16('bx'), imm(127, 8, true)]))
    expect(at([0x80, 0xc3, 0xfc])).toEqual(ok(3, 'add', [r8('bl'), imm(0xfc, 8)]))
    expect(at([0x04, 0xfc])).toEqual(ok(2, 'add', [r8('al'), imm(0xfc, 8)]))
    expect(at([0xb3, 0xfc])).toEqual(ok(2, 'mov', [r8('bl'), imm(0xfc, 8)]))
    expect(at([0xa8, 0xfc])).toEqual(ok(2, 'test', [r8('al'), imm(0xfc, 8)]))
    expect(at([0x81, 0xc3, 0xfc, 0xff])).toEqual(ok(4, 'add', [r16('bx'), imm(0xfffc, 16)]))
    expect(at([0x2d, 0xfc, 0xff])).toEqual(ok(3, 'sub', [r16('ax'), imm(0xfffc, 16)]))
    expect(at([0xc2, 0xfe, 0xff])).toEqual(ok(3, 'ret', [imm(0xfffe, 16)]))
  })

  it('decodes the moffs forms with the size of their register', () => {
    expect(at([0xa0, 0x34, 0x12])).toEqual(ok(3, 'mov', [r8('al'), moffs(0x1234, 8)]))
    expect(at([0xa2, 0xff, 0xff])).toEqual(ok(3, 'mov', [moffs(0xffff, 8), r8('al')]))
    expect(at([0xa3, 0x00, 0x01])).toEqual(ok(3, 'mov', [moffs(0x100, 16), r16('ax')]))
  })

  it('takes +r registers from the low three opcode bits', () => {
    for (const r of range(0, 7)) {
      const reg16: Operand = { kind: 'reg16', reg: r as Reg16 }
      const reg8: Operand = { kind: 'reg8', reg: r as Reg8 }
      expect(at([0x40 + r])).toEqual(ok(1, 'inc', [reg16]))
      expect(at([0x48 + r])).toEqual(ok(1, 'dec', [reg16]))
      expect(at([0x50 + r])).toEqual(ok(1, 'push', [reg16]))
      expect(at([0x58 + r])).toEqual(ok(1, 'pop', [reg16]))
      expect(at([0xb0 + r, 0x41])).toEqual(ok(2, 'mov', [reg8, imm(0x41, 8)]))
      expect(at([0xb8 + r, 0x41, 0x00])).toEqual(ok(3, 'mov', [reg16, imm(0x41, 16)]))
      const xchg = r === 0 ? ok(1, 'nop') : ok(1, 'xchg', [r16('ax'), reg16])
      expect(at([0x90 + r])).toEqual(xchg)
    }
  })
})

describe('decode: reading', () => {
  it('reads through a wrapping reader across 0xFFFF', () => {
    const core = new Uint8Array(0x10000)
    core.set([0xc7, 0x06], 0xfffe)
    core.set([0x00, 0x01, 0x34, 0x12], 0)
    const read: Reader = (a) => core[a & 0xffff] ?? 0
    expect(decode(read, 0xfffe)).toEqual(
      ok(6, 'mov', [mem(16, { disp: 0x100, dispSize: 16 }), imm(0x1234, 16)]),
    )
  })

  it('reads 6 bytes for the longest instructions and never a seventh', () => {
    const longest = [
      [0x81, 0x80, 0x34, 0x12, 0x78, 0x56],
      [0xc7, 0x06, 0x00, 0x01, 0x34, 0x12],
    ]
    for (const bytes of longest) {
      const { read, reads } = spy(bytes)
      expect(decode(read, 0).length).toBe(6)
      expect(reads).toEqual([0, 1, 2, 3, 4, 5])
    }
  })

  it('uses only the low 8 bits of each value read', () => {
    const read: Reader = (a) => [0x1b8, 0x234, 0xf12][a] ?? 0
    expect(decode(read, 0)).toEqual(ok(3, 'mov', [r16('ax'), imm(0x1234, 16)]))
  })
})

describe('decodeInto', () => {
  const reader = (bytes: readonly number[]) => spy(bytes).read

  it('agrees with decode on every two-byte start', () => {
    const CODE = {
      undefined: DECODE_UNDEFINED,
      dat: DECODE_DAT,
      hlt: DECODE_HLT,
      int3: DECODE_INT3,
    } as const
    const out = newOut()
    const wrong: string[] = []
    for (const b0 of range(0, 255)) {
      for (const b1 of range(0, 255)) {
        const bytes = [b0, b1, 0x9c, 0x80, 0x01, 0x80]
        const d = decode(reader(bytes), 0)
        const code = decodeInto(reader(bytes), 0, out)
        const want = d.ok ? d.length : CODE[d.reason]
        const instr = d.ok || d.reason !== 'undefined' ? d.instr : undefined
        if (code !== want || (instr !== undefined && instrText(out) !== instrText(instr))) {
          wrong.push(`${hex(b0)} ${hex(b1)}: got ${code} ${instrText(out)}, want ${want}`)
        }
      }
    }
    expect(wrong.slice(0, 20)).toEqual([])
  })

  it('returns a code below zero and fills out for DAT, HLT, and INT3', () => {
    const out = newOut()
    expect(decodeInto(reader([0x00, 0x41]), 0, out)).toBe(DECODE_DAT)
    expect(instrText(out)).toBe(' dat [imm 65 8 false] 2')
    expect(decodeInto(reader([0xf4]), 0, out)).toBe(DECODE_HLT)
    expect(instrText(out)).toBe(' hlt [] 1')
    expect(decodeInto(reader([0xcc]), 0, out)).toBe(DECODE_INT3)
    expect(instrText(out)).toBe(' int3 [] 1')
  })

  it('leaves out unchanged when the bytes are undefined', () => {
    const out = newOut()
    expect(decodeInto(reader([0xb8, 0x34, 0x12]), 0, out)).toBe(3)
    const before = instrText(out)
    for (const bytes of [[0x0f], [0xff, 0xff], [0xf3, 0x90], [0x8d, 0xc0], [0xd0, 0x30]]) {
      expect(decodeInto(reader(bytes), 0, out)).toBe(DECODE_UNDEFINED)
      expect(instrText(out)).toBe(before)
    }
  })

  it('writes every instruction into the same two operand objects', () => {
    const out = newOut()
    const operands = new Set<Operand>()
    const lists = new Set<Operand[]>()
    let seed = 1
    const core = Uint8Array.from({ length: 4096 }, () => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
      return seed >>> 24
    })
    const read: Reader = (a) => core[a & 0xfff] ?? 0
    let decoded = 0
    for (let a = 0; a < core.length; a++) {
      if (decodeInto(read, a, out) < 0) continue
      decoded++
      lists.add(out.operands)
      for (const op of out.operands) operands.add(op)
    }
    expect(decoded).toBeGreaterThan(2000)
    expect(operands.size).toBe(2)
    expect(lists.size).toBe(3)
  })

  it('keeps separate out objects separate', () => {
    const a = newOut()
    const b = newOut()
    decodeInto(reader([0xb8, 0x34, 0x12]), 0, a)
    decodeInto(reader([0x83, 0xc3, 0x04]), 0, b)
    expect(instrText(a)).toBe(' mov [reg16 0, imm 4660 16 false] 3')
    expect(instrText(b)).toBe(' add [reg16 3, imm 4 8 true] 3')
  })
})
