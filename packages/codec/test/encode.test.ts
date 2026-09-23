import { describe, expect, it } from 'bun:test'
import {
  decode,
  EncodeError,
  encode,
  type Instr,
  type InstrInput,
  type MemInput,
  type MemOperand,
  type OpcodeRow,
  type Operand,
  type OperandInput,
  type OperandTemplate,
  type Prefix,
  type Reader,
  Reg8,
  Reg16,
  TABLE,
} from '../src/index'

const hex = (bytes: ArrayLike<number>) =>
  Array.from(bytes, (b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')
const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i)
const bytesOf = (text: string) => text.split(' ').map((h) => Number.parseInt(h, 16))
const reader =
  (bytes: ArrayLike<number>): Reader =>
  (addr) =>
    bytes[addr] ?? 0

const r16 = (name: keyof typeof Reg16): OperandInput => ({ kind: 'reg16', reg: Reg16[name] })
const r8 = (name: keyof typeof Reg8): OperandInput => ({ kind: 'reg8', reg: Reg8[name] })
const imm = (value: number, size?: 8 | 16): OperandInput => ({ kind: 'imm', value, size })
const rel = (target: number, size?: 8 | 16): OperandInput => ({ kind: 'rel', target, size })
const moffs = (addr: number, size?: 8 | 16): OperandInput => ({ kind: 'moffs', addr, size })
const mem = (ea: Partial<Omit<MemInput, 'kind'>> = {}): OperandInput => ({
  kind: 'mem',
  disp: 0,
  ...ea,
})
const ins = (mnemonic: string, ...operands: OperandInput[]): InstrInput => ({ mnemonic, operands })

/** The bytes in hex, or the error as `code@operand: message`. */
function show(r: Uint8Array | EncodeError): string {
  if (!(r instanceof EncodeError)) return hex(r)
  return `${r.code}${r.operand === undefined ? '' : `@${r.operand}`}: ${r.message}`
}

const enc = (mnemonic: string, operands: OperandInput[] = [], prefix?: string) =>
  show(encode({ mnemonic, operands, prefix }))

/** One line per operand with only the fields its kind defines. */
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

/** Everything about an instruction but its length. */
const shape = (i: Instr) => `${i.prefix ?? ''} ${i.mnemonic} [${i.operands.map(text).join(', ')}]`

/** The instruction `bytes` decode to, kills included. */
function decoded(bytes: ArrayLike<number>): Instr | undefined {
  const d = decode(reader(bytes), 0)
  return d.ok || d.reason !== 'undefined' ? d.instr : undefined
}

/** `xchg r16, ax` encodes as `90+r`, which decodes as `xchg ax, r16`. Anything else decodes as is. */
function expected(x: Instr): Instr {
  const [a, b] = x.operands
  const withAx = a?.kind === 'reg16' && a.reg !== 0 && b?.kind === 'reg16' && b.reg === 0
  return x.mnemonic === 'xchg' && withAx ? { ...x, operands: [b, a] } : x
}

/** ISA §8 as the assembler passes it: a size only where the source spells one. */
const ISA_VECTORS: readonly [string, string, InstrInput][] = [
  ['mov ax, 0x1234', 'B8 34 12', ins('mov', r16('ax'), imm(0x1234))],
  ['mov word [bx], 0', 'C7 07 00 00', ins('mov', mem({ base: 'bx', size: 16 }), imm(0))],
  [
    'mov byte [bx+si+4], 0x41',
    'C6 40 04 41',
    ins('mov', mem({ base: 'bx', index: 'si', disp: 4, size: 8 }), imm(0x41)),
  ],
  ['mov ax, [0x0100]', 'A1 00 01', ins('mov', r16('ax'), mem({ disp: 0x100 }))],
  ['mov cx, [bp]', '8B 4E 00', ins('mov', r16('cx'), mem({ base: 'bp' }))],
  ['add bx, 4', '83 C3 04', ins('add', r16('bx'), imm(4))],
  ['add bx, 0x100', '81 C3 00 01', ins('add', r16('bx'), imm(0x100))],
  ['cmp al, 0', '3C 00', ins('cmp', r8('al'), imm(0))],
  ['xor ax, ax', '31 C0', ins('xor', r16('ax'), r16('ax'))],
  ['inc bx', '43', ins('inc', r16('bx'))],
  ['dec word [di]', 'FF 0D', ins('dec', mem({ index: 'di', size: 16 }))],
  ['shl ax, 1', 'D1 E0', ins('shl', r16('ax'), imm(1))],
  ['shr ax, cl', 'D3 E8', ins('shr', r16('ax'), r8('cl'))],
  ['jmp short $', 'EB FE', ins('jmp', rel(0, 8))],
  ['jmp $ + 0x200', 'E9 FD 01', ins('jmp', rel(0x200))],
  ['jnz $ - 10', '75 F4', ins('jnz', rel(-10))],
  ['loop $ - 4', 'E2 FA', ins('loop', rel(-4))],
  ['call $ + 3', 'E8 00 00', ins('call', rel(3))],
  ['pop bx', '5B', ins('pop', r16('bx'))],
  ['push word [bx]', 'FF 37', ins('push', mem({ base: 'bx', size: 16 }))],
  ['rep movsw', 'F3 A5', { ...ins('movsw'), prefix: 'rep' }],
  ['repne scasb', 'F2 AE', { ...ins('scasb'), prefix: 'repne' }],
  ['spl $ + 2', '60 00', ins('spl', rel(2))],
  ['spl $ + 0x300', '61 FD 02', ins('spl', rel(0x300))],
  // ISA §8 prints `62 03`, which ISA §2.2 reads as `spl [bp+di]` (see decode.test.ts).
  ['spl bx', '62 C3', ins('spl', r16('bx'))],
  ['dat', '00 00', ins('dat')],
  ['hlt', 'F4', ins('hlt')],
  ['int3', 'CC', ins('int3')],
  ['nop', '90', ins('nop')],
  [
    'lea si, [bx+di-2]',
    '8D 71 FE',
    ins('lea', r16('si'), mem({ base: 'bx', index: 'di', disp: -2 })),
  ],
]

describe('encode: ISA §8 vectors', () => {
  for (const [source, bytes, input] of ISA_VECTORS) {
    it(`encodes ${source} as ${bytes}`, () => {
      expect(show(encode(input))).toBe(bytes)
    })
  }

  it('re-encodes the decoding of every vector to the same bytes', () => {
    for (const [source, bytes] of ISA_VECTORS) {
      const instr = decoded(bytesOf(bytes))
      expect([source, instr && show(encode(instr))]).toEqual([source, bytes])
    }
  })

  it('returns an EncodeError instead of throwing', () => {
    const r = encode(ins('mov', mem({ base: 'bx' }), imm(0)))
    expect(r).toBeInstanceOf(EncodeError)
    expect(r).toMatchObject({ code: 'size-not-specified', operand: 0 })
  })
})

describe('encode: shortest form', () => {
  it('uses the AL and AX forms of ALU and TEST immediates', () => {
    expect(enc('add', [r8('al'), imm(5)])).toBe('04 05')
    expect(enc('cmp', [r16('ax'), imm(0x1234)])).toBe('3D 34 12')
    expect(enc('test', [r8('al'), imm(0x80)])).toBe('A8 80')
    expect(enc('test', [r16('ax'), imm(5)])).toBe('A9 05 00')
    expect(enc('test', [r8('bl'), imm(5)])).toBe('F6 C3 05')
  })

  it('uses 83 /n when a 16-bit value fits a sign-extended byte', () => {
    expect(enc('add', [r16('bx'), imm(127)])).toBe('83 C3 7F')
    expect(enc('add', [r16('bx'), imm(-128)])).toBe('83 C3 80')
    expect(enc('add', [r16('bx'), imm(0xfffc)])).toBe('83 C3 FC')
    expect(enc('add', [r16('bx'), imm(128)])).toBe('81 C3 80 00')
    expect(enc('sub', [mem({ base: 'bx', size: 16 }), imm(-1)])).toBe('83 2F FF')
    expect(enc('and', [r16('ax'), imm(0xfff0)])).toBe('83 E0 F0')
    // Ties with `05 05 00`. NASM takes the smaller immediate, and so does encode.
    expect(enc('add', [r16('ax'), imm(5)])).toBe('83 C0 05')
    expect(enc('add', [r16('ax'), imm(0x80)])).toBe('05 80 00')
  })

  it('uses +r opcodes for inc, dec, push, pop, and mov r, imm', () => {
    expect(enc('inc', [r16('bx')])).toBe('43')
    expect(enc('dec', [r16('si')])).toBe('4E')
    expect(enc('push', [r16('bp')])).toBe('55')
    expect(enc('pop', [r16('di')])).toBe('5F')
    expect(enc('mov', [r16('dx'), imm(0x1234)])).toBe('BA 34 12')
    expect(enc('mov', [r8('ah'), imm(0xff)])).toBe('B4 FF')
    // 8-bit INC has no +r form.
    expect(enc('inc', [r8('bl')])).toBe('FE C3')
  })

  it('uses A0..A3 for AL or AX with a bare address', () => {
    expect(enc('mov', [r8('al'), mem({ disp: 0x1234 })])).toBe('A0 34 12')
    expect(enc('mov', [r16('ax'), mem({ disp: 0x1234 })])).toBe('A1 34 12')
    expect(enc('mov', [mem({ disp: 0xffff }), r8('al')])).toBe('A2 FF FF')
    expect(enc('mov', [mem({ disp: -2 }), r16('ax')])).toBe('A3 FE FF')
    expect(enc('mov', [r16('bx'), mem({ disp: 0x1234 })])).toBe('8B 1E 34 12')
    expect(enc('mov', [r16('ax'), mem({ base: 'bx', disp: 0x1234 })])).toBe('8B 87 34 12')
    expect(enc('add', [r16('ax'), mem({ disp: 0x1234 })])).toBe('03 06 34 12')
  })

  it('uses 90+r for xchg with AX in either order, but not 90, which is nop', () => {
    expect(enc('xchg', [r16('ax'), r16('bx')])).toBe('93')
    expect(enc('xchg', [r16('bx'), r16('ax')])).toBe('93')
    expect(enc('xchg', [r16('cx'), r16('ax')])).toBe('91')
    expect(enc('xchg', [r16('ax'), r16('di')])).toBe('97')
    // NASM emits 90, which decodes as nop.
    expect(enc('xchg', [r16('ax'), r16('ax')])).toBe('87 C0')
  })

  it('uses rel8 before rel16 for jmp and spl', () => {
    expect(enc('jmp', [rel(129)])).toBe('EB 7F')
    expect(enc('jmp', [rel(-126)])).toBe('EB 80')
    expect(enc('jmp', [rel(130)])).toBe('E9 7F 00')
    expect(enc('jmp', [rel(-127)])).toBe('E9 7E FF')
    expect(enc('spl', [rel(129)])).toBe('60 7F')
    expect(enc('spl', [rel(130)])).toBe('61 7F 00')
  })

  it('puts two registers in the r/m-first row, as NASM does, except byte add', () => {
    expect(enc('mov', [r16('bx'), r16('ax')])).toBe('89 C3')
    expect(enc('mov', [r8('al'), r8('bl')])).toBe('88 D8')
    expect(enc('or', [r8('al'), r8('bl')])).toBe('08 D8')
    expect(enc('sub', [r16('cx'), r16('dx')])).toBe('29 D1')
    expect(enc('add', [r16('ax'), r16('bx')])).toBe('01 D8')
    // 00 D8 is DAT (ISA §9.1).
    expect(enc('add', [r8('al'), r8('bl')])).toBe('02 C3')
  })

  it('keeps commutative operands in the order given when both orders fit', () => {
    expect(enc('test', [r8('al'), r8('bl')])).toBe('84 D8')
    expect(enc('test', [r8('bl'), r8('al')])).toBe('84 C3')
    // NASM emits 87 D9, which decodes as xchg cx, bx.
    expect(enc('xchg', [r16('bx'), r16('cx')])).toBe('87 CB')
    expect(enc('xchg', [r8('al'), r8('bl')])).toBe('86 D8')
  })

  it('takes the shortest displacement, with [bp] as disp8 0 (ISA §2.2)', () => {
    const ax = (ea: Partial<Omit<MemInput, 'kind'>>) => enc('mov', [r16('ax'), mem(ea)])
    expect(ax({ base: 'bx' })).toBe('8B 07')
    expect(ax({ base: 'bp' })).toBe('8B 46 00')
    expect(ax({ base: 'bp', index: 'si' })).toBe('8B 02')
    expect(ax({ base: 'bx', disp: 127 })).toBe('8B 47 7F')
    expect(ax({ base: 'bx', disp: -128 })).toBe('8B 47 80')
    expect(ax({ base: 'bx', disp: 128 })).toBe('8B 87 80 00')
    expect(ax({ base: 'bx', disp: 0x8000 })).toBe('8B 87 00 80')
    // Addresses wrap, so 0xFFFE is -2.
    expect(ax({ base: 'bx', disp: 0xfffe })).toBe('8B 47 FE')
    expect(ax({ index: 'di', disp: -1 })).toBe('8B 45 FF')
  })
})

describe('encode: sizes the input gives are kept', () => {
  it('keeps the width of the immediate field', () => {
    expect(enc('add', [r16('bx'), imm(5, 16)])).toBe('81 C3 05 00')
    expect(enc('add', [r16('ax'), imm(5, 16)])).toBe('05 05 00')
    expect(enc('add', [r16('ax'), imm(5, 8)])).toBe('83 C0 05')
    expect(enc('add', [r16('bx'), imm(-1, 8)])).toBe('83 C3 FF')
    expect(enc('add', [r8('bl'), imm(5, 8)])).toBe('80 C3 05')
    expect(enc('add', [r16('bx'), imm(0x80, 8)])).toBe(
      'out-of-range@1: immediate 128 does not fit in a sign-extended byte',
    )
  })

  it('keeps the jump size', () => {
    expect(enc('jmp', [rel(2, 16)])).toBe('E9 FF FF')
    expect(enc('spl', [rel(3, 16)])).toBe('61 00 00')
    expect(enc('jmp', [rel(0x200, 8)])).toBe('jump-out-of-range@0: jump out of range')
  })

  it('keeps the displacement size, and a bare [disp16] with one stays ModR/M', () => {
    expect(enc('mov', [r16('ax'), mem({ base: 'bx', dispSize: 8 })])).toBe('8B 47 00')
    expect(enc('mov', [r16('ax'), mem({ base: 'bx', disp: -2, dispSize: 16 })])).toBe('8B 87 FE FF')
    expect(enc('mov', [r16('ax'), mem({ index: 'si', dispSize: 16 })])).toBe('8B 84 00 00')
    expect(enc('mov', [r16('ax'), mem({ disp: 0x100, dispSize: 16 })])).toBe('8B 06 00 01')
  })

  it('encodes a moffs operand only as A0..A3', () => {
    expect(enc('mov', [r16('ax'), moffs(0x100)])).toBe('A1 00 01')
    expect(enc('mov', [moffs(0x100, 8), r8('al')])).toBe('A2 00 01')
    expect(enc('mov', [r16('ax'), moffs(0x100, 8)])).toBe(
      'size-mismatch: operand sizes do not match',
    )
    expect(enc('mov', [r16('bx'), moffs(0x100)])).toBe(
      'invalid-operands: invalid combination of opcode and operands',
    )
  })
})

describe('encode: operation size (ISA §6.3)', () => {
  it('takes the size of memory from the other operand', () => {
    expect(enc('mov', [mem({ base: 'bx' }), r16('ax')])).toBe('89 07')
    expect(enc('mov', [mem({ base: 'bx' }), r8('al')])).toBe('88 07')
    expect(enc('mov', [r8('al'), mem({ base: 'bx' })])).toBe('8A 07')
    expect(enc('xchg', [mem({ base: 'bx' }), r16('ax')])).toBe('87 07')
    expect(enc('xchg', [r16('ax'), mem({ base: 'bx' })])).toBe('87 07')
    expect(enc('test', [mem({ base: 'bx' }), r8('al')])).toBe('84 07')
    expect(enc('test', [r8('al'), mem({ base: 'bx' })])).toBe('84 07')
    expect(enc('lea', [r16('ax'), mem({ base: 'bx' })])).toBe('8D 07')
  })

  it('needs a size when both byte and word forms fit', () => {
    const needs = 'size-not-specified@0: operation size not specified'
    const bx = mem({ base: 'bx' })
    expect(enc('mov', [bx, imm(0)])).toBe(needs)
    expect(enc('mov', [bx, imm(0x1234)])).toBe(needs)
    expect(enc('mov', [mem({ disp: 0x100 }), imm(5)])).toBe(needs)
    expect(enc('inc', [bx])).toBe(needs)
    expect(enc('neg', [mem({ index: 'si' })])).toBe(needs)
    expect(enc('shl', [bx, imm(1)])).toBe(needs)
    expect(enc('shl', [bx, r8('cl')])).toBe(needs)
    expect(enc('test', [bx, imm(5)])).toBe(needs)
    expect(enc('add', [bx, imm(5)])).toBe(needs)
    // A byte immediate fits both 80 /0 and 83 /0, so it does not give the size.
    expect(enc('add', [bx, imm(5, 8)])).toBe(needs)
  })

  it('encodes the same operands once a size is given', () => {
    expect(enc('inc', [mem({ base: 'bx', size: 16 })])).toBe('FF 07')
    expect(enc('shl', [mem({ base: 'bx', size: 8 }), r8('cl')])).toBe('D2 27')
    expect(enc('add', [mem({ base: 'bx', size: 8 }), imm(5)])).toBe('80 07 05')
    expect(enc('add', [mem({ base: 'bx', size: 16 }), imm(5)])).toBe('83 07 05')
  })

  it('needs no size when one form fits', () => {
    const bx = mem({ base: 'bx' })
    expect(enc('push', [bx])).toBe('FF 37')
    expect(enc('pop', [bx])).toBe('8F 07')
    expect(enc('jmp', [bx])).toBe('FF 27')
    expect(enc('call', [bx])).toBe('FF 17')
    expect(enc('spl', [bx])).toBe('62 07')
    // Only C7 /0 has a word immediate.
    expect(enc('mov', [bx, imm(5, 16)])).toBe('C7 07 05 00')
  })

  it('rejects sizes that do not match', () => {
    const mismatch = 'size-mismatch: operand sizes do not match'
    expect(enc('mov', [r16('ax'), r8('bl')])).toBe(mismatch)
    expect(enc('mov', [r16('ax'), mem({ base: 'bx', size: 8 })])).toBe(mismatch)
    expect(enc('mov', [r8('al'), imm(5, 16)])).toBe(mismatch)
    expect(enc('mov', [r16('bx'), imm(5, 8)])).toBe(mismatch)
    expect(enc('add', [mem({ base: 'bx', size: 16 }), r8('al')])).toBe(mismatch)
    expect(enc('push', [r8('al')])).toBe('size-mismatch@0: invalid operand size')
    expect(enc('jmp', [mem({ base: 'bx', size: 8 })])).toBe('size-mismatch@0: invalid operand size')
    expect(enc('jz', [rel(10, 16)])).toBe('size-mismatch@0: jz has no near form')
    expect(enc('loop', [rel(10, 16)])).toBe('size-mismatch@0: loop has no near form')
    expect(enc('call', [rel(10, 8)])).toBe('size-mismatch@0: call has no short form')
  })
})

describe('encode: DAT', () => {
  it('encodes dat as 00 00 and dat imm8 as 00 ib (ISA §3.6)', () => {
    expect(enc('dat')).toBe('00 00')
    expect(enc('dat', [imm(0x41)])).toBe('00 41')
    expect(enc('dat', [imm(-1)])).toBe('00 FF')
    expect(enc('dat', [imm(256)])).toBe('out-of-range@0: immediate 256 does not fit in a byte')
    expect(enc('dat', [imm(5, 16)])).toBe('size-mismatch@0: invalid operand size')
    expect(enc('dat', [imm(1), imm(2)])).toBe('invalid-operands: dat does not take 2 operands')
  })

  it('rejects add <mem8>, r8, which would be opcode 0x00 (ISA §9.1)', () => {
    const dat =
      'dat-form@0: this form encodes as 0x00 (DAT) and is unavailable; use `add <mem8>, imm8` or a word operation'
    expect(enc('add', [mem({ base: 'bx' }), r8('al')])).toBe(dat)
    expect(enc('add', [mem({ base: 'bx', index: 'si', disp: 4, size: 8 }), r8('cl')])).toBe(dat)
    expect(enc('add', [mem({ disp: 0x100 }), r8('ah')])).toBe(dat)
    // Every other form of ADD, and the same form of every other op, is available.
    expect(enc('add', [r8('al'), r8('bl')])).toBe('02 C3')
    expect(enc('add', [r8('al'), mem({ base: 'bx' })])).toBe('02 07')
    expect(enc('add', [mem({ base: 'bx' }), r16('ax')])).toBe('01 07')
    expect(enc('add', [mem({ base: 'bx', size: 8 }), imm(5)])).toBe('80 07 05')
    expect(enc('adc', [mem({ base: 'bx' }), r8('al')])).toBe('10 07')
  })
})

describe('encode: jumps', () => {
  it('reports a conditional jump beyond rel8 as out of range (ISA §3.3)', () => {
    const far = 'jump-out-of-range@0: jump out of range'
    expect(enc('jz', [rel(129)])).toBe('74 7F')
    expect(enc('jz', [rel(-126)])).toBe('74 80')
    expect(enc('jz', [rel(130)])).toBe(far)
    expect(enc('jz', [rel(-127)])).toBe(far)
    expect(enc('jcxz', [rel(2)])).toBe('E3 00')
    expect(enc('loopne', [rel(-126)])).toBe('E0 80')
    expect(enc('loop', [rel(0x200)])).toBe(far)
    expect(enc('jmp', [rel(130, 8)])).toBe(far)
    expect(enc('spl', [rel(130, 8)])).toBe(far)
  })

  it('wraps displacements, as addresses wrap', () => {
    // 0xFFFE bytes ahead is 2 bytes back.
    expect(enc('jz', [rel(0xfffe)])).toBe('74 FC')
    expect(enc('jmp', [rel(-0x10000 + 5)])).toBe('EB 03')
    expect(enc('call', [rel(0xffff)])).toBe('E8 FC FF')
  })
})

describe('encode: spellings', () => {
  it('reads aliases and any case', () => {
    expect(enc('JE', [rel(2)])).toBe('74 00')
    expect(enc('jnae', [rel(2)])).toBe('72 00')
    expect(enc('loopz', [rel(2)])).toBe('E1 00')
    expect(enc('sal', [r16('ax'), imm(1)])).toBe('D1 E0')
    expect(enc('MOV', [r16('ax'), r16('bx')])).toBe('89 D8')
  })

  it('rejects mnemonics the table does not define (ISA §3.7)', () => {
    expect(enc('int', [imm(3)])).toBe('unknown-mnemonic: unknown mnemonic `int`')
    expect(enc('pusha')).toBe('unknown-mnemonic: unknown mnemonic `pusha`')
    expect(enc('constructor')).toBe('unknown-mnemonic: unknown mnemonic `constructor`')
  })

  it('takes a prefix byte a string instruction accepts, in any spelling (ISA §3.4)', () => {
    expect(enc('movsb', [], 'rep')).toBe('F3 A4')
    expect(enc('lodsw', [], 'REP')).toBe('F3 AD')
    expect(enc('cmpsw', [], 'repz')).toBe('F3 A7')
    expect(enc('scasw', [], 'repnz')).toBe('F2 AF')
    expect(enc('cmpsb', [], 'repne')).toBe('F2 A6')
    // The same byte as the canonical spelling, as in NASM.
    expect(enc('cmpsb', [], 'rep')).toBe('F3 A6')
    expect(enc('stosb', [], 'repe')).toBe('F3 AA')
  })

  it('rejects prefixes the instruction does not take', () => {
    // F2 A4 is undefined: ISA §3.4 pairs F2 with CMPS and SCAS only.
    expect(enc('movsb', [], 'repne')).toBe('invalid-prefix: movsb takes rep, not repne')
    expect(enc('stosw', [], 'repnz')).toBe('invalid-prefix: stosw takes rep, not repnz')
    expect(enc('mov', [r16('ax'), r16('bx')], 'rep')).toBe(
      'invalid-prefix: `rep` needs a string instruction',
    )
    expect(enc('movsb', [], 'lock')).toBe('invalid-prefix: unknown prefix `lock`')
    expect(enc('movsb', [r16('ax')], 'rep')).toBe('invalid-operands: movsb does not take 1 operand')
  })
})

describe('encode: operand values', () => {
  it('takes a byte immediate in -256..255, read as 16-bit signed', () => {
    expect(enc('mov', [r8('al'), imm(255)])).toBe('B0 FF')
    expect(enc('mov', [r8('al'), imm(-128)])).toBe('B0 80')
    // `~0x80`, before and after the assembler wraps it to 16 bits.
    expect(enc('mov', [r8('al'), imm(-129)])).toBe('B0 7F')
    expect(enc('mov', [r8('al'), imm(0xff7f)])).toBe('B0 7F')
    expect(enc('mov', [r8('al'), imm(-256)])).toBe('B0 00')
    expect(enc('mov', [r8('al'), imm(256)])).toBe(
      'out-of-range@1: immediate 256 does not fit in a byte',
    )
    expect(enc('mov', [r8('al'), imm(-257)])).toBe(
      'out-of-range@1: immediate -257 does not fit in a byte',
    )
  })

  it('takes integers in -0x10000..0xFFFF and keeps their low 16 bits', () => {
    expect(enc('mov', [r16('ax'), imm(0xffff)])).toBe('B8 FF FF')
    expect(enc('mov', [r16('ax'), imm(-1)])).toBe('B8 FF FF')
    expect(enc('mov', [r16('ax'), imm(-0x10000)])).toBe('B8 00 00')
    expect(enc('ret', [imm(4)])).toBe('C2 04 00')
    expect(enc('mov', [r16('ax'), imm(0x10000)])).toBe(
      'out-of-range@1: immediate 65536 is out of range',
    )
    expect(enc('mov', [r16('ax'), imm(1.5)])).toBe(
      'out-of-range@1: immediate 1.5 is not an integer',
    )
    expect(enc('mov', [r16('ax'), imm(Number.NaN)])).toBe(
      'out-of-range@1: immediate NaN is not an integer',
    )
    expect(enc('mov', [r16('ax'), mem({ base: 'bx', disp: 0x10000 })])).toBe(
      'out-of-range@1: displacement 65536 is out of range',
    )
    expect(enc('jmp', [rel(0x10000)])).toBe('out-of-range@0: jump target 65536 is out of range')
    expect(enc('mov', [r8('al'), moffs(-0x10001)])).toBe(
      'out-of-range@1: address -65537 is out of range',
    )
  })

  it('rejects effective addresses ISA §2.2 cannot encode', () => {
    expect(enc('mov', [r16('ax'), mem({ base: 'bp', dispSize: 0 })])).toBe(
      'invalid-address@1: [bp] needs a displacement',
    )
    expect(enc('mov', [mem({ base: 'bp', dispSize: 0 }), r16('ax')])).toBe(
      'invalid-address@0: [bp] needs a displacement',
    )
    // Operand 1, though the commutative match puts it first.
    expect(enc('test', [r8('al'), mem({ base: 'bp', dispSize: 0 })])).toBe(
      'invalid-address@1: [bp] needs a displacement',
    )
    expect(enc('mov', [r16('ax'), mem({ base: 'bx', disp: 4, dispSize: 0 })])).toBe(
      'invalid-address@1: a nonzero displacement needs a field',
    )
    expect(enc('mov', [r16('ax'), mem({ disp: 0x100, dispSize: 8 })])).toBe(
      'invalid-address@1: a bare address needs a 16-bit displacement',
    )
    expect(enc('mov', [r16('ax'), mem({ base: 'bx', disp: 200, dispSize: 8 })])).toBe(
      'out-of-range@1: displacement 200 does not fit in a byte',
    )
    const si = { kind: 'mem', base: 'si', disp: 0 } as unknown as OperandInput
    expect(enc('mov', [r16('ax'), si])).toBe('invalid-address@1: invalid effective address')
  })

  it('rejects operands no row takes', () => {
    const invalid = 'invalid-operands: invalid combination of opcode and operands'
    expect(enc('mov', [mem({ base: 'bx' }), mem({ index: 'si' })])).toBe(invalid)
    expect(enc('lea', [r16('ax'), r16('bx')])).toBe(invalid)
    expect(enc('shl', [r16('ax'), imm(2)])).toBe(invalid)
    expect(enc('test', [imm(5), r16('ax')])).toBe(invalid)
    expect(enc('jmp', [imm(5)])).toBe(invalid)
    expect(enc('nop', [r16('ax')])).toBe('invalid-operands: nop does not take 1 operand')
    expect(enc('mov', [r16('ax')])).toBe('invalid-operands: mov does not take 1 operand')
    expect(enc('mov')).toBe('invalid-operands: mov needs operands')
    expect(enc('ret', [imm(1), imm(2)])).toBe('invalid-operands: ret does not take 2 operands')
  })
})

/** ISA §2.2 `rm` → base and index, transcribed from the spec. */
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

const MODRM = new Set<OperandTemplate>(['r/m8', 'r/m16', 'm', 'r8', 'r16'])
const RM = new Set<OperandTemplate>(['r/m8', 'r/m16', 'm'])

type Draw = (lo: number, hi: number) => number

/** A deterministic stream of integers in lo..hi. */
function lcg(seed: number): Draw {
  let s = seed >>> 0
  return (lo, hi) => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0
    return lo + ((s >>> 8) % (hi - lo + 1))
  }
}

/**
 * Form `k` of an r/m operand for template `t`: registers 0..7, then mod 00, 01, 10 × rm
 * 000..111 (ISA §2.2). `m` has no register forms.
 */
function rmForm(t: OperandTemplate | undefined, k: number, pick: Draw): Operand {
  const size = t === 'r/m8' ? 8 : t === 'r/m16' ? 16 : undefined
  const form = size === undefined ? 8 + (k % 24) : k % 32
  if (form < 8) {
    return size === 8 ? { kind: 'reg8', reg: form as Reg8 } : { kind: 'reg16', reg: form as Reg16 }
  }
  const [mod, rm] = [(form - 8) >> 3, (form - 8) & 7]
  const at = (ea: Pick<MemOperand, 'base' | 'index'>, disp: number, dispSize: 0 | 8 | 16) =>
    ({ kind: 'mem', base: ea.base, index: ea.index, disp, dispSize, size }) as Operand
  if (mod === 0 && rm === 6) return at({}, pick(0, 0xffff), 16)
  const ea = EA[rm] ?? {}
  if (mod === 0) return at(ea, 0, 0)
  if (mod === 1) return at(ea, pick(-128, 127), 8)
  return at(ea, pick(-32768, 32767), 16)
}

/** An operand for a template other than r/m; `length` is the instruction's. */
function fieldFor(t: OperandTemplate, row: OpcodeRow, length: number, pick: Draw): Operand {
  switch (t) {
    case 'r8':
      return { kind: 'reg8', reg: pick(0, 7) as Reg8 }
    case 'r16':
      return { kind: 'reg16', reg: pick(0, 7) as Reg16 }
    case '+r8':
      return { kind: 'reg8', reg: (row.opcode & 7) as Reg8 }
    case '+r16':
      return { kind: 'reg16', reg: (row.opcode & 7) as Reg16 }
    case 'AL':
      return { kind: 'reg8', reg: Reg8.al }
    case 'AX':
      return { kind: 'reg16', reg: Reg16.ax }
    case 'CL':
      return { kind: 'reg8', reg: Reg8.cl }
    case '1':
      return { kind: 'imm', value: 1, size: 8, signed: false }
    case 'imm8':
      return row.signExtend
        ? { kind: 'imm', value: pick(-128, 127), size: 8, signed: true }
        : { kind: 'imm', value: pick(0, 255), size: 8, signed: false }
    case 'imm16':
      return { kind: 'imm', value: pick(0, 0xffff), size: 16, signed: false }
    case 'moffs8':
      return { kind: 'moffs', addr: pick(0, 0xffff), size: 8 }
    case 'moffs16':
      return { kind: 'moffs', addr: pick(0, 0xffff), size: 16 }
    // `cb`/`cw` count from the next instruction; targets count from this one.
    case 'rel8':
      return { kind: 'rel', target: pick(-128, 127) + length, size: 8 }
    case 'rel16':
      return { kind: 'rel', target: pick(-32768, 32767) + length, size: 16 }
    default:
      throw new Error(`no sample for ${t}`)
  }
}

/**
 * 96 instructions for `row`, built from its templates without the codec: each r/m form three
 * times, fields at their minimum, maximum, and a random value in turn, every prefix the row
 * takes, and the ISA §2.1 length.
 */
function samples(row: OpcodeRow, rand: Draw): Instr[] {
  const rmAt = row.operands.findIndex((t) => RM.has(t))
  const modrm = row.ext !== undefined || row.operands.some((t) => MODRM.has(t))
  const prefixes: (Prefix | undefined)[] = [undefined, ...(row.prefixes ?? [])]
  const out: Instr[] = []
  for (let i = 0; i < 96; i++) {
    const pick: Draw = (lo, hi) => [lo, hi][i % 3] ?? rand(lo, hi)
    const prefix = prefixes[i % prefixes.length]
    const rm = rmAt < 0 ? undefined : rmForm(row.operands[rmAt], i, pick)
    const disp = rm?.kind === 'mem' ? rm.dispSize / 8 : 0
    const length = (prefix ? 1 : 0) + 1 + (modrm ? 1 + disp : 0) + row.immSize / 8
    const operands = row.operands.map((t, j) =>
      j === rmAt && rm ? rm : fieldFor(t, row, length, pick),
    )
    out.push({ mnemonic: row.mnemonic, operands, prefix, length })
  }
  return out
}

describe('encode: every TABLE row round-trips', () => {
  const key = (r: OpcodeRow) =>
    r.ext === undefined ? hex([r.opcode]) : `${hex([r.opcode])} /${r.ext}`

  /** `bytes` start with the opcode, and extension, of `row`. */
  function encodedBy(row: OpcodeRow, bytes: Uint8Array, prefix: Prefix | undefined): boolean {
    const p = prefix === undefined ? 0 : 1
    const ext = ((bytes[p + 1] ?? 0) >> 3) & 7
    return bytes[p] === row.opcode && (row.ext === undefined || ext === row.ext)
  }

  it('decodes encode(x) as x, no longer, and uses every row for some x', () => {
    const rand = lcg(0x1d1)
    const wrong: string[] = []
    const unused = new Set(TABLE.map(key))
    let count = 0
    for (const row of TABLE) {
      for (const x of samples(row, rand)) {
        count++
        const bytes = encode(x)
        const back = bytes instanceof EncodeError ? undefined : decoded(bytes)
        const tag = `${key(row)} ${shape(x)} -> ${show(bytes)}`
        if (bytes instanceof EncodeError || back === undefined) {
          wrong.push(tag)
          continue
        }
        if (shape(back) !== shape(expected(x)) || back.length > x.length) wrong.push(tag)
        if (encodedBy(row, bytes, x.prefix)) {
          unused.delete(key(row))
          // The same row encodes the same operands at the same length, so to the same bytes.
          if (back.length !== x.length) wrong.push(`${tag}: length ${back.length}`)
        }
      }
    }
    expect(count).toBe(TABLE.length * 96)
    expect(wrong.slice(0, 20)).toEqual([])
    expect([...unused]).toEqual([])
  })
})

/**
 * `8A`/`8B` and the ALU `x2`/`x3` rows with two registers encode as `88`/`89` and `x0`/`x1`,
 * as NASM does: the opcode drops by 2 and ModR/M swaps `reg` and `rm`.
 */
function directionSwap(from: readonly number[], to: Uint8Array): boolean {
  const [op = 0, m = 0] = from
  const swapped = 0xc0 | ((m & 7) << 3) | ((m >> 3) & 7)
  return to.length === 2 && m >= 0xc0 && to[0] === op - 2 && to[1] === swapped
}

describe('encode: every decodable two-byte start', () => {
  it('re-encodes to bytes that decode the same, no longer, that re-encode to themselves', () => {
    const wrong: string[] = []
    let checked = 0
    for (const tail of [
      [0x9c, 0x80, 0x01, 0x80],
      [0x00, 0x00, 0x00, 0x00],
    ]) {
      for (const b0 of range(0, 255)) {
        for (const b1 of range(0, 255)) {
          const x = decoded([b0, b1, ...tail])
          if (x === undefined) continue
          checked++
          const original = [b0, b1, ...tail].slice(0, x.length)
          const bytes = encode(x)
          const back = bytes instanceof EncodeError ? undefined : decoded(bytes)
          const tag = `${hex(original)} ${shape(x)} -> ${show(bytes)}`
          if (bytes instanceof EncodeError || back === undefined) {
            wrong.push(tag)
            continue
          }
          if (shape(back) !== shape(expected(x)) || bytes.length > x.length) wrong.push(tag)
          const same = hex(bytes) === hex(original)
          if (bytes.length === x.length && !same && !directionSwap(original, bytes)) {
            wrong.push(`${tag}: same length, other bytes`)
          }
          const again = encode(back)
          if (show(again) !== hex(bytes)) wrong.push(`${tag}: then ${show(again)}`)
        }
      }
    }
    expect(checked).toBeGreaterThan(90_000)
    expect(wrong.slice(0, 20)).toEqual([])
  })
})
