import { describe, expect, it } from 'bun:test'
import { decode, format, MNEMONICS } from '@asmbots/codec'
import {
  AF,
  AX,
  BP,
  BX,
  CF,
  Core,
  CX,
  type DeathReason,
  DF,
  DI,
  DX,
  EXEC_CONTINUE,
  EXEC_JUMPED,
  EXEC_KILLED,
  EXEC_SPAWN,
  type ExecBot,
  ExecContext,
  type ExecOutcome,
  ea,
  execOne,
  Fetcher,
  FLAGS,
  FLAGS_INIT,
  FLAGS_WRITABLE,
  flagsAdd,
  flagsLogic,
  flagsRcl,
  flagsRcr,
  flagsRol,
  flagsRor,
  flagsSar,
  flagsShl,
  flagsShr,
  flagsSub,
  IP,
  OF,
  Pcg32,
  PF,
  ProcQueue,
  SF,
  SI,
  SP,
  ZF,
} from '../src/index'

/** The owner tag of the bot under test (bot index 2). */
const TAG = 3
/** Where the instruction under test sits unless a case says otherwise. */
const BASE = 0x1000

const REGS = [
  ['ax', AX],
  ['cx', CX],
  ['dx', DX],
  ['bx', BX],
  ['sp', SP],
  ['bp', BP],
  ['si', SI],
  ['di', DI],
] as const
type Reg = (typeof REGS)[number][0]

const NAMED = [
  ['CF', CF],
  ['PF', PF],
  ['AF', AF],
  ['ZF', ZF],
  ['SF', SF],
  ['DF', DF],
  ['OF', OF],
] as const

/** FLAGS with bit 1 and the named flags set: `on('CF ZF')`. */
function on(names: string): number {
  let f = FLAGS_INIT
  for (const name of names.split(' ').filter(Boolean)) {
    const hit = NAMED.find(([n]) => n === name)
    if (hit === undefined) throw new Error(`no flag ${name}`)
    f |= hit[1]
  }
  return f
}

/** The set flags by name, flagging a clear bit 1 or any stray bit. */
function show(f: number): string {
  const out: string[] = NAMED.filter(([, bit]) => f & bit).map(([n]) => n)
  if ((f & FLAGS_INIT) === 0) out.push('!bit1')
  const stray = f & ~(FLAGS_WRITABLE | FLAGS_INIT)
  if (stray) out.push(`+0x${stray.toString(16)}`)
  return out.join(' ')
}

function hex(n: number): string {
  return `0x${n.toString(16).toUpperCase().padStart(4, '0')}`
}

function hex2(n: number): string {
  return `0x${n.toString(16).toUpperCase().padStart(2, '0')}`
}

const OUTCOMES = ['continue', 'jumped', 'killed', 'spawn']

/** Bytes from an address on. */
type Mem = readonly (readonly [address: number, bytes: readonly number[]])[]

/** The state before the instruction. Registers default to 0, IP to BASE, FLAGS to bit 1. */
interface Init extends Partial<Record<Reg, number>> {
  ip?: number
  /** The flags set, by name: 'CF ZF'. */
  flags?: string
  /** Bytes loaded before the code, owner 0. */
  mem?: Mem
  /** Processes queued, the running one included (1), and the queue capacity (8). */
  procs?: number
  cap?: number
}

/** What changes. Registers not named keep their value; IP defaults to the next instruction. */
interface Want extends Partial<Record<Reg, number>> {
  out?: ExecOutcome
  ip?: number
  flags?: string
  /** Bytes the instruction writes, each tagged TAG. Nothing else may change. */
  mem?: Mem
  reason?: DeathReason
  target?: number
}

/** A fresh core holding `code` at IP, and one process of a bot with owner tag TAG. */
class Machine {
  readonly core = new Core()
  readonly fetcher = new Fetcher(this.core)
  readonly ctx = new ExecContext()
  readonly queue: ProcQueue
  readonly row: Uint16Array
  readonly bot: ExecBot
  /** Every write the core reports: [address, length, owner]. */
  readonly writes: [number, number, number][] = []
  private readonly bytes0: Uint8Array
  private readonly owner0: Uint8Array

  constructor(code: readonly number[], init: Init = {}) {
    this.queue = new ProcQueue(init.cap ?? 8)
    this.row = this.queue.rows[this.queue.push()] as Uint16Array
    for (let k = 1; k < (init.procs ?? 1); k++) this.queue.push()
    this.bot = { tag: TAG, queue: this.queue }
    for (const [name, field] of REGS) this.row[field] = init[name] ?? 0
    this.row[IP] = init.ip ?? BASE
    this.row[FLAGS] = on(init.flags ?? '')
    for (const [a, bytes] of init.mem ?? []) this.core.fill(a, bytes, 0)
    this.core.fill(this.row[IP] as number, code, 0)
    this.bytes0 = this.core.bytes.slice()
    this.owner0 = this.core.owner.slice()
    this.core.onWrite = (addr, len, owner) => {
      this.writes.push([addr, len, owner])
    }
  }

  /** Fetches and executes the instruction at IP. */
  step(): ExecOutcome {
    const instr = this.fetcher.fetch(this.row[IP] as number)
    return execOne(this.bot, this.row, this.core, instr, this.ctx)
  }

  /** The registers and IP in hex, FLAGS by name. */
  state(): Record<string, string> {
    const s: Record<string, string> = {}
    for (const [name, field] of REGS) s[name] = hex(this.row[field] as number)
    s.ip = hex(this.row[IP] as number)
    s.flags = show(this.row[FLAGS] as number)
    return s
  }

  /** Each byte whose value or owner changed since the load: `address=byte@owner`. */
  changes(): string[] {
    const out: string[] = []
    for (let a = 0; a < 0x10000; a++) {
      const b = this.core.bytes[a] as number
      const o = this.core.owner[a] as number
      if (b !== this.bytes0[a] || o !== this.owner0[a]) out.push(`${hex(a)}=${hex2(b)}@${o}`)
    }
    return out
  }
}

/** `changes()` after the instruction writes `mem`. */
function written(mem: Mem = []): string[] {
  const out: [number, string][] = []
  for (const [a, bytes] of mem) {
    bytes.forEach((b, k) => {
      const addr = (a + k) & 0xffff
      out.push([addr, `${hex(addr)}=${hex2(b)}@${TAG}`])
    })
  }
  return out.sort((x, y) => x[0] - y[0]).map(([, s]) => s)
}

/** The instruction the bytes decode to, as the disassembler prints it. */
function text(code: readonly number[]): string {
  return format(decode((a) => code[a] ?? 0, 0))
}

/** The state `m` should reach from `before`, given what `want` says changes. */
function expected(
  before: Record<string, string>,
  length: number,
  out: ExecOutcome,
  want: Want,
): Record<string, string> {
  const s = { ...before }
  for (const [name] of REGS) {
    const v = want[name]
    if (v !== undefined) s[name] = hex(v)
  }
  const ip0 = Number(before.ip)
  s.ip = hex(want.ip ?? (out === EXEC_KILLED ? ip0 : (ip0 + length) & 0xffff))
  if (want.flags !== undefined) s.flags = show(on(want.flags))
  return s
}

/**
 * Loads `code` into a fresh core, runs one instruction, and checks the outcome, every register,
 * IP, FLAGS, and every byte of memory against `want`. `source` must be the disassembly.
 */
function check(source: string, code: readonly number[], init: Init = {}, want: Want = {}) {
  expect(text(code)).toBe(source)
  const m = new Machine(code, init)
  const before = m.state()
  const out = m.step()
  expect(OUTCOMES[out]).toBe(OUTCOMES[want.out ?? EXEC_CONTINUE])
  if (want.reason !== undefined) expect(m.ctx.reason).toBe(want.reason)
  if (want.target !== undefined) expect(hex(m.ctx.target)).toBe(hex(want.target))
  expect(m.state()).toEqual(expected(before, code.length, out, want))
  expect(m.changes()).toEqual(written(want.mem))
  for (const [, , owner] of m.writes) expect(owner).toBe(TAG)
  return m
}

type Case = readonly [source: string, code: readonly number[], init?: Init, want?: Want]

function cases(list: readonly Case[]): void {
  for (const [source, code, init, want] of list) {
    it(source, () => {
      check(source, code, init, want)
    })
  }
}

/** Every flag set, so a test sees which ones an instruction clears. */
const ALL = 'CF PF AF ZF SF DF OF'

describe('fetch', () => {
  it('returns its one scratch Instr, or undefined for undefined bytes', () => {
    const core = new Core()
    core.fill(0x100, [0xb8, 0x34, 0x12, 0x00, 0x00, 0xf4, 0xcc, 0x0f], 0)
    const f = new Fetcher(core)
    expect(f.fetch(0x100)).toBe(f.instr)
    expect([f.instr.mnemonic, f.instr.length]).toEqual(['mov', 3])
    for (const [addr, mnemonic] of [
      [0x103, 'dat'],
      [0x105, 'hlt'],
      [0x106, 'int3'],
    ] as const) {
      expect(f.fetch(addr)).toBe(f.instr)
      expect(f.instr.mnemonic).toBe(mnemonic)
    }
    expect(f.fetch(0x107)).toBeUndefined()
  })

  it('reads an instruction that wraps past 0xFFFF', () => {
    const m = new Machine([0xb8, 0x34, 0x12], { ip: 0xfffe })
    expect([m.core.bytes[0xfffe], m.core.bytes[0xffff], m.core.bytes[0]]).toEqual([
      0xb8, 0x34, 0x12,
    ])
    expect(OUTCOMES[m.step()]).toBe('continue')
    expect([m.row[AX], m.row[IP]]).toEqual([0x1234, 0x0001])
  })
})

describe('killing instructions (ISA §3.6, §3.7, §5.3)', () => {
  const init: Init = { ax: 0x1234, sp: 0x3000, flags: 'CF ZF' }
  const dies = (reason: DeathReason): Want => ({ out: EXEC_KILLED, reason })
  cases([
    ['dat', [0x00, 0x00], init, dies('dat')],
    ['dat 0x41', [0x00, 0x41], init, dies('dat')],
    ['hlt', [0xf4], init, dies('hlt')],
    ['int3', [0xcc], init, dies('int3')],
    // `00 /r` would be `add r/m8, r8`; x16c reads 0x00 as DAT (ISA §9.1).
    ['dat 7', [0x00, 0x07], init, dies('dat')],
  ])
  const undefinedBytes: readonly (readonly number[])[] = [
    [0x0f],
    [0x26, 0x90],
    [0xf0, 0x90],
    [0xf3, 0x90],
    [0xf2, 0xa4],
    [0x8d, 0xc0],
    [0xff, 0xff],
    [0xf6, 0xc8, 0x00],
    [0xd0, 0xf0],
    [0xc6, 0xc8, 0x00],
    [0x8f, 0xc8],
    [0xfe, 0x10],
    [0xcd, 0x21],
    [0x63],
  ]
  for (const code of undefinedBytes) {
    it(`undefined: ${code.map(hex2).join(' ')}`, () => {
      check(`db ${hex2(code[0] as number)}`, code, init, dies('undefined'))
    })
  }
})

describe('effective addresses (ISA §2.2)', () => {
  const init: Init = { bx: 0x1000, bp: 0x2000, si: 0x0300, di: 0x0040, flags: ALL }
  // `lea ax, m` for every mod and rm: mod 00, mod 01 with disp8 -2, mod 10 with disp16 0x8000.
  const want: readonly (readonly [string, number])[] = [
    ['[bx+si]', 0x1300],
    ['[bx+di]', 0x1040],
    ['[bp+si]', 0x2300],
    ['[bp+di]', 0x2040],
    ['[si]', 0x0300],
    ['[di]', 0x0040],
    ['[0x1234]', 0x1234],
    ['[bx]', 0x1000],
    ['[bx+si-2]', 0x12fe],
    ['[bx+di-2]', 0x103e],
    ['[bp+si-2]', 0x22fe],
    ['[bp+di-2]', 0x203e],
    ['[si-2]', 0x02fe],
    ['[di-2]', 0x003e],
    ['[bp-2]', 0x1ffe],
    ['[bx-2]', 0x0ffe],
    ['[bx+si-0x8000]', 0x9300],
    ['[bx+di-0x8000]', 0x9040],
    ['[bp+si-0x8000]', 0xa300],
    ['[bp+di-0x8000]', 0xa040],
    ['[si-0x8000]', 0x8300],
    ['[di-0x8000]', 0x8040],
    ['[bp-0x8000]', 0xa000],
    ['[bx-0x8000]', 0x9000],
  ]
  const list: Case[] = want.map(([m, addr], k) => {
    const mod = k >> 3
    const rm = k & 7
    const code = [0x8d, (mod << 6) | rm]
    if (mod === 0 && rm === 6) code.push(0x34, 0x12)
    if (mod === 1) code.push(0xfe)
    if (mod === 2) code.push(0x00, 0x80)
    return [`lea ax, ${m}`, code, init, { ax: addr }]
  })
  cases(list)
  cases([
    ['lea ax, [bx+si]', [0x8d, 0x00], { bx: 0xffff, si: 0x0002 }, { ax: 0x0001 }],
    ['lea ax, [si-2]', [0x8d, 0x44, 0xfe], { si: 0x0001 }, { ax: 0xffff }],
    [
      'lea ax, [word bp+di-1]',
      [0x8d, 0x83, 0xff, 0xff],
      { bp: 0xffff, di: 0x8000 },
      { ax: 0x7ffe },
    ],
    ['lea si, [bx+di-2]', [0x8d, 0x71, 0xfe], { bx: 0x2000, di: 0x0010 }, { si: 0x200e }],
  ])

  it('ea() adds base, index, and displacement mod 64 KB', () => {
    const row = new Uint16Array(10)
    row[BX] = 0xfff0
    row[BP] = 0x2000
    row[SI] = 0x0020
    row[DI] = 0x0004
    const m = (base: 'bx' | 'bp' | undefined, index: 'si' | 'di' | undefined, disp: number) =>
      ea(row, { kind: 'mem', base, index, disp, dispSize: 16, size: 16 })
    expect(m('bx', 'si', 0)).toBe(0x0010)
    expect(m('bp', 'di', -5)).toBe(0x1fff)
    expect(m(undefined, 'si', 0xfff0)).toBe(0x0010)
    expect(m(undefined, undefined, 0xabcd)).toBe(0xabcd)
    expect(m('bx', undefined, 0x7fff)).toBe(0x7fef)
  })

  it('reads and writes a word that straddles 0xFFFF', () => {
    check(
      'mov ax, [bx]',
      [0x8b, 0x07],
      {
        bx: 0xffff,
        mem: [
          [0xffff, [0x34]],
          [0, [0x12]],
        ],
      },
      {
        ax: 0x1234,
      },
    )
    check(
      'mov [bx], ax',
      [0x89, 0x07],
      { bx: 0xffff, ax: 0xbeef },
      {
        mem: [
          [0xffff, [0xef]],
          [0, [0xbe]],
        ],
      },
    )
  })
})

describe('data movement (ISA §3.1)', () => {
  cases([
    [
      'mov [bx+si+4], al',
      [0x88, 0x40, 0x04],
      { ax: 0x1234, bx: 0x2000, si: 0x0010, flags: ALL },
      { mem: [[0x2014, [0x34]]] },
    ],
    ['mov [di], cx', [0x89, 0x0d], { di: 0x2000, cx: 0xbeef }, { mem: [[0x2000, [0xef, 0xbe]]] }],
    [
      'mov ch, [bx]',
      [0x8a, 0x2f],
      { bx: 0x2000, cx: 0x1111, mem: [[0x2000, [0xab]]] },
      { cx: 0xab11 },
    ],
    [
      'mov cx, [bp]',
      [0x8b, 0x4e, 0x00],
      { bp: 0x2000, mem: [[0x2000, [0x34, 0x12]]] },
      { cx: 0x1234 },
    ],
    ['mov ax, bx', [0x89, 0xd8], { bx: 0x5678 }, { ax: 0x5678 }],
    ['mov al, ah', [0x88, 0xe0], { ax: 0x12ff }, { ax: 0x1212 }],
    [
      'mov al, [0x0100]',
      [0xa0, 0x00, 0x01],
      { ax: 0xaaaa, mem: [[0x100, [0x77]]] },
      { ax: 0xaa77 },
    ],
    ['mov ax, [0x0100]', [0xa1, 0x00, 0x01], { mem: [[0x100, [0x34, 0x12]]] }, { ax: 0x1234 }],
    ['mov [0x0100], al', [0xa2, 0x00, 0x01], { ax: 0x1234 }, { mem: [[0x100, [0x34]]] }],
    ['mov [0x0100], ax', [0xa3, 0x00, 0x01], { ax: 0x1234 }, { mem: [[0x100, [0x34, 0x12]]] }],
    ['mov bh, 0x7F', [0xb7, 0x7f], { bx: 0x1234 }, { bx: 0x7f34 }],
    ['mov ax, 0x1234', [0xb8, 0x34, 0x12], { flags: ALL }, { ax: 0x1234 }],
    ['mov sp, 0xFFFE', [0xbc, 0xfe, 0xff], {}, { sp: 0xfffe }],
    ['mov al, 0x55', [0xc6, 0xc0, 0x55], { ax: 0xaaaa }, { ax: 0xaa55 }],
    [
      'mov byte [bx+si+4], 0x41',
      [0xc6, 0x40, 0x04, 0x41],
      { bx: 0x2000 },
      { mem: [[0x2004, [0x41]]] },
    ],
    [
      'mov word [bx], 0',
      [0xc7, 0x07, 0x00, 0x00],
      { bx: 0x2000, mem: [[0x2000, [0xff, 0xff]]] },
      { mem: [[0x2000, [0x00, 0x00]]] },
    ],
  ])

  describe('xchg', () => {
    const regs: Init = { ax: 0x1111, cx: 0x2222, dx: 0x3333, bx: 0x4444, sp: 0x5555, flags: ALL }
    cases([
      // 0x90 would be `xchg ax, ax` (ISA §3.1): a NOP that changes nothing but IP.
      ['nop', [0x90], regs],
      ['xchg ax, ax', [0x87, 0xc0], regs],
      ['xchg ax, cx', [0x91], regs, { ax: 0x2222, cx: 0x1111 }],
      ['xchg ax, sp', [0x94], regs, { ax: 0x5555, sp: 0x1111 }],
      ['xchg al, ah', [0x86, 0xe0], { ax: 0x1234 }, { ax: 0x3412 }],
      [
        'xchg [bx], al',
        [0x86, 0x07],
        { bx: 0x2000, ax: 0x1234, mem: [[0x2000, [0x99]]] },
        { ax: 0x1299, mem: [[0x2000, [0x34]]] },
      ],
      [
        'xchg [bx], dx',
        [0x87, 0x17],
        { bx: 0x2000, dx: 0xaaaa, mem: [[0x2000, [0x34, 0x12]]] },
        { dx: 0x1234, mem: [[0x2000, [0xaa, 0xaa]]] },
      ],
    ])
  })

  describe('cbw, cwd', () => {
    cases([
      ['cbw', [0x98], { ax: 0x1280 }, { ax: 0xff80 }],
      ['cbw', [0x98], { ax: 0xff7f }, { ax: 0x007f }],
      ['cwd', [0x99], { ax: 0x8000 }, { dx: 0xffff }],
      ['cwd', [0x99], { ax: 0x7fff, dx: 0x1234 }, { dx: 0x0000 }],
    ])
  })
})

describe('stack (ISA §3.1)', () => {
  cases([
    ['push bx', [0x53], { bx: 0x1234, sp: 0x3000 }, { sp: 0x2ffe, mem: [[0x2ffe, [0x34, 0x12]]] }],
    // The 8086 pushes SP after the decrement (ISA §3.1, §9.3); the 80286 and later push it before.
    ['push sp', [0x54], { sp: 0x3000 }, { sp: 0x2ffe, mem: [[0x2ffe, [0xfe, 0x2f]]] }],
    ['push sp', [0xff, 0xf4], { sp: 0x3000 }, { sp: 0x2ffe, mem: [[0x2ffe, [0xfe, 0x2f]]] }],
    [
      'push word [bx]',
      [0xff, 0x37],
      { bx: 0x2000, sp: 0x3000, mem: [[0x2000, [0xcd, 0xab]]] },
      { sp: 0x2ffe, mem: [[0x2ffe, [0xcd, 0xab]]] },
    ],
    ['pop bx', [0x5b], { sp: 0x2ffe, mem: [[0x2ffe, [0x34, 0x12]]] }, { bx: 0x1234, sp: 0x3000 }],
    // SP takes the popped word; the increment is lost.
    ['pop sp', [0x5c], { sp: 0x2ffe, mem: [[0x2ffe, [0x00, 0x40]]] }, { sp: 0x4000 }],
    [
      'pop word [bx+2]',
      [0x8f, 0x47, 0x02],
      { bx: 0x2000, sp: 0x2ffe, mem: [[0x2ffe, [0x78, 0x56]]] },
      { sp: 0x3000, mem: [[0x2002, [0x78, 0x56]]] },
    ],
    [
      'push ax',
      [0x50],
      { ax: 0xbeef, sp: 0x0001 },
      {
        sp: 0xffff,
        mem: [
          [0xffff, [0xef]],
          [0, [0xbe]],
        ],
      },
    ],
    [
      'pop ax',
      [0x58],
      {
        sp: 0xffff,
        mem: [
          [0xffff, [0xef]],
          [0, [0xbe]],
        ],
      },
      { ax: 0xbeef, sp: 0x0001 },
    ],
    [
      'pushf',
      [0x9c],
      { sp: 0x3000, flags: 'CF ZF DF OF' },
      { sp: 0x2ffe, mem: [[0x2ffe, [0x43, 0x0c]]] },
    ],
    ['popf', [0x9d], { sp: 0x2ffe, mem: [[0x2ffe, [0xff, 0xff]]] }, { sp: 0x3000, flags: ALL }],
    ['popf', [0x9d], { sp: 0x2ffe, flags: ALL }, { sp: 0x3000, flags: '' }],
    ['sahf', [0x9e], { ax: 0xff00, flags: 'DF OF' }, { flags: ALL }],
    ['sahf', [0x9e], { ax: 0x00ff, flags: ALL }, { flags: 'DF OF' }],
    // AH = SF ZF 0 AF 0 PF 1 CF.
    ['lahf', [0x9f], { flags: ALL }, { ax: 0xd700 }],
    ['lahf', [0x9f], { ax: 0x12ff }, { ax: 0x02ff }],
  ])
})

const ALU_OPS = ['add', 'or', 'adc', 'sbb', 'and', 'sub', 'xor', 'cmp'] as const
type AluOp = (typeof ALU_OPS)[number]

/** `a op b` with CF set coming in: the result and the status flags. */
function aluRef(op: AluOp, a: number, b: number, size: 8 | 16): [number, number] {
  const mask = size === 8 ? 0xff : 0xffff
  switch (op) {
    case 'add':
      return [(a + b) & mask, flagsAdd(a, b, 0, size)]
    case 'adc':
      return [(a + b + 1) & mask, flagsAdd(a, b, 1, size)]
    case 'sub':
    case 'cmp':
      return [(a - b) & mask, flagsSub(a, b, 0, size)]
    case 'sbb':
      return [(a - b - 1) & mask, flagsSub(a, b, 1, size)]
    case 'and':
      return [a & b & mask, flagsLogic(a & b, size)]
    case 'or':
      return [(a | b) & mask, flagsLogic(a | b, size)]
    case 'xor':
      return [(a ^ b) & mask, flagsLogic(a ^ b, size)]
  }
}

/** One of the nine ALU forms (ISA §3.2): dst `a`, src `b`, and where the result lands. */
interface AluForm {
  form: string
  code: (n: number) => number[]
  size: 8 | 16
  /** The source, when not `B8` or `B16`. */
  b?: number
  init: (a: number, b: number) => Init
  result: (r: number) => Want
}

const A8 = 0xa3
const B8 = 0xe7
const A16 = 0xc5a3
const B16 = 0x6be7
const lohi = (v: number) => [v & 0xff, v >> 8]

const ALU_FORMS: readonly AluForm[] = [
  {
    form: 'r/m8, r8',
    code: (n) => [n << 3, 0x0f],
    size: 8,
    init: (a, b) => ({ bx: 0x2000, cx: b, mem: [[0x2000, [a]]] }),
    result: (r) => ({ mem: [[0x2000, [r]]] }),
  },
  {
    form: 'r/m16, r16',
    code: (n) => [(n << 3) | 1, 0x0f],
    size: 16,
    init: (a, b) => ({ bx: 0x2000, cx: b, mem: [[0x2000, lohi(a)]] }),
    result: (r) => ({ mem: [[0x2000, lohi(r)]] }),
  },
  {
    form: 'r8, r/m8',
    code: (n) => [(n << 3) | 2, 0x0f],
    size: 8,
    init: (a, b) => ({ bx: 0x2000, cx: 0x5500 | a, mem: [[0x2000, [b]]] }),
    result: (r) => ({ cx: 0x5500 | r }),
  },
  {
    form: 'r16, r/m16',
    code: (n) => [(n << 3) | 3, 0x0f],
    size: 16,
    init: (a, b) => ({ bx: 0x2000, cx: a, mem: [[0x2000, lohi(b)]] }),
    result: (r) => ({ cx: r }),
  },
  {
    form: 'AL, imm8',
    code: (n) => [(n << 3) | 4, B8],
    size: 8,
    init: (a) => ({ ax: 0x5500 | a }),
    result: (r) => ({ ax: 0x5500 | r }),
  },
  {
    form: 'AX, imm16',
    code: (n) => [(n << 3) | 5, ...lohi(B16)],
    size: 16,
    init: (a) => ({ ax: a }),
    result: (r) => ({ ax: r }),
  },
  {
    form: 'r/m8, imm8',
    code: (n) => [0x80, 0x07 | (n << 3), B8],
    size: 8,
    init: (a) => ({ bx: 0x2000, mem: [[0x2000, [a]]] }),
    result: (r) => ({ mem: [[0x2000, [r]]] }),
  },
  {
    form: 'r/m16, imm16',
    code: (n) => [0x81, 0x07 | (n << 3), ...lohi(B16)],
    size: 16,
    init: (a) => ({ bx: 0x2000, mem: [[0x2000, lohi(a)]] }),
    result: (r) => ({ mem: [[0x2000, lohi(r)]] }),
  },
  {
    form: 'r/m16, imm8 (sign-extended)',
    code: (n) => [0x83, 0x07 | (n << 3), 0xf0],
    size: 16,
    b: 0xfff0,
    init: (a) => ({ bx: 0x2000, mem: [[0x2000, lohi(a)]] }),
    result: (r) => ({ mem: [[0x2000, lohi(r)]] }),
  },
]

describe('ALU (ISA §3.2, §4)', () => {
  describe('every op in every form', () => {
    for (const [n, op] of ALU_OPS.entries()) {
      for (const f of ALU_FORMS) {
        const code = f.code(n)
        if (code[0] === 0x00) continue // DAT
        const a = f.size === 8 ? A8 : A16
        const b = f.b ?? (f.size === 8 ? B8 : B16)
        it(`${op} ${f.form}: ${text(code)}`, () => {
          const [r, status] = aluRef(op, a, b, f.size)
          const want: Want = op === 'cmp' ? {} : f.result(r)
          check(
            text(code),
            code,
            { ...f.init(a, b), flags: ALL },
            {
              ...want,
              flags: show(DF | FLAGS_INIT | status),
            },
          )
        })
      }
    }
  })

  cases([
    [
      'add ax, strict word 1',
      [0x05, 0x01, 0x00],
      { ax: 0x7fff },
      { ax: 0x8000, flags: 'PF AF SF OF' },
    ],
    ['add al, 0xFF', [0x04, 0xff], { ax: 0x0001 }, { ax: 0x0000, flags: 'CF PF AF ZF' }],
    ['add ah, 1', [0x80, 0xc4, 0x01], { ax: 0x7fff }, { ax: 0x80ff, flags: 'AF SF OF' }],
    ['add bx, -1', [0x83, 0xc3, 0xff], { flags: 'CF ZF' }, { bx: 0xffff, flags: 'PF SF' }],
    ['add bx, 4', [0x83, 0xc3, 0x04], { bx: 0x0ffe }, { bx: 0x1002, flags: 'AF' }],
    ['add bx, 0x100', [0x81, 0xc3, 0x00, 0x01], { bx: 0xff00 }, { bx: 0x0000, flags: 'CF PF ZF' }],
    [
      'adc ax, 0',
      [0x83, 0xd0, 0x00],
      { ax: 0xffff, flags: 'CF' },
      { ax: 0x0000, flags: 'CF PF AF ZF' },
    ],
    ['sbb al, 0', [0x1c, 0x00], { flags: 'CF' }, { ax: 0x00ff, flags: 'CF PF AF SF' }],
    ['sub ax, 1', [0x83, 0xe8, 0x01], {}, { ax: 0xffff, flags: 'CF PF AF SF' }],
    [
      'sub word [bx], -0x10',
      [0x83, 0x2f, 0xf0],
      { bx: 0x2000, mem: [[0x2000, [0xf8, 0xff]]] },
      { mem: [[0x2000, [0x08, 0x00]]], flags: '' },
    ],
    ['xor ax, ax', [0x31, 0xc0], { ax: 0x1234, flags: 'CF AF SF OF' }, { ax: 0, flags: 'PF ZF' }],
    [
      'and ax, 0xF0F',
      [0x25, 0x0f, 0x0f],
      { ax: 0xffff, flags: ALL },
      { ax: 0x0f0f, flags: 'PF DF' },
    ],
    ['cmp al, 0', [0x3c, 0x00], { ax: 0xff80 }, { flags: 'SF' }],
    // CMP reads its memory operand and writes nothing.
    [
      'cmp [bx], ax',
      [0x39, 0x07],
      { ax: 0x1234, bx: 0x2000, mem: [[0x2000, [0x34, 0x12]]] },
      {
        flags: 'PF ZF',
      },
    ],
    [
      'cmp byte [bx], 0',
      [0x80, 0x3f, 0x00],
      { bx: 0x2000, mem: [[0x2000, [0x01]]] },
      { flags: '' },
    ],
  ])
})

describe('TEST, NOT, NEG (ISA §3.2)', () => {
  cases([
    [
      'test [bx], cl',
      [0x84, 0x0f],
      { bx: 0x2000, cx: 0x000f, flags: 'CF OF', mem: [[0x2000, [0xf0]]] },
      { flags: 'PF ZF' },
    ],
    [
      'test [bx], cx',
      [0x85, 0x0f],
      { bx: 0x2000, cx: 0x8000, mem: [[0x2000, [0x00, 0x80]]] },
      { flags: 'PF SF' },
    ],
    ['test al, 0x80', [0xa8, 0x80], { ax: 0x0080, flags: ALL }, { flags: 'SF DF' }],
    ['test ax, 0x101', [0xa9, 0x01, 0x01], { ax: 0x0303 }, { flags: '' }],
    [
      'test byte [bx], 1',
      [0xf6, 0x07, 0x01],
      { bx: 0x2000, mem: [[0x2000, [0x02]]] },
      {
        flags: 'PF ZF',
      },
    ],
    [
      'test word [bx], 0x8000',
      [0xf7, 0x07, 0x00, 0x80],
      { bx: 0x2000, mem: [[0x2000, [0x00, 0x80]]] },
      { flags: 'PF SF' },
    ],
    [
      'not byte [bx]',
      [0xf6, 0x17],
      { bx: 0x2000, flags: 'CF ZF', mem: [[0x2000, [0x0f]]] },
      { mem: [[0x2000, [0xf0]]] },
    ],
    ['not ax', [0xf7, 0xd0], { ax: 0x1234 }, { ax: 0xedcb }],
    ['neg ax', [0xf7, 0xd8], { ax: 0x0001 }, { ax: 0xffff, flags: 'CF PF AF SF' }],
    ['neg ax', [0xf7, 0xd8], { flags: 'CF' }, { flags: 'PF ZF' }],
    ['neg ax', [0xf7, 0xd8], { ax: 0x8000 }, { flags: 'CF PF SF OF' }],
    [
      'neg byte [bx]',
      [0xf6, 0x1f],
      { bx: 0x2000, mem: [[0x2000, [0x01]]] },
      { mem: [[0x2000, [0xff]]], flags: 'CF PF AF SF' },
    ],
  ])
})

describe('MUL, IMUL, DIV, IDIV (ISA §3.2, §4)', () => {
  const div: Want = { out: EXEC_KILLED, reason: 'div' }
  describe('mul and imul set CF and OF, and clear ZF SF PF AF', () => {
    cases([
      [
        'mul bl',
        [0xf6, 0xe3],
        { ax: 0x0080, bx: 0x0002, flags: ALL },
        {
          ax: 0x0100,
          flags: 'CF DF OF',
        },
      ],
      ['mul bl', [0xf6, 0xe3], { ax: 0xff10, bx: 0x000f, flags: ALL }, { ax: 0x00f0, flags: 'DF' }],
      [
        'mul cx',
        [0xf7, 0xe1],
        { ax: 0xffff, cx: 0xffff },
        { ax: 0x0001, dx: 0xfffe, flags: 'CF OF' },
      ],
      [
        'mul word [bx]',
        [0xf7, 0x27],
        { ax: 0x0100, bx: 0x2000, dx: 0x1234, mem: [[0x2000, [0x00, 0x01]]] },
        { ax: 0x0000, dx: 0x0001, flags: 'CF OF' },
      ],
      ['mul cx', [0xf7, 0xe1], { ax: 0x0003, cx: 0x0005, dx: 0x1234 }, { ax: 15, dx: 0 }],
      // A byte operand reads one byte: the 0xFF after it takes no part.
      [
        'mul byte [bx]',
        [0xf6, 0x27],
        { ax: 0x1203, bx: 0x2000, mem: [[0x2000, [0x05, 0xff]]] },
        {
          ax: 0x000f,
        },
      ],
      ['imul bl', [0xf6, 0xeb], { ax: 0x00ff, bx: 0x0080 }, { ax: 0x0080, flags: 'CF OF' }],
      [
        'imul bl',
        [0xf6, 0xeb],
        { ax: 0x00fe, bx: 0x0003, flags: 'ZF SF' },
        { ax: 0xfffa, flags: '' },
      ],
      ['imul cx', [0xf7, 0xe9], { ax: 0x8000, cx: 0xffff }, { ax: 0x8000, dx: 0, flags: 'CF OF' }],
      ['imul cx', [0xf7, 0xe9], { ax: 0xffff, cx: 0x0005 }, { ax: 0xfffb, dx: 0xffff }],
      ['imul bl', [0xf6, 0xeb], { ax: 0x0080, bx: 0x0002 }, { ax: 0xff00, flags: 'CF OF' }],
      [
        'imul cx',
        [0xf7, 0xe9],
        { ax: 0x0100, cx: 0x0003, flags: ALL },
        { ax: 0x0300, flags: 'DF' },
      ],
    ])
  })
  describe('div and idiv leave FLAGS alone and kill on a divide error', () => {
    const flags = 'CF ZF OF'
    cases([
      ['div bl', [0xf6, 0xf3], { ax: 0x0405, bx: 0x0010, flags }, { ax: 0x0540 }],
      ['div bl', [0xf6, 0xf3], { ax: 0x0405, flags }, div],
      ['div bl', [0xf6, 0xf3], { flags }, div],
      ['div bl', [0xf6, 0xf3], { ax: 0x1000, bx: 0x0010, flags }, div],
      ['div cx', [0xf7, 0xf1], { dx: 0x0001, cx: 0x0003, flags }, { ax: 0x5555, dx: 0x0001 }],
      [
        'div byte [bx]',
        [0xf6, 0x37],
        { ax: 0x0064, bx: 0x2000, mem: [[0x2000, [0x07, 0xff]]], flags },
        {
          ax: 0x020e,
        },
      ],
      ['div cx', [0xf7, 0xf1], { dx: 0x0001, cx: 0x0001, flags }, div],
      ['div word [bx]', [0xf7, 0x37], { ax: 0x1234, bx: 0x2000, flags }, div],
      ['idiv bl', [0xf6, 0xfb], { ax: 0xfff9, bx: 0x0002, flags }, { ax: 0xfffd }],
      ['idiv bl', [0xf6, 0xfb], { ax: 0x00fe, bx: 0x0002, flags }, { ax: 0x007f }],
      ['idiv bl', [0xf6, 0xfb], { ax: 0x0007, bx: 0x00fe, flags }, { ax: 0x01fd }],
      ['idiv bl', [0xf6, 0xfb], { ax: 0xff02, bx: 0x0002, flags }, { ax: 0x0081 }],
      // A quotient of -128 fits a byte, but the 8086 raises #DE for it.
      ['idiv bl', [0xf6, 0xfb], { ax: 0xff00, bx: 0x0002, flags }, div],
      ['idiv bl', [0xf6, 0xfb], { ax: 0x0100, bx: 0x0002, flags }, div],
      ['idiv bl', [0xf6, 0xfb], { ax: 0x0100, flags }, div],
      [
        'idiv cx',
        [0xf7, 0xf9],
        { dx: 0xfffe, ax: 0x7960, cx: 0x0007, flags },
        {
          ax: 0xc833,
          dx: 0xfffb,
        },
      ],
      ['idiv cx', [0xf7, 0xf9], { dx: 0xffff, ax: 0x0000, cx: 0x0002, flags }, div],
      ['idiv cx', [0xf7, 0xf9], { ax: 0x0064, cx: 0xfff9, flags }, { ax: 0xfff2, dx: 0x0002 }],
      ['idiv cx', [0xf7, 0xf9], { ax: 0x0001, flags }, div],
    ])
  })
})

describe('INC, DEC (ISA §3.2): every status flag but CF', () => {
  cases([
    ['inc bx', [0x43], { bx: 0x7fff, flags: 'CF' }, { bx: 0x8000, flags: 'CF PF AF SF OF' }],
    ['dec cx', [0x49], {}, { cx: 0xffff, flags: 'PF AF SF' }],
    ['inc sp', [0x44], { sp: 0xffff }, { sp: 0x0000, flags: 'PF AF ZF' }],
    ['inc ah', [0xfe, 0xc4], { ax: 0x12ff, flags: 'ZF' }, { ax: 0x13ff, flags: '' }],
    [
      'inc byte [bx]',
      [0xfe, 0x07],
      { bx: 0x2000, flags: 'CF', mem: [[0x2000, [0xff]]] },
      { mem: [[0x2000, [0x00]]], flags: 'CF PF AF ZF' },
    ],
    [
      'dec byte [bx]',
      [0xfe, 0x0f],
      { bx: 0x2000, mem: [[0x2000, [0x01]]] },
      { mem: [[0x2000, [0x00]]], flags: 'PF ZF' },
    ],
    [
      'inc word [bx]',
      [0xff, 0x07],
      { bx: 0x2000, mem: [[0x2000, [0xff, 0x00]]] },
      { mem: [[0x2000, [0x00, 0x01]]], flags: 'PF AF' },
    ],
    [
      'dec word [di]',
      [0xff, 0x0d],
      { di: 0x2000, flags: 'CF', mem: [[0x2000, [0x00, 0x80]]] },
      { mem: [[0x2000, [0xff, 0x7f]]], flags: 'CF PF AF OF' },
    ],
  ])
})

const SHIFT_OPS = [
  ['rol', 0, flagsRol],
  ['ror', 1, flagsRor],
  ['rcl', 2, flagsRcl],
  ['rcr', 3, flagsRcr],
  ['shl', 4, flagsShl],
  ['shr', 5, flagsShr],
  ['sar', 7, flagsSar],
] as const

/** The four shift forms (ISA §3.2): the operand, its value, the count, and where it lands. */
const SHIFT_FORMS = [
  {
    form: 'r/m8, 1',
    code: (ext: number) => [0xd0, 0x07 | (ext << 3)],
    size: 8,
    value: 0xb5,
    count: 1,
    init: { bx: 0x2000, mem: [[0x2000, [0xb5]]] },
    result: (r: number): Want => ({ mem: [[0x2000, [r]]] }),
  },
  {
    form: 'r/m16, 1',
    code: (ext: number) => [0xd1, 0xc0 | (ext << 3)],
    size: 16,
    value: 0xb5c3,
    count: 1,
    init: { ax: 0xb5c3 },
    result: (r: number): Want => ({ ax: r }),
  },
  {
    form: 'r/m8, CL',
    code: (ext: number) => [0xd2, 0xc3 | (ext << 3)],
    size: 8,
    value: 0xb5,
    count: 3,
    init: { bx: 0x12b5, cx: 0x0003 },
    result: (r: number): Want => ({ bx: 0x1200 | r }),
  },
  {
    form: 'r/m16, CL',
    code: (ext: number) => [0xd3, ext << 3],
    size: 16,
    value: 0xb5c3,
    count: 5,
    init: { bx: 0x2000, si: 0x0010, cx: 0x0005, mem: [[0x2010, [0xc3, 0xb5]]] },
    result: (r: number): Want => ({ mem: [[0x2010, lohi(r)]] }),
  },
] as const

describe('shifts and rotates (ISA §3.2, §4)', () => {
  describe('every op in every form', () => {
    const flags = 'CF ZF DF'
    for (const [op, ext, fn] of SHIFT_OPS) {
      for (const f of SHIFT_FORMS) {
        const code = f.code(ext)
        it(`${op} ${f.form}: ${text(code)}`, () => {
          const out = fn(f.value, f.count, on(flags), f.size)
          check(
            text(code),
            code,
            { ...f.init, flags },
            {
              ...f.result(out & 0xffff),
              flags: show(out >>> 16),
            },
          )
        })
      }
    }
  })

  cases([
    ['shl ax, 1', [0xd1, 0xe0], { ax: 0x8000 }, { ax: 0, flags: 'CF PF ZF OF' }],
    [
      'shr ax, cl',
      [0xd3, 0xe8],
      { ax: 0x8001, cx: 0x0004, flags: 'CF SF OF' },
      {
        ax: 0x0800,
        flags: 'PF',
      },
    ],
    [
      'sar byte [bx], 1',
      [0xd0, 0x3f],
      { bx: 0x2000, mem: [[0x2000, [0x81]]] },
      { mem: [[0x2000, [0xc0]]], flags: 'CF PF SF' },
    ],
    // Counts are not masked (ISA §4): 17 rotates a word by 17, which lands where 1 does.
    ['rol ax, cl', [0xd3, 0xc0], { ax: 0x8001, cx: 17 }, { ax: 0x0003, flags: 'CF OF' }],
    ['shl ax, cl', [0xd3, 0xe0], { ax: 0xffff, cx: 40, flags: 'CF SF' }, { ax: 0, flags: 'PF ZF' }],
    ['rcr al, 1', [0xd0, 0xd8], { ax: 0x0001, flags: 'CF' }, { ax: 0x0080, flags: 'CF OF' }],
    // Count 0 changes no value and no flag, but the 8086 still writes the operand back.
    [
      'shl word [bx], cl',
      [0xd3, 0x27],
      { bx: 0x2000, flags: 'CF ZF SF', mem: [[0x2000, [0x34, 0x12]]] },
      { mem: [[0x2000, [0x34, 0x12]]] },
    ],
  ])
})

describe('control flow (ISA §3.3)', () => {
  const jumped = (ip: number, more: Want = {}): Want => ({ out: EXEC_JUMPED, ip, ...more })
  cases([
    ['jmp short $', [0xeb, 0xfe], { flags: ALL }, jumped(BASE)],
    ['jmp $ + 0x200', [0xe9, 0xfd, 0x01], {}, jumped(BASE + 0x200)],
    ['jmp short $ + 0x12', [0xeb, 0x10], { ip: 0xfffe }, jumped(0x0010)],
    ['jmp bx', [0xff, 0xe3], { bx: 0x4321 }, jumped(0x4321)],
    ['jmp word [bx]', [0xff, 0x27], { bx: 0x2000, mem: [[0x2000, [0x78, 0x56]]] }, jumped(0x5678)],
    [
      'call $ + 3',
      [0xe8, 0x00, 0x00],
      { sp: 0x3000 },
      jumped(BASE + 3, { sp: 0x2ffe, mem: [[0x2ffe, lohi(BASE + 3)]] }),
    ],
    [
      'call bx',
      [0xff, 0xd3],
      { bx: 0x4321, sp: 0x3000 },
      jumped(0x4321, { sp: 0x2ffe, mem: [[0x2ffe, lohi(BASE + 2)]] }),
    ],
    // The target is read before the push, so `call sp` goes to the old SP.
    [
      'call sp',
      [0xff, 0xd4],
      { sp: 0x3000 },
      jumped(0x3000, { sp: 0x2ffe, mem: [[0x2ffe, lohi(BASE + 2)]] }),
    ],
    [
      'call word [bx]',
      [0xff, 0x17],
      { bx: 0x2000, sp: 0x3000, mem: [[0x2000, [0x78, 0x56]]] },
      jumped(0x5678, { sp: 0x2ffe, mem: [[0x2ffe, lohi(BASE + 2)]] }),
    ],
    ['ret', [0xc3], { sp: 0x2ffe, mem: [[0x2ffe, [0x34, 0x12]]] }, jumped(0x1234, { sp: 0x3000 })],
    [
      'ret 4',
      [0xc2, 0x04, 0x00],
      { sp: 0x2ffe, mem: [[0x2ffe, [0x34, 0x12]]] },
      jumped(0x1234, { sp: 0x3004 }),
    ],
    [
      'ret 0xFFFE',
      [0xc2, 0xfe, 0xff],
      { sp: 0x2ffe, mem: [[0x2ffe, [0x34, 0x12]]] },
      jumped(0x1234, { sp: 0x2ffe }),
    ],
  ])

  it('call and ret through a stack that wraps at SP = 0x0001', () => {
    // 0x1000: call $ + 0x100; 0x1100: ret
    const m = new Machine([0xe8, 0xfd, 0x00], { sp: 0x0001, mem: [[0x1100, [0xc3]]] })
    expect(OUTCOMES[m.step()]).toBe('jumped')
    expect([hex(m.row[IP] as number), hex(m.row[SP] as number)]).toEqual(['0x1100', '0xFFFF'])
    expect(m.changes()).toEqual(
      written([
        [0xffff, [0x03]],
        [0, [0x10]],
      ]),
    )
    expect(m.writes).toEqual([[0xffff, 2, TAG]])
    expect(OUTCOMES[m.step()]).toBe('jumped')
    expect([hex(m.row[IP] as number), hex(m.row[SP] as number)]).toEqual(['0x1003', '0x0001'])
  })

  describe('Jcc (ISA §3.3): each condition taken and not taken', () => {
    const JCC = [
      ['jo', 0x70, ['OF'], ['', 'CF PF AF ZF SF DF']],
      ['jno', 0x71, ['', 'CF PF AF ZF SF DF'], ['OF']],
      ['jc', 0x72, ['CF'], ['', 'PF AF ZF SF DF OF']],
      ['jnc', 0x73, ['', 'PF AF ZF SF DF OF'], ['CF']],
      ['jz', 0x74, ['ZF'], ['', 'CF PF AF SF DF OF']],
      ['jnz', 0x75, ['', 'CF PF AF SF DF OF'], ['ZF']],
      ['jna', 0x76, ['CF', 'ZF', 'CF ZF'], ['', 'PF AF SF DF OF']],
      ['ja', 0x77, ['', 'PF AF SF DF OF'], ['CF', 'ZF', 'CF ZF']],
      ['js', 0x78, ['SF'], ['', 'CF PF AF ZF DF OF']],
      ['jns', 0x79, ['', 'CF PF AF ZF DF OF'], ['SF']],
      ['jpe', 0x7a, ['PF'], ['', 'CF AF ZF SF DF OF']],
      ['jpo', 0x7b, ['', 'CF AF ZF SF DF OF'], ['PF']],
      ['jl', 0x7c, ['SF', 'OF'], ['', 'SF OF']],
      ['jnl', 0x7d, ['', 'SF OF'], ['SF', 'OF']],
      ['jng', 0x7e, ['ZF', 'SF', 'OF', 'ZF SF OF'], ['', 'SF OF']],
      ['jg', 0x7f, ['', 'SF OF'], ['ZF', 'SF', 'OF', 'ZF SF OF']],
    ] as const
    for (const [cc, opcode, taken, notTaken] of JCC) {
      it(cc, () => {
        const source = `${cc} $ - 10`
        for (const flags of taken) check(source, [opcode, 0xf4], { flags }, jumped(BASE - 10))
        for (const flags of notTaken) check(source, [opcode, 0xf4], { flags })
      })
    }
    it('wraps the target past 0xFFFF', () => {
      check('jz $ + 0x20', [0x74, 0x1e], { ip: 0xfff0, flags: 'ZF' }, jumped(0x0010))
    })
  })

  describe('LOOP, LOOPE, LOOPNE, JCXZ (ISA §3.3)', () => {
    const back = BASE - 4
    cases([
      ['loop $ - 4', [0xe2, 0xfa], { cx: 2, flags: 'CF ZF' }, jumped(back, { cx: 1 })],
      ['loop $ - 4', [0xe2, 0xfa], { cx: 1, flags: 'CF ZF' }, { cx: 0 }],
      // CX is decremented first, so 0 loops 65,536 times.
      ['loop $ - 4', [0xe2, 0xfa], { cx: 0 }, jumped(back, { cx: 0xffff })],
      ['loope $ - 4', [0xe1, 0xfa], { cx: 2, flags: 'ZF' }, jumped(back, { cx: 1 })],
      ['loope $ - 4', [0xe1, 0xfa], { cx: 2 }, { cx: 1 }],
      ['loope $ - 4', [0xe1, 0xfa], { cx: 1, flags: 'ZF' }, { cx: 0 }],
      ['loopne $ - 4', [0xe0, 0xfa], { cx: 2 }, jumped(back, { cx: 1 })],
      ['loopne $ - 4', [0xe0, 0xfa], { cx: 2, flags: 'ZF' }, { cx: 1 }],
      ['loopne $ - 4', [0xe0, 0xfa], { cx: 1 }, { cx: 0 }],
      ['jcxz $ - 4', [0xe3, 0xfa], { flags: ALL }, jumped(back)],
      ['jcxz $ - 4', [0xe3, 0xfa], { cx: 1 }],
      ['jcxz $ - 4', [0xe3, 0xfa], { cx: 0xffff }],
    ])

    // 0x1000: inc si; cmp [si], al; loopne $ - 3. Leaves at 0x1005 on a match or when CX runs out.
    const SCAN = [0x46, 0x38, 0x04, 0xe0, 0xfb]
    const scan = (cx: number) => {
      const m = new Machine(SCAN, {
        ax: 0x0042,
        cx,
        si: 0x1fff,
        mem: [[0x2000, [0x11, 0x22, 0x42, 0x33]]],
      })
      let steps = 0
      while (m.row[IP] !== BASE + 5 && steps < 100) {
        expect(OUTCOMES[m.step()]).not.toBe('killed')
        steps++
      }
      return { m, steps }
    }

    it('loopne leaves a scan loop when CMP sets ZF', () => {
      const { m, steps } = scan(10)
      expect(steps).toBe(9)
      expect([hex(m.row[SI] as number), m.row[CX], show(m.row[FLAGS] as number)]).toEqual([
        '0x2002',
        7,
        'PF ZF',
      ])
    })

    it('loopne leaves a scan loop when CX runs out, ZF clear', () => {
      const { m, steps } = scan(2)
      expect(steps).toBe(6)
      expect([hex(m.row[SI] as number), m.row[CX], (m.row[FLAGS] as number) & ZF]).toEqual([
        '0x2001',
        0,
        0,
      ])
    })
  })
})

describe('string instructions (ISA §3.4)', () => {
  const src = 0x2000
  const dst = 0x3000
  cases([
    [
      'movsb',
      [0xa4],
      { si: src, di: dst, mem: [[src, [0x5a]]] },
      {
        si: src + 1,
        di: dst + 1,
        mem: [[dst, [0x5a]]],
      },
    ],
    [
      'movsw',
      [0xa5],
      { si: src, di: dst, flags: 'DF', mem: [[src, [0x34, 0x12]]] },
      {
        si: src - 2,
        di: dst - 2,
        mem: [[dst, [0x34, 0x12]]],
      },
    ],
    [
      'cmpsb',
      [0xa6],
      {
        si: src,
        di: dst,
        mem: [
          [src, [0x01]],
          [dst, [0x02]],
        ],
      },
      {
        si: src + 1,
        di: dst + 1,
        flags: 'CF PF AF SF',
      },
    ],
    [
      'cmpsw',
      [0xa7],
      {
        si: src,
        di: dst,
        flags: 'CF DF',
        mem: [
          [src, [0x34, 0x12]],
          [dst, [0x34, 0x12]],
        ],
      },
      { si: src - 2, di: dst - 2, flags: 'PF ZF DF' },
    ],
    // Equal low bytes: only a word compare sees the difference.
    [
      'cmpsw',
      [0xa7],
      {
        si: src,
        di: dst,
        mem: [
          [src, [0x34, 0x12]],
          [dst, [0x34, 0x22]],
        ],
      },
      { si: src + 2, di: dst + 2, flags: 'CF PF SF' },
    ],
    ['stosb', [0xaa], { ax: 0x1234, di: dst }, { di: dst + 1, mem: [[dst, [0x34]]] }],
    [
      'stosw',
      [0xab],
      { ax: 0x1234, di: dst, flags: 'DF' },
      {
        di: dst - 2,
        mem: [[dst, [0x34, 0x12]]],
      },
    ],
    ['lodsb', [0xac], { ax: 0x1234, si: src, mem: [[src, [0x77]]] }, { ax: 0x1277, si: src + 1 }],
    ['lodsw', [0xad], { si: src, mem: [[src, [0x34, 0x12]]] }, { ax: 0x1234, si: src + 2 }],
    [
      'scasb',
      [0xae],
      { ax: 0x0042, di: dst, mem: [[dst, [0x42]]] },
      {
        di: dst + 1,
        flags: 'PF ZF',
      },
    ],
    [
      'scasw',
      [0xaf],
      { ax: 0x0001, di: dst, mem: [[dst, [0x02, 0x00]]] },
      {
        di: dst + 2,
        flags: 'CF PF AF SF',
      },
    ],
    [
      'stosw',
      [0xab],
      { ax: 0xbeef, di: 0xffff },
      {
        di: 0x0001,
        mem: [
          [0xffff, [0xef]],
          [0, [0xbe]],
        ],
      },
    ],
    [
      'lodsw',
      [0xad],
      { si: 0x0000, flags: 'DF', mem: [[0, [0x34, 0x12]]] },
      {
        ax: 0x1234,
        si: 0xfffe,
      },
    ],
    [
      'movsw',
      [0xa5],
      {
        si: 0xffff,
        di: dst,
        mem: [
          [0xffff, [0x34]],
          [0, [0x12]],
        ],
      },
      {
        si: 0x0001,
        di: dst + 2,
        mem: [[dst, [0x34, 0x12]]],
      },
    ],
  ])

  describe('REP: one iteration per call (ISA §3.4)', () => {
    /** Steps until IP leaves the prefix; returns the outcome and IP after each call. */
    function drain(m: Machine): string[] {
      const trace: string[] = []
      for (let k = 0; k < 20; k++) {
        const out = m.step()
        trace.push(`${OUTCOMES[out]} ${hex(m.row[IP] as number)} cx=${m.row[CX]}`)
        if (out !== EXEC_JUMPED) break
      }
      return trace
    }

    it('rep movsw with CX = 3 takes exactly 3 calls, IP on F3 until the last', () => {
      const m = new Machine([0xf3, 0xa5], {
        si: src,
        di: dst,
        cx: 3,
        mem: [[src, [1, 2, 3, 4, 5, 6]]],
      })
      expect(OUTCOMES[m.step()]).toBe('jumped')
      expect(m.state()).toMatchObject({ ip: hex(BASE), cx: '0x0002', si: '0x2002', di: '0x3002' })
      expect(m.changes()).toEqual(written([[dst, [1, 2]]]))
      expect(OUTCOMES[m.step()]).toBe('jumped')
      expect(m.state()).toMatchObject({ ip: hex(BASE), cx: '0x0001', si: '0x2004', di: '0x3004' })
      expect(OUTCOMES[m.step()]).toBe('continue')
      expect(m.state()).toMatchObject({ ip: hex(BASE + 2), cx: '0x0000', si: '0x2006' })
      expect(m.changes()).toEqual(written([[dst, [1, 2, 3, 4, 5, 6]]]))
      expect(m.writes).toEqual([
        [dst, 2, TAG],
        [dst + 2, 2, TAG],
        [dst + 4, 2, TAG],
      ])
    })

    cases([
      // CX = 0: no iteration at all, and the instruction still costs its turn.
      ['rep movsw', [0xf3, 0xa5], { si: src, di: dst, mem: [[src, [1, 2]]] }],
      [
        'rep stosb',
        [0xf3, 0xaa],
        { ax: 0x0042, di: dst, cx: 1 },
        {
          cx: 0,
          di: dst + 1,
          mem: [[dst, [0x42]]],
        },
      ],
    ])

    it('rep stosw steps down with DF', () => {
      const m = new Machine([0xf3, 0xab], { ax: 0xbeef, di: dst, cx: 2, flags: 'DF' })
      expect(drain(m)).toEqual(['jumped 0x1000 cx=1', 'continue 0x1002 cx=0'])
      expect(m.changes()).toEqual(written([[dst - 2, [0xef, 0xbe, 0xef, 0xbe]]]))
      expect(hex(m.row[DI] as number)).toBe('0x2FFC')
    })

    it('rep lodsb loads CX bytes, one per call', () => {
      const m = new Machine([0xf3, 0xac], { si: src, cx: 2, mem: [[src, [0x11, 0x22]]] })
      expect(drain(m)).toEqual(['jumped 0x1000 cx=1', 'continue 0x1002 cx=0'])
      expect([hex(m.row[AX] as number), hex(m.row[SI] as number)]).toEqual(['0x0022', '0x2002'])
    })

    it('repe cmpsb stops at the first difference', () => {
      const m = new Machine([0xf3, 0xa6], {
        si: src,
        di: dst,
        cx: 5,
        mem: [
          [src, [1, 2, 3, 4, 5]],
          [dst, [1, 2, 9, 4, 5]],
        ],
      })
      expect(drain(m)).toEqual(['jumped 0x1000 cx=4', 'jumped 0x1000 cx=3', 'continue 0x1002 cx=2'])
      expect(m.state()).toMatchObject({ si: '0x2003', di: '0x3003', flags: 'CF PF AF SF' })
      expect(m.changes()).toEqual([])
    })

    it('repne scasb stops at a match', () => {
      const m = new Machine([0xf2, 0xae], {
        ax: 0x0042,
        di: dst,
        cx: 10,
        mem: [[dst, [0x10, 0x20, 0x42, 0x50]]],
      })
      expect(drain(m)).toEqual(['jumped 0x1000 cx=9', 'jumped 0x1000 cx=8', 'continue 0x1002 cx=7'])
      expect(m.state()).toMatchObject({ di: '0x3003', flags: 'PF ZF' })
    })

    it('repne scasb stops when CX runs out', () => {
      const m = new Machine([0xf2, 0xae], { ax: 0x0042, di: dst, cx: 2 })
      expect(drain(m)).toEqual(['jumped 0x1000 cx=1', 'continue 0x1002 cx=0'])
      expect(m.state()).toMatchObject({ di: '0x3002', flags: 'PF' })
    })
  })
})

describe('flag instructions (ISA §3.4, §3.5)', () => {
  cases([
    ['cld', [0xfc], { flags: 'CF DF' }, { flags: 'CF' }],
    ['std', [0xfd], { flags: 'CF' }, { flags: 'CF DF' }],
    ['clc', [0xf8], { flags: ALL }, { flags: 'PF AF ZF SF DF OF' }],
    ['stc', [0xf9], { flags: 'ZF' }, { flags: 'CF ZF' }],
    ['cmc', [0xf5], { flags: 'CF OF' }, { flags: 'OF' }],
    ['cmc', [0xf5], {}, { flags: 'CF' }],
    ['nop', [0x90], { ax: 1, sp: 2, flags: ALL }],
  ])
})

describe('SPL (ISA §3.6)', () => {
  const spawn = (target: number): Want => ({ out: EXEC_SPAWN, target })
  cases([
    ['spl $ + 2', [0x60, 0x00], { ax: 0x1234, flags: ALL }, spawn(BASE + 2)],
    ['spl $ + 0x300', [0x61, 0xfd, 0x02], {}, spawn(BASE + 0x300)],
    ['spl bx', [0x62, 0xc3], { bx: 0x4321 }, spawn(0x4321)],
    ['spl word [bx]', [0x62, 0x07], { bx: 0x2000, mem: [[0x2000, [0x78, 0x56]]] }, spawn(0x5678)],
    ['spl $ - 0x10', [0x60, 0xee], { ip: 0x0004 }, spawn(0xfff4)],
    ['spl $ + 2', [0x60, 0x00], { procs: 3, cap: 4 }, spawn(BASE + 2)],
    // At the cap SPL is a NOP: IP moves on, no child, no kill.
    ['spl $ + 2', [0x60, 0x00], { procs: 4, cap: 4, ax: 0x1234 }, { out: EXEC_CONTINUE }],
    ['spl bx', [0x62, 0xc3], { bx: 0x4321, procs: 1, cap: 1 }, { out: EXEC_CONTINUE }],
  ])
})

describe('every opcode and ModR/M byte', () => {
  /** Runs `code` at `ip` and checks the invariants every outcome keeps. Returns the mnemonic. */
  function probe(m: Machine, code: readonly number[], ip: number): string {
    const row = m.row
    // Straight into the bytes, so the load is not a write the core reports.
    code.forEach((b, k) => {
      m.core.bytes[(ip + k) & 0xffff] = b
    })
    row[IP] = ip
    const before = Array.from(row)
    const instr = m.fetcher.fetch(ip)
    const mnemonic = instr?.mnemonic ?? 'undefined'
    const length = instr?.length ?? 1
    const out = execOne(m.bot, row, m.core, instr, m.ctx)
    const f = row[FLAGS] as number
    expect([mnemonic, show(f & (FLAGS_INIT | ~FLAGS_WRITABLE))]).toEqual([mnemonic, ''])
    if (out === EXEC_KILLED) {
      expect([mnemonic, Array.from(row)]).toEqual([mnemonic, before])
      expect(['undefined', 'dat', 'hlt', 'int3', 'div']).toContain(m.ctx.reason)
    } else if (out === EXEC_CONTINUE || out === EXEC_SPAWN) {
      expect([mnemonic, row[IP]]).toEqual([mnemonic, (ip + length) & 0xffff])
    } else {
      expect([mnemonic, out]).toEqual([mnemonic, EXEC_JUMPED])
    }
    return mnemonic
  }

  it('executes all 65,536 two-byte starts and keeps the invariants', () => {
    const m = new Machine([], { cap: 4 })
    const seen = new Set<string>()
    for (let op = 0; op < 256; op++) {
      for (let b = 0; b < 256; b++) {
        const row = m.row
        row.set([0x1234, 3, 0x0002, 0x2000, 0x3000, 0x2400, 0x0100, 0x0200])
        row[FLAGS] = on('CF ZF')
        seen.add(probe(m, [op, b, 0x34, 0x12, 0x78, 0x56], BASE))
      }
    }
    for (const w of m.writes) expect(w[2]).toBe(TAG)
    expect([...seen].sort()).toEqual([...MNEMONICS, 'undefined'].sort())
  })

  it('keeps the invariants for 20,000 random instructions in random states', () => {
    const rng = new Pcg32(0x5eed, 3)
    const m = new Machine([], { cap: 2, procs: 1 })
    for (let a = 0; a < 0x10000; a++) m.core.bytes[a] = rng.next() & 0xff
    for (let k = 0; k < 20_000; k++) {
      const row = m.row
      for (let r = 0; r < 8; r++) row[r] = rng.next()
      row[FLAGS] = (rng.next() & FLAGS_WRITABLE) | FLAGS_INIT
      const code = Array.from({ length: 6 }, () => rng.next() & 0xff)
      probe(m, code, rng.nextInt(0x10000))
    }
    for (const w of m.writes) expect(w[2]).toBe(TAG)
  })
})
