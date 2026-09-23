import { describe, expect, it } from 'bun:test'
import { spell } from '../src/format'
import {
  decode,
  decodeInto,
  EncodeError,
  encode,
  type FormatOptions,
  format,
  type Instr,
  type Reader,
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

/** The decoding of hex bytes such as `'8B 4E 00'`. */
const at = (text: string) => decode(reader(bytesOf(text)), 0)
const fmt = (text: string, opts?: FormatOptions) => format(at(text), opts)

/** The bytes in hex, or the error code. */
const show = (r: Uint8Array | EncodeError) => (r instanceof EncodeError ? r.code : hex(r))

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
]

describe('format: ISA §8 vectors', () => {
  for (const [source, bytes] of ISA_VECTORS) {
    it(`formats ${bytes} as ${source}`, () => {
      expect(fmt(bytes)).toBe(source)
      expect(fmt(bytes, { upper: true }).toLowerCase()).toBe(source)
    })
  }

  it('formats 62 03, printed in ISA §8 as `spl bx`, as spl word [bp+di] per ISA §2.2', () => {
    expect(fmt('62 03')).toBe('spl word [bp+di]')
  })
})

describe('format: memory operands', () => {
  it('writes every ISA §2.2 effective address in every mod', () => {
    const EA = ['bx+si', 'bx+di', 'bp+si', 'bp+di', 'si', 'di', 'bp', 'bx']
    // 8B /r with reg=cx; disp8 9C is -100, disp16 34 12 is 0x1234.
    for (const rm of range(0, 7)) {
      const ea = EA[rm]
      expect(fmt(`8B ${hex([0x08 | rm])} 34 12`)).toBe(
        rm === 6 ? 'mov cx, [0x1234]' : `mov cx, [${ea}]`,
      )
      expect(fmt(`8B ${hex([0x48 | rm])} 9C`)).toBe(`mov cx, [${ea}-0x64]`)
      expect(fmt(`8B ${hex([0x88 | rm])} 34 12`)).toBe(`mov cx, [${ea}+0x1234]`)
    }
  })

  it('writes [bp] for its disp8 0, a bare address as 4 hex digits, and displacements signed', () => {
    expect(fmt('8B 4E 00')).toBe('mov cx, [bp]')
    expect(fmt('8B 0E 05 00')).toBe('mov cx, [0x0005]')
    expect(fmt('8B 0E FE FF')).toBe('mov cx, [0xFFFE]')
    expect(fmt('A0 FE FF')).toBe('mov al, [0xFFFE]')
    expect(fmt('8B 4F FE')).toBe('mov cx, [bx-2]')
    expect(fmt('8B 4F 7F')).toBe('mov cx, [bx+0x7F]')
    expect(fmt('8B 4F 80')).toBe('mov cx, [bx-0x80]')
    expect(fmt('8B 8F FF 7F')).toBe('mov cx, [bx+0x7FFF]')
    expect(fmt('8B 8F 00 80')).toBe('mov cx, [bx-0x8000]')
  })

  it('leaves out the data size when a register gives it', () => {
    expect(fmt('88 07')).toBe('mov [bx], al')
    expect(fmt('8B 07')).toBe('mov ax, [bx]')
    expect(fmt('A2 00 01')).toBe('mov [0x0100], al')
    expect(fmt('87 07')).toBe('xchg [bx], ax')
    expect(fmt('84 07')).toBe('test [bx], al')
    expect(fmt('8D 07')).toBe('lea ax, [bx]')
  })

  it('writes the data size when no register gives it (ISA §6.3)', () => {
    expect(fmt('FE 07')).toBe('inc byte [bx]')
    expect(fmt('FF 07')).toBe('inc word [bx]')
    expect(fmt('8F 07')).toBe('pop word [bx]')
    expect(fmt('FF 27')).toBe('jmp word [bx]')
    expect(fmt('FF 17')).toBe('call word [bx]')
    expect(fmt('62 07')).toBe('spl word [bx]')
    expect(fmt('F6 27')).toBe('mul byte [bx]')
    expect(fmt('C6 06 00 01 05')).toBe('mov byte [0x0100], 5')
    expect(fmt('F7 07 05 00')).toBe('test word [bx], 5')
    expect(fmt('D1 27')).toBe('shl word [bx], 1')
    // A shift count in CL gives no size.
    expect(fmt('D2 27')).toBe('shl byte [bx], cl')
    expect(fmt('D3 3F')).toBe('sar word [bx], cl')
  })
})

describe('format: numbers and targets', () => {
  it('writes magnitudes below 16 in decimal and larger ones in hex', () => {
    expect(fmt('B0 0F')).toBe('mov al, 15')
    expect(fmt('B0 10')).toBe('mov al, 0x10')
    expect(fmt('B0 FF')).toBe('mov al, 0xFF')
    expect(fmt('B8 FF FF')).toBe('mov ax, 0xFFFF')
    expect(fmt('C2 04 00')).toBe('ret 4')
    expect(fmt('A8 80')).toBe('test al, 0x80')
  })

  it('writes the sign-extended immediate of 83 /n signed', () => {
    expect(fmt('83 C3 FF')).toBe('add bx, -1')
    expect(fmt('83 C3 80')).toBe('add bx, -0x80')
    expect(fmt('83 C3 7F')).toBe('add bx, 0x7F')
    expect(fmt('83 67 02 F0')).toBe('and word [bx+2], -0x10')
  })

  it('writes relative targets as $ + N and $ - N from the start of the instruction', () => {
    expect(fmt('75 00')).toBe('jnz $ + 2')
    expect(fmt('75 7F')).toBe('jnz $ + 0x81')
    expect(fmt('75 80')).toBe('jnz $ - 0x7E')
    expect(fmt('E3 FE')).toBe('jcxz $')
    expect(fmt('E8 FD 7F')).toBe('call $ + 0x8000')
    expect(fmt('E8 00 80')).toBe('call $ - 0x7FFD')
  })
})

describe('format: sizes the encoder would choose otherwise are pinned', () => {
  it('pins a displacement longer than the shortest', () => {
    expect(fmt('8B 47 00')).toBe('mov ax, [byte bx+0]')
    expect(fmt('8B 42 00')).toBe('mov ax, [byte bp+si+0]')
    expect(fmt('8B 87 00 00')).toBe('mov ax, [word bx+0]')
    expect(fmt('8B 86 00 00')).toBe('mov ax, [word bp+0]')
    expect(fmt('8B 87 FE FF')).toBe('mov ax, [word bx-2]')
    expect(fmt('8B 87 7F 00')).toBe('mov ax, [word bx+0x7F]')
    expect(fmt('8B 87 80 FF')).toBe('mov ax, [word bx-0x80]')
    // Shortest already: no pin.
    expect(fmt('8B 87 80 00')).toBe('mov ax, [bx+0x80]')
    expect(fmt('8B 87 7F FF')).toBe('mov ax, [bx-0x81]')
    expect(fmt('8B 46 00')).toBe('mov ax, [bp]')
  })

  it('pins a ModR/M bare address that mov with AL or AX would put in A0..A3', () => {
    expect(fmt('8B 06 00 01')).toBe('mov ax, [word 0x0100]')
    expect(fmt('8A 06 00 01')).toBe('mov al, [word 0x0100]')
    expect(fmt('88 06 00 01')).toBe('mov [word 0x0100], al')
    expect(fmt('89 06 00 01')).toBe('mov [word 0x0100], ax')
    // No A0..A3 form: no pin.
    expect(fmt('8A 26 00 01')).toBe('mov ah, [0x0100]')
    expect(fmt('03 06 00 01')).toBe('add ax, [0x0100]')
    expect(fmt('87 06 00 01')).toBe('xchg [0x0100], ax')
  })

  it('pins a 16-bit ALU immediate that 83 /n could hold', () => {
    expect(fmt('81 C3 05 00')).toBe('add bx, strict word 5')
    expect(fmt('81 C3 7F 00')).toBe('add bx, strict word 0x7F')
    expect(fmt('81 C3 80 FF')).toBe('add bx, strict word 0xFF80')
    expect(fmt('81 C3 FF FF')).toBe('add bx, strict word 0xFFFF')
    expect(fmt('05 05 00')).toBe('add ax, strict word 5')
    expect(fmt('3D FF FF')).toBe('cmp ax, strict word 0xFFFF')
    expect(fmt('81 07 05 00')).toBe('add word [bx], strict word 5')
    // Out of 83 /n range, or no 83 /n form: no pin.
    expect(fmt('81 C3 80 00')).toBe('add bx, 0x80')
    expect(fmt('81 C3 7F FF')).toBe('add bx, 0xFF7F')
    expect(fmt('B8 05 00')).toBe('mov ax, 5')
    expect(fmt('A9 05 00')).toBe('test ax, 5')
    expect(fmt('C7 07 05 00')).toBe('mov word [bx], 5')
  })

  it('writes every rel8 jmp as jmp short, and pins rel16 where rel8 reaches', () => {
    expect(fmt('EB 7F')).toBe('jmp short $ + 0x81')
    expect(fmt('EB 80')).toBe('jmp short $ - 0x7E')
    expect(fmt('E9 02 00')).toBe('jmp near $ + 5')
    expect(fmt('E9 7E 00')).toBe('jmp near $ + 0x81')
    expect(fmt('E9 7F FF')).toBe('jmp near $ - 0x7E')
    expect(fmt('61 00 00')).toBe('spl near $ + 3')
    // Out of rel8 range, or no rel8 form: no pin.
    expect(fmt('E9 7F 00')).toBe('jmp $ + 0x82')
    expect(fmt('E9 7E FF')).toBe('jmp $ - 0x7F')
    expect(fmt('61 7F 00')).toBe('spl $ + 0x82')
    expect(fmt('E8 00 00')).toBe('call $ + 3')
  })

  it('pins every operand that needs it', () => {
    expect(fmt('81 47 00 05 00')).toBe('add word [byte bx+0], strict word 5')
  })
})

describe('format: kills and undefined bytes', () => {
  it('writes dat, dat imm8, hlt, and int3', () => {
    expect(fmt('00 00')).toBe('dat')
    expect(fmt('00 05')).toBe('dat 5')
    expect(fmt('00 41')).toBe('dat 0x41')
    expect(fmt('00 FF')).toBe('dat 0xFF')
    expect(fmt('F4')).toBe('hlt')
    expect(fmt('CC')).toBe('int3')
  })

  it('writes an undefined byte as db 0xNN', () => {
    expect(fmt('0F')).toBe('db 0x0F')
    expect(fmt('26')).toBe('db 0x26')
    expect(fmt('FF FF')).toBe('db 0xFF')
    // A prefix before anything but a string op.
    expect(fmt('F3 90')).toBe('db 0xF3')
  })

  it('takes a Decoded, its Instr, or the instruction decodeInto fills', () => {
    const bytes = bytesOf('81 47 00 05 00')
    const d = decode(reader(bytes), 0)
    const out: Instr = { mnemonic: 'nop', operands: [], length: 1 }
    expect(decodeInto(reader(bytes), 0, out)).toBe(5)
    expect(d.ok && format(d.instr)).toBe(format(d))
    expect(format(out)).toBe(format(d))
    expect(spell(out)).toEqual(d.ok ? spell(d.instr) : { mnemonic: 'nop', operands: [] })
  })
})

describe('format: options', () => {
  it('writes relative targets as absolute addresses, wrapping, given a base', () => {
    expect(fmt('EB FE', { base: 0x1a2f })).toBe('jmp short 0x1A2F')
    expect(fmt('75 F4', { base: 0x1a2f })).toBe('jnz 0x1A25')
    expect(fmt('E8 00 00', { base: 0x100 })).toBe('call 0x0103')
    expect(fmt('E9 02 00', { base: 0x100 })).toBe('jmp near 0x0105')
    expect(fmt('60 00', { base: 0x100 })).toBe('spl 0x0102')
    expect(fmt('EB 1E', { base: 0xfff0 })).toBe('jmp short 0x0010')
    expect(fmt('E2 FA', { base: 0 })).toBe('loop 0xFFFC')
  })

  it('writes hex as 1Fh with hexStyle h, with a 0 before a leading letter', () => {
    const h = { hexStyle: 'h' } as const
    expect(fmt('B8 34 12', h)).toBe('mov ax, 1234h')
    expect(fmt('B0 FF', h)).toBe('mov al, 0FFh')
    expect(fmt('83 C3 04', h)).toBe('add bx, 4')
    expect(fmt('83 C3 80', h)).toBe('add bx, -80h')
    expect(fmt('A1 00 01', h)).toBe('mov ax, [0100h]')
    expect(fmt('8B 87 60 FF', h)).toBe('mov ax, [bx-0A0h]')
    expect(fmt('E9 FD 01', h)).toBe('jmp $ + 200h')
    expect(fmt('EB FE', { ...h, base: 0xfffe })).toBe('jmp short 0FFFEh')
    expect(fmt('0F', h)).toBe('db 0Fh')
    expect(fmt('C8', h)).toBe('db 0C8h')
  })

  it('writes mnemonics, prefixes, registers, and keywords in uppercase with upper', () => {
    const up = { upper: true } as const
    expect(fmt('F3 A5', up)).toBe('REP MOVSW')
    expect(fmt('C6 40 04 41', up)).toBe('MOV BYTE [BX+SI+4], 0x41')
    expect(fmt('81 47 00 05 00', up)).toBe('ADD WORD [BYTE BX+0], STRICT WORD 5')
    expect(fmt('8B 06 00 01', up)).toBe('MOV AX, [WORD 0x0100]')
    expect(fmt('EB FE', up)).toBe('JMP SHORT $')
    expect(fmt('E9 02 00', up)).toBe('JMP NEAR $ + 5')
    expect(fmt('00 41', up)).toBe('DAT 0x41')
    expect(fmt('0F', up)).toBe('DB 0x0F')
    expect(fmt('B0 FF', { ...up, hexStyle: 'h' })).toBe('MOV AL, 0FFh')
  })
})

describe('format: every decodable two-byte start', () => {
  /** Displacements, immediates, and rel16 targets on both sides of every pin boundary. */
  const TAILS = [
    [0x00, 0x00, 0x00, 0x00],
    [0x7f, 0x00, 0x7f, 0x00],
    [0x80, 0x00, 0x80, 0x00],
    [0x7f, 0xff, 0x7f, 0xff],
    [0x80, 0xff, 0x80, 0xff],
    [0x9c, 0x80, 0x01, 0x80],
  ]

  it('spells input that encodes to the bytes of the instruction, with one text per encoding', () => {
    const wrong: string[] = []
    const texts = new Map<string, string>()
    let checked = 0
    for (const tail of TAILS) {
      for (const b0 of range(0, 255)) {
        for (const b1 of range(0, 255)) {
          const bytes = [b0, b1, ...tail]
          const d = decode(reader(bytes), 0)
          if (!d.ok && d.reason === 'undefined') continue
          checked++
          const text = format(d)
          const want = show(encode(d.instr))
          const got = show(encode(spell(d.instr)))
          const tag = `${hex(bytes.slice(0, d.length))} \`${text}\``
          if (got !== want) wrong.push(`${tag}: ${got}, not ${want}`)
          const other = texts.get(text)
          if (other !== undefined && other !== want) wrong.push(`${tag}: ${want} and ${other}`)
          texts.set(text, want)
          if (/undefined|NaN/.test(text)) wrong.push(tag)
        }
      }
    }
    expect(checked).toBeGreaterThan(270_000)
    expect(wrong.slice(0, 20)).toEqual([])
  })
})
