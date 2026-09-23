import { describe, expect, it } from 'bun:test'
import {
  ALIASES,
  MNEMONICS,
  type OpcodeRow,
  PREFIX_ALIASES,
  PREFIX_BYTE,
  REG8_NAMES,
  REG16_NAMES,
  Reg8,
  Reg16,
  TABLE,
} from '../src/index'

const hex = (b: number) => b.toString(16).toUpperCase().padStart(2, '0')
const key = (r: OpcodeRow) => (r.ext === undefined ? hex(r.opcode) : `${hex(r.opcode)} /${r.ext}`)
const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i)
const rowsAt = (opcode: number) => TABLE.filter((r) => r.opcode === opcode)
const rowAt = (opcode: number, ext?: number) =>
  TABLE.find((r) => r.opcode === opcode && r.ext === ext)
const resolve = (spelling: string) => ALIASES.get(spelling) ?? spelling
const canonical = new Set<string>(MNEMONICS)
const sorted = (xs: Iterable<number>) => [...new Set(xs)].sort((a, b) => a - b)

/** Every spelling in ISA §3.1..§3.6, transcribed from the spec independently of src/table.ts. */
const ISA_SPELLINGS: Record<string, string[]> = {
  '3.1': ['mov', 'lea', 'xchg', 'push', 'pop', 'pushf', 'popf', 'sahf', 'lahf', 'cbw', 'cwd'],
  '3.2': [
    ...['add', 'or', 'adc', 'sbb', 'and', 'sub', 'xor', 'cmp'],
    ...['test', 'not', 'neg', 'mul', 'imul', 'div', 'idiv', 'inc', 'dec'],
    ...['rol', 'ror', 'rcl', 'rcr', 'shl', 'sal', 'shr', 'sar'],
  ],
  '3.3': [
    ...['jmp', 'call', 'ret', 'jo', 'jno', 'jb', 'jc', 'jnae', 'jae', 'jnc', 'jnb', 'je', 'jz'],
    ...['jne', 'jnz', 'jbe', 'jna', 'ja', 'jnbe', 'js', 'jns', 'jp', 'jpe', 'jnp', 'jpo'],
    ...['jl', 'jnge', 'jge', 'jnl', 'jle', 'jng', 'jg', 'jnle'],
    ...['loopne', 'loopnz', 'loope', 'loopz', 'loop', 'jcxz'],
  ],
  '3.4': [
    ...['movsb', 'movsw', 'cmpsb', 'cmpsw', 'stosb', 'stosw', 'lodsb', 'lodsw', 'scasb', 'scasw'],
    ...['cld', 'std'],
  ],
  '3.5': ['clc', 'stc', 'cmc', 'nop'],
  '3.6': ['dat', 'spl', 'hlt', 'int3'],
}

/** Spellings ISA §3 lists for one instruction. */
const SYNONYMS = [
  ['jb', 'jc', 'jnae'],
  ['jae', 'jnc', 'jnb'],
  ['je', 'jz'],
  ['jne', 'jnz'],
  ['jbe', 'jna'],
  ['ja', 'jnbe'],
  ['jp', 'jpe'],
  ['jnp', 'jpo'],
  ['jl', 'jnge'],
  ['jge', 'jnl'],
  ['jle', 'jng'],
  ['jg', 'jnle'],
  ['loopne', 'loopnz'],
  ['loope', 'loopz'],
  ['shl', 'sal'],
]

/** Primary opcodes ISA §3.1..§3.6 define (0x00 and 0x90 included; F2/F3 are prefixes). */
const DEFINED = sorted([
  // §3.1
  ...[0x88, 0x89, 0x8a, 0x8b, 0x8d, 0xa0, 0xa1, 0xa2, 0xa3, 0xc6, 0xc7, 0x86, 0x87],
  ...range(0xb0, 0xbf),
  ...range(0x90, 0x97),
  ...range(0x50, 0x5f),
  ...[0xff, 0x8f, 0x9c, 0x9d, 0x9e, 0x9f, 0x98, 0x99],
  // §3.2
  ...range(0, 7).flatMap((n) => range(n << 3, (n << 3) + 5)),
  ...[0x80, 0x81, 0x83, 0x84, 0x85, 0xa8, 0xa9, 0xf6, 0xf7, 0xfe],
  ...range(0x40, 0x4f),
  ...range(0xd0, 0xd3),
  // §3.3
  ...[0xeb, 0xe9, 0xe8, 0xc3, 0xc2],
  ...range(0x70, 0x7f),
  ...range(0xe0, 0xe3),
  // §3.4
  ...range(0xa4, 0xa7),
  ...range(0xaa, 0xaf),
  ...[0xfc, 0xfd],
  // §3.5
  ...[0xf8, 0xf9, 0xf5],
  // §3.6
  ...[0x60, 0x61, 0x62, 0xf4, 0xcc],
])

const SHIFT_EXTS = [0, 1, 2, 3, 4, 5, 7]
const UNARY_EXTS = [0, 2, 3, 4, 5, 6, 7]

/** Group opcodes and the `/n` extensions ISA §3 defines for each. */
const GROUPS = new Map<number, number[]>([
  [0x80, range(0, 7)],
  [0x81, range(0, 7)],
  [0x83, range(0, 7)],
  [0x8f, [0]],
  [0xc6, [0]],
  [0xc7, [0]],
  [0x62, [0]],
  [0xd0, SHIFT_EXTS],
  [0xd1, SHIFT_EXTS],
  [0xd2, SHIFT_EXTS],
  [0xd3, SHIFT_EXTS],
  [0xf6, UNARY_EXTS],
  [0xf7, UNARY_EXTS],
  [0xfe, [0, 1]],
  [0xff, [0, 1, 2, 4, 6]],
])

/** Primary opcodes ISA §3.7 names as undefined. */
const UNDEFINED = [
  ...[0x0f, 0x26, 0x2e, 0x36, 0x3e, 0x27, 0x2f, 0x37, 0x3f],
  ...range(0x63, 0x6f),
  ...[0x9a, 0x9b, 0xc4, 0xc5],
  ...range(0xc8, 0xcb),
  ...[0xcd, 0xce, 0xcf],
  ...range(0xd4, 0xdf),
  ...range(0xe4, 0xe7),
  0xea,
  ...range(0xec, 0xef),
  ...[0xf0, 0xf1, 0xfa, 0xfb],
]

describe('TABLE', () => {
  it('has no duplicate (opcode, ext) pairs', () => {
    const seen = new Set<string>()
    const dupes: string[] = []
    for (const r of TABLE) {
      if (seen.has(key(r))) dupes.push(key(r))
      seen.add(key(r))
    }
    expect(dupes).toEqual([])
  })

  it('never mixes /n rows and a plain row on one opcode', () => {
    const mixed = sorted(TABLE.map((r) => r.opcode)).filter((op) => {
      const rows = rowsAt(op)
      return rows.length > 1 && rows.some((r) => r.ext === undefined)
    })
    expect(mixed.map(hex)).toEqual([])
  })

  it('defines exactly the primary opcodes of ISA §3.1..§3.6', () => {
    expect(sorted(TABLE.map((r) => r.opcode)).map(hex)).toEqual(DEFINED.map(hex))
  })

  it('defines exactly the ISA §3 extensions of each group opcode', () => {
    const groups = sorted(TABLE.filter((r) => r.ext !== undefined).map((r) => r.opcode))
    expect(groups.map(hex)).toEqual(sorted(GROUPS.keys()).map(hex))
    for (const [op, exts] of GROUPS) {
      const defined = rowsAt(op).map((r) => r.ext ?? -1)
      expect([hex(op), sorted(defined)]).toEqual([hex(op), exts])
    }
  })

  it('omits 0x0F, 0x26, 0xCD, and 0xE4', () => {
    for (const op of [0x0f, 0x26, 0xcd, 0xe4]) expect(rowsAt(op)).toEqual([])
  })

  it('omits every opcode and extension ISA §3.7 lists as undefined', () => {
    expect(UNDEFINED.filter((op) => rowsAt(op).length > 0).map(hex)).toEqual([])
    const extensions = [
      [0xff, 3],
      [0xff, 5],
      [0xff, 7],
      [0xf6, 1],
      [0xf7, 1],
    ] as const
    for (const [op, ext] of extensions) expect(rowAt(op, ext)).toBeUndefined()
  })

  it('treats F2 and F3 as prefixes, not opcodes', () => {
    expect(rowsAt(0xf2)).toEqual([])
    expect(rowsAt(0xf3)).toEqual([])
    expect(PREFIX_BYTE).toEqual({ rep: 0xf3, repe: 0xf3, repne: 0xf2 })
  })

  it('marks 0x00 as dat, 0x60..0x62 as spl, and 0x90 as nop', () => {
    expect(rowsAt(0x00).map((r) => r.mnemonic)).toEqual(['dat'])
    expect([0x60, 0x61, 0x62].flatMap((op) => rowsAt(op).map(key))).toEqual(['60', '61', '62 /0'])
    for (const op of [0x60, 0x61, 0x62]) expect(rowsAt(op)[0]?.mnemonic).toBe('spl')
    expect(rowsAt(0x90).map((r) => r.mnemonic)).toEqual(['nop'])
  })

  it('kills on exactly dat, hlt, and int3', () => {
    expect(TABLE.filter((r) => r.kills).map((r) => `${key(r)} ${r.mnemonic}`)).toEqual([
      '00 dat',
      'F4 hlt',
      'CC int3',
    ])
  })

  it('sign-extends exactly the ISA §2.3 contexts', () => {
    const expected = [
      ...range(0, 7).map((n) => `83 /${n}`),
      ...range(0x70, 0x7f).map(hex),
      ...['EB', 'E0', 'E1', 'E2', 'E3', '60'],
    ]
    const marked = TABLE.filter((r) => r.signExtend).map(key)
    expect(marked.sort()).toEqual(expected.sort())
  })

  it('sizes the trailing field from the operand template', () => {
    const size: Record<string, number> = {
      imm8: 8,
      rel8: 8,
      imm16: 16,
      rel16: 16,
      moffs8: 16,
      moffs16: 16,
    }
    for (const r of TABLE) {
      const trailing = r.operands.filter((t) => t in size)
      expect(trailing.length).toBeLessThanOrEqual(1)
      expect([key(r), r.immSize]).toEqual([key(r), trailing[0] ? (size[trailing[0]] ?? 0) : 0])
    }
  })

  it('leaves the ModR/M reg field to the extension on /n rows', () => {
    for (const r of TABLE.filter((row) => row.ext !== undefined)) {
      const rm = r.operands.filter((t) => t === 'r/m8' || t === 'r/m16' || t === 'm')
      const reg = r.operands.filter((t) => t === 'r8' || t === 'r16')
      expect([key(r), rm.length, reg.length]).toEqual([key(r), 1, 0])
    }
  })

  it('matches ISA §3 notation for every operand template kind', () => {
    const spots: Record<string, string> = {
      '88': 'mov r/m8, r8',
      '8B': 'mov r16, r/m16',
      '8D': 'lea r16, m',
      A0: 'mov AL, moffs8',
      A3: 'mov moffs16, AX',
      B3: 'mov +r8, imm8',
      BF: 'mov +r16, imm16',
      'C6 /0': 'mov r/m8, imm8',
      'C7 /0': 'mov r/m16, imm16',
      '86': 'xchg r/m8, r8',
      '93': 'xchg AX, +r16',
      '54': 'push +r16',
      'FF /6': 'push r/m16',
      '8F /0': 'pop r/m16',
      '02': 'add r8, r/m8',
      '08': 'or r/m8, r8',
      '19': 'sbb r/m16, r16',
      '2C': 'sub AL, imm8',
      '3D': 'cmp AX, imm16',
      '80 /7': 'cmp r/m8, imm8',
      '81 /5': 'sub r/m16, imm16',
      '83 /4': 'and r/m16, imm8',
      A8: 'test AL, imm8',
      'F7 /0': 'test r/m16, imm16',
      'F6 /6': 'div r/m8',
      'FE /1': 'dec r/m8',
      'D0 /7': 'sar r/m8, 1',
      'D3 /4': 'shl r/m16, CL',
      EB: 'jmp rel8',
      E9: 'jmp rel16',
      'FF /4': 'jmp r/m16',
      E8: 'call rel16',
      'FF /2': 'call r/m16',
      C2: 'ret imm16',
      C3: 'ret',
      E3: 'jcxz rel8',
      AE: 'scasb',
      '00': 'dat imm8',
      '60': 'spl rel8',
      '61': 'spl rel16',
      '62 /0': 'spl r/m16',
    }
    const byKey = new Map(TABLE.map((r) => [key(r), r]))
    for (const [k, text] of Object.entries(spots)) {
      const r = byKey.get(k)
      expect([k, r && `${r.mnemonic} ${r.operands.join(', ')}`.trim()]).toEqual([k, text])
    }
  })
})

describe('instruction families', () => {
  const mnemonicAt = (opcode: number, ext?: number) => rowAt(opcode, ext)?.mnemonic

  it('orders the ALU group by op index n (ISA §3.2)', () => {
    const ops = ['add', 'or', 'adc', 'sbb', 'and', 'sub', 'xor', 'cmp']
    for (const [n, m] of ops.entries()) {
      // (n<<3)+00..05, except 0x00 which is DAT.
      const plain = range(n << 3, (n << 3) + 5).filter((op) => op !== 0x00)
      expect(plain.map((op) => mnemonicAt(op))).toEqual(plain.map(() => m))
      expect([0x80, 0x81, 0x83].map((op) => mnemonicAt(op, n))).toEqual([m, m, m])
    }
  })

  it('assigns shift, unary, and FE/FF extensions per ISA §3.2 and §3.3', () => {
    const shifts = ['rol', 'ror', 'rcl', 'rcr', 'shl', 'shr', undefined, 'sar']
    for (const op of [0xd0, 0xd1, 0xd2, 0xd3]) {
      expect(range(0, 7).map((n) => mnemonicAt(op, n))).toEqual(shifts)
    }
    const unary = ['test', undefined, 'not', 'neg', 'mul', 'imul', 'div', 'idiv']
    for (const op of [0xf6, 0xf7]) expect(range(0, 7).map((n) => mnemonicAt(op, n))).toEqual(unary)
    expect(range(0, 7).map((n) => mnemonicAt(0xfe, n))).toEqual([
      'inc',
      'dec',
      ...Array(6).fill(undefined),
    ])
    expect(range(0, 7).map((n) => mnemonicAt(0xff, n))).toEqual([
      'inc',
      'dec',
      'call',
      undefined,
      'jmp',
      undefined,
      'push',
      undefined,
    ])
  })

  it('spells conditional jumps and loops like ndisasm', () => {
    const jcc = ['jo', 'jno', 'jc', 'jnc', 'jz', 'jnz', 'jna', 'ja']
    jcc.push('js', 'jns', 'jpe', 'jpo', 'jl', 'jnl', 'jng', 'jg')
    expect(range(0x70, 0x7f).map((op) => mnemonicAt(op))).toEqual(jcc)
    expect(range(0xe0, 0xe3).map((op) => mnemonicAt(op))).toEqual([
      'loopne',
      'loope',
      'loop',
      'jcxz',
    ])
  })

  it('expands +r forms to one row per register', () => {
    const families = [
      [0x40, 'inc', '+r16'],
      [0x48, 'dec', '+r16'],
      [0x50, 'push', '+r16'],
      [0x58, 'pop', '+r16'],
      [0x90, 'xchg', '+r16'],
      [0xb0, 'mov', '+r8'],
      [0xb8, 'mov', '+r16'],
    ] as const
    for (const [base, m, template] of families) {
      // 0x90 is NOP, so XCHG AX, r16 starts at 0x91.
      for (const op of range(base === 0x90 ? 0x91 : base, base + 7)) {
        const r = rowAt(op)
        expect([hex(op), r?.mnemonic, r?.operands.includes(template)]).toEqual([hex(op), m, true])
      }
    }
  })
})

describe('mnemonics and aliases', () => {
  it('covers every mnemonic in ISA §3 at least once', () => {
    for (const [section, spellings] of Object.entries(ISA_SPELLINGS)) {
      const missing = spellings.filter((s) => !canonical.has(resolve(s)))
      expect([section, missing]).toEqual([section, []])
    }
  })

  it('invents no mnemonic or alias beyond ISA §3', () => {
    const isa = new Set(Object.values(ISA_SPELLINGS).flat())
    expect(MNEMONICS.filter((m) => !isa.has(m))).toEqual([])
    expect([...ALIASES.keys()].filter((a) => !isa.has(a))).toEqual([])
  })

  it('resolves every ISA synonym group to one canonical mnemonic', () => {
    for (const group of SYNONYMS) {
      const resolved = [...new Set(group.map(resolve))]
      expect([group, resolved.length, canonical.has(resolved[0] ?? '')]).toEqual([group, 1, true])
    }
  })

  it('never lets an alias shadow a canonical mnemonic', () => {
    expect([...ALIASES.keys()].filter((a) => canonical.has(a))).toEqual([])
  })

  it('declares the same aliases on every row of a mnemonic', () => {
    const byMnemonic = new Map<string, string>()
    for (const r of TABLE) {
      const aliases = r.aliases.join(',')
      expect([r.mnemonic, aliases]).toEqual([r.mnemonic, byMnemonic.get(r.mnemonic) ?? aliases])
      byMnemonic.set(r.mnemonic, aliases)
    }
  })

  it('exports MNEMONICS sorted and unique', () => {
    expect([...MNEMONICS]).toEqual([...new Set(TABLE.map((r) => r.mnemonic))].sort())
  })

  it('accepts exactly the ISA §3.4 prefixes on string instructions', () => {
    const rep = ['rep']
    const repe = ['repe', 'repne']
    expect(
      Object.fromEntries(TABLE.filter((r) => r.prefixes).map((r) => [key(r), r.prefixes])),
    ).toEqual({
      A4: rep,
      A5: rep,
      A6: repe,
      A7: repe,
      AA: rep,
      AB: rep,
      AC: rep,
      AD: rep,
      AE: repe,
      AF: repe,
    })
    expect(Object.fromEntries(PREFIX_ALIASES)).toEqual({ repz: 'repe', repnz: 'repne' })
  })
})

describe('registers', () => {
  it('numbers registers in x86 order (ISA §1)', () => {
    expect(REG16_NAMES).toEqual(['ax', 'cx', 'dx', 'bx', 'sp', 'bp', 'si', 'di'])
    expect(REG8_NAMES).toEqual(['al', 'cl', 'dl', 'bl', 'ah', 'ch', 'dh', 'bh'])
    for (const [code, name] of REG16_NAMES.entries()) expect(Reg16[name]).toBe(code as Reg16)
    for (const [code, name] of REG8_NAMES.entries()) expect(Reg8[name]).toBe(code as Reg8)
  })
})
