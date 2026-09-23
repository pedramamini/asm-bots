import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assemble } from '../src/assemble'
import { type DisLine, disassemble } from '../src/disassemble'

const hex = (bytes: ArrayLike<number>) =>
  Array.from(bytes, (b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')

/** Bytes from hex pairs: `'B8 34 12'`. */
const bytes = (pairs: string) =>
  Uint8Array.from(pairs.split(' ').filter(Boolean), (p) => Number.parseInt(p, 16))

/** Each line as `address | bytes | kind | text`. */
const show = (lines: readonly DisLine[]) =>
  lines.map((l) => {
    const address = l.address.toString(16).toUpperCase().padStart(4, '0')
    return `${address} | ${l.bytesHex} | ${l.kind} | ${l.text}`
  })

const dis = (pairs: string, base?: number, symbols?: ReadonlyMap<number, string>) =>
  show(disassemble(bytes(pairs), base, { symbols }))

/** The texts of `lines` assembled from address 0; fails the test on any diagnostic. */
function reassemble(lines: readonly string[]): string {
  const { bytes, diagnostics } = assemble(`${lines.join('\n')}\n%name "x"`)
  expect(diagnostics).toEqual([])
  return hex(bytes)
}

const DWARF = assemble(
  readFileSync(join(import.meta.dir, 'fixtures', 'parse', 'dwarf.asm'), 'utf8'),
)

describe('disassemble', () => {
  it('disassembles the ISA §6 dwarf', () => {
    expect(show(disassemble(DWARF.bytes))).toEqual([
      '0000 | E8 00 00 | instr | call 0x0003',
      '0003 | 5B | instr | pop bx',
      '0004 | 83 EB 03 | instr | sub bx, 3',
      '0007 | 8D 7F 13 | instr | lea di, [bx+0x13]',
      '000A | 83 C7 04 | instr | add di, 4',
      '000D | C7 05 00 00 | instr | mov word [di], 0',
      '0011 | EB F7 | instr | jmp short 0x000A',
      '0013 | 00 00 | dat | dat',
    ])
    expect(disassemble(DWARF.bytes).map((l) => l.length)).toEqual([3, 1, 3, 3, 3, 4, 2, 2])
  })

  it('prints DAT, HLT, and INT3 as instructions, and an undefined byte as db 0xNN (ISA §7)', () => {
    expect(dis('00 00 00 41 F4 CC 0F')).toEqual([
      '0000 | 00 00 | dat | dat',
      '0002 | 00 41 | dat | dat 0x41',
      '0004 | F4 | hlt | hlt',
      '0005 | CC | int3 | int3',
      '0006 | 0F | undefined | db 0x0F',
    ])
  })

  it('goes on one byte after an undefined byte', () => {
    // `FE /7` is undefined, so its ModR/M byte F8 is the next instruction, `clc`.
    expect(dis('FE F8 90')).toEqual([
      '0000 | FE | undefined | db 0xFE',
      '0001 | F8 | instr | clc',
      '0002 | 90 | instr | nop',
    ])
    // A prefix without a string instruction, and a second prefix.
    expect(dis('F2 A4 F3 F3 A4')).toEqual([
      '0000 | F2 | undefined | db 0xF2',
      '0001 | A4 | instr | movsb',
      '0002 | F3 | undefined | db 0xF3',
      '0003 | F3 A4 | instr | rep movsb',
    ])
  })

  it('prints the first byte of an instruction that runs past the end as db, and goes on', () => {
    expect(dis('90 B8 40')).toEqual([
      '0000 | 90 | instr | nop',
      '0001 | B8 | undefined | db 0xB8',
      '0002 | 40 | instr | inc ax',
    ])
    expect(dis('B8 34')).toEqual([
      '0000 | B8 | undefined | db 0xB8',
      '0001 | 34 | undefined | db 0x34',
    ])
    expect(dis('00')).toEqual(['0000 | 00 | undefined | db 0x00'])
  })

  it('prints relative targets as absolute addresses, and wraps addresses at 64 KB', () => {
    expect(dis('EB FE E9 00 01 E8 00 00', 0x100)).toEqual([
      '0100 | EB FE | instr | jmp short 0x0100',
      '0102 | E9 00 01 | instr | jmp 0x0205',
      '0105 | E8 00 00 | instr | call 0x0108',
    ])
    expect(dis('75 F4 E2 FA 61 00 00 60 FE')).toEqual([
      '0000 | 75 F4 | instr | jnz 0xFFF6',
      '0002 | E2 FA | instr | loop 0xFFFE',
      '0004 | 61 00 00 | instr | spl near 0x0007',
      '0007 | 60 FE | instr | spl 0x0007',
    ])
    expect(dis('90 90 EB 20 90', 0xfffe)).toEqual([
      'FFFE | 90 | instr | nop',
      'FFFF | 90 | instr | nop',
      '0000 | EB 20 | instr | jmp short 0x0022',
      '0002 | 90 | instr | nop',
    ])
  })

  it('names a target that symbols names, with a $ before a reserved word', () => {
    const names = new Map([
      [0, 'ax'],
      [2, 'SHORT'],
      [4, 'loop'],
      [6, 'start.x'],
    ])
    // Each jump but the fifth targets itself. A value or an address that is not a target stays.
    expect(dis('EB FE EB FE E2 FE 74 FE EB 00 B8 00 00 8B 06 06 00', 0, names)).toEqual([
      '0000 | EB FE | instr | jmp short $ax',
      '0002 | EB FE | instr | jmp short $SHORT',
      '0004 | E2 FE | instr | loop loop',
      '0006 | 74 FE | instr | jz start.x',
      '0008 | EB 00 | instr | jmp short 0x000A',
      '000A | B8 00 00 | instr | mov ax, 0',
      '000D | 8B 06 06 00 | instr | mov ax, [word 0x0006]',
    ])
    // A target past either end of the core wraps, as addresses do.
    const wrapped = new Map([
      [0xfffe, 'top'],
      [0x0010, 'low'],
    ])
    expect(dis('EB FC', 0, wrapped)).toEqual(['0000 | EB FC | instr | jmp short top'])
    expect(dis('EB 10', 0xfffe, wrapped)).toEqual(['FFFE | EB 10 | instr | jmp short low'])
  })

  it('names targets so that the text assembles once the labels are back', () => {
    const symbols = new Map([...DWARF.symbols].map(([name, address]) => [address, name]))
    const lines = disassemble(DWARF.bytes, 0, { symbols })
    expect(lines.map((l) => l.text)).toContain('call start.here')
    expect(lines.map((l) => l.text)).toContain('jmp short start.loop')
    const labeled = lines.flatMap((l) => {
      const name = symbols.get(l.address)
      return name === undefined ? [l.text] : [`${name}:`, l.text]
    })
    expect(reassemble(labeled)).toBe(hex(DWARF.bytes))
    const reserved = disassemble(bytes('EB FE'), 0, { symbols: new Map([[0, 'ax']]) })
    expect(reassemble(['$ax:', ...reserved.map((l) => l.text)])).toBe('EB FE')
  })

  it('prints an instruction in the encoding the assembler does not make as its bytes', () => {
    expect(dis('03 D8 FF C3 80 C0 05 87 D8 8F C0 81 C0 05 00')).toEqual([
      '0000 | 03 D8 | instr | db 0x03, 0xD8 ; add bx, ax',
      '0002 | FF C3 | instr | db 0xFF, 0xC3 ; inc bx',
      '0004 | 80 C0 05 | instr | db 0x80, 0xC0, 0x05 ; add al, 5',
      '0007 | 87 D8 | instr | db 0x87, 0xD8 ; xchg ax, bx',
      '0009 | 8F C0 | instr | db 0x8F, 0xC0 ; pop ax',
      '000B | 81 C0 05 00 | instr | db 0x81, 0xC0, 0x05, 0x00 ; add ax, strict word 5',
    ])
    // The encodings the assembler makes, including the pinned ones, print as instructions.
    expect(dis('01 C3 43 04 05 93 58 05 05 00 8B 06 00 01 8B 47 00 E9 03 00')).toEqual([
      '0000 | 01 C3 | instr | add bx, ax',
      '0002 | 43 | instr | inc bx',
      '0003 | 04 05 | instr | add al, 5',
      '0005 | 93 | instr | xchg ax, bx',
      '0006 | 58 | instr | pop ax',
      '0007 | 05 05 00 | instr | add ax, strict word 5',
      '000A | 8B 06 00 01 | instr | mov ax, [word 0x0100]',
      '000E | 8B 47 00 | instr | mov ax, [byte bx+0]',
      '0011 | E9 03 00 | instr | jmp near 0x0017',
    ])
  })

  it('gives no lines for no bytes, and throws on a base it cannot use', () => {
    expect(disassemble(new Uint8Array(0))).toEqual([])
    expect(disassemble(new Uint8Array(0), 0xffff)).toEqual([])
    for (const base of [-1, 0x10000, 1.5, Number.NaN]) {
      expect(() => disassemble(bytes('90'), base)).toThrow(RangeError)
    }
  })
})
