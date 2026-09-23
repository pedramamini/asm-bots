import { describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hasNasm } from '../../../scripts/has-nasm'
import { type Assembled, type AssembleOptions, assemble } from '../src/assemble'
import type { Diag } from '../src/diag'

const hex = (bytes: ArrayLike<number>) =>
  Array.from(bytes, (b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')

/** `source` as a bot: the `%name` line goes last, so line numbers stay as written. */
const bot = (source: string) => `${source}\n%name "test"`

const run = (source: string, opts?: AssembleOptions): Assembled => assemble(bot(source), opts)

/** The bytes of `source` in hex; fails the test on any diagnostic. */
function bytesOf(source: string, opts?: AssembleOptions): string {
  const { bytes, diagnostics } = run(source, opts)
  expect(diagnostics).toEqual([])
  return hex(bytes)
}

/** Diagnostics as `line:col+len code`, the way an editor would place them. */
const where = (d: Diag) => `${d.line}:${d.col}+${d.len} ${d.code}`

const places = (source: string, opts?: AssembleOptions) => run(source, opts).diagnostics.map(where)

/** A deterministic stream of bytes (the codec fuzz test's generator, another seed). */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0
    return s >>> 24
  }
}

/** ISA §8, as the codec tests transcribe it. */
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
  // ISA §8 prints `62 03`, which ISA §2.2 reads as `spl [bp+di]` (see the codec's decode.test.ts).
  ['spl bx', '62 C3'],
  ['dat', '00 00'],
  ['hlt', 'F4'],
  ['int3', 'CC'],
  ['nop', '90'],
  ['lea si, [bx+di-2]', '8D 71 FE'],
]

describe('assemble: ISA §8 vectors', () => {
  for (const [source, bytes] of ISA_VECTORS) {
    it(`assembles \`${source}\` to ${bytes}`, () => {
      expect(bytesOf(source)).toBe(bytes)
    })
  }

  it('assembles all of them as one bot, since each target is relative to its own `$`', () => {
    const source = ISA_VECTORS.map(([s]) => s).join('\n')
    expect(bytesOf(source)).toBe(ISA_VECTORS.map(([, b]) => b).join(' '))
  })
})

describe('assemble: symbols', () => {
  it('resolves forward and backward references', () => {
    const source = [
      'start:  jmp     fwd',
      'back:   nop',
      'fwd:    jmp     back',
      '        dw      start, back, fwd, end',
      'end:',
    ].join('\n')
    const { bytes, symbols } = run(source)
    expect(hex(bytes)).toBe('EB 01 90 EB FD 00 00 02 00 03 00 0D 00')
    expect([...symbols]).toEqual([
      ['start', 0],
      ['back', 2],
      ['fwd', 3],
      ['end', 13],
    ])
  })

  it('gives a forward value the shortest field once it is known', () => {
    // NASM keeps a 16-bit field for any label value; x16c sizes it by the value, as `encode` does.
    expect(bytesOf('add bx, fwd\nmov ax, [bx+fwd]\nfwd:')).toBe('83 C3 06 8B 47 06')
    expect(bytesOf('add bx, fwd\ntimes 200 nop\nfwd:')).toMatch(/^81 C3 CC 00 90/)
    expect(bytesOf('mov ax, [bx+start]\nstart: nop')).toBe('8B 47 03 90')
    expect(bytesOf('start: mov ax, [bx+start]')).toBe('8B 07')
  })

  it('guesses a 16-bit field for a value the first pass cannot compute', () => {
    // Both sizes are consistent here: 3 bytes make the value 96, 4 make it 128. x16c starts
    // from the long form and stays there; NASM starts short and ends at `83 C3 60`.
    expect(bytesOf('a: add bx, (b - a) * 32\nb:')).toBe('81 C3 80 00')
    expect(bytesOf('a: nop\nb: add bx, (b - a) * 32')).toBe('90 83 C3 20')
  })

  it('scopes .local labels to the global label before them', () => {
    const source = [
      'one:    nop',
      '.loop:  jmp     .loop',
      'two:    nop',
      '.loop:  jmp     .loop',
      '        jmp     one.loop',
    ].join('\n')
    const { bytes, symbols, diagnostics } = run(source)
    expect(diagnostics).toEqual([])
    expect(hex(bytes)).toBe('90 EB FE 90 EB FE EB F9')
    expect([...symbols]).toEqual([
      ['one', 0],
      ['one.loop', 1],
      ['two', 3],
      ['two.loop', 4],
    ])
  })

  it('computes the `end - start` size, before or after the labels', () => {
    const source = [
      'size    equ     end - start',
      'start:  mov     cx, (end - start) / 2',
      '        rep     movsw',
      '        dw      end - start, size',
      'end:',
    ].join('\n')
    const { bytes, symbols } = run(source)
    expect(hex(bytes)).toBe('B9 04 00 F3 A5 09 00 09 00')
    expect(symbols.get('size')).toBe(9)
  })

  it('computes `equ`s in any order, from exact values', () => {
    const source = [
      'a       equ     b + 1',
      'b       equ     c * 2',
      'c       equ     0x10000',
      'here    equ     $',
      '        nop',
      'there   equ     $',
      '        dw      a, b / 4, here, there',
    ].join('\n')
    const { bytes, symbols } = run(source)
    // `b` is 0x20000: it wraps only in the `dw`, after the division.
    expect(hex(bytes)).toBe('90 01 00 00 80 00 00 01 00')
    expect(symbols.get('b')).toBe(0x20000)
    // Each `equ` uses the next one: all 100 settle in one pass.
    const chain = Array.from({ length: 100 }, (_, i) => `e${i} equ e${i + 1} + 1`)
    expect(bytesOf([...chain, 'e100 equ 0', 'mov ax, e0'].join('\n'))).toBe('B8 64 00')
  })

  it('reports an undefined symbol at its use', () => {
    expect(places('mov ax, nope\njmp .x')).toEqual([
      '1:9+4 undefined-symbol',
      '2:5+2 undefined-symbol',
    ])
  })

  it('reports an `equ` without a value once, where it is defined', () => {
    expect(places('x equ nope\nmov ax, x\nmov bx, x')).toEqual(['1:7+4 undefined-symbol'])
    expect(places('a equ b + 1\nb equ nope\nmov ax, a')).toEqual(['2:7+4 undefined-symbol'])
    expect(places('a equ 1 / 0\ndw a')).toEqual(['1:11+1 div-zero'])
  })

  it('reports each `equ` on a cycle, and not the ones that only use it', () => {
    const { diagnostics } = run('x equ y\ny equ x + 1\nz equ x\nself equ self\nmov ax, z')
    expect(diagnostics.map((d) => [where(d), d.message])).toEqual([
      ['1:7+1 circular-equ', '`x` is defined in terms of itself: x → y → x'],
      ['2:7+1 circular-equ', '`y` is defined in terms of itself: y → x → y'],
      ['4:10+4 circular-equ', '`self` is defined in terms of itself'],
    ])
  })

  it('shortens a long cycle in the message', () => {
    const source = Array.from({ length: 10 }, (_, i) => `c${i} equ c${(i + 1) % 10}`).join('\n')
    const { diagnostics } = run(source)
    expect(diagnostics).toHaveLength(10)
    expect(diagnostics[3]?.message).toBe(
      '`c3` is defined in terms of itself: c3 → c4 → c5 → c6 → c7 → c8 → … → c3',
    )
  })

  it('rejects a name defined twice, and keeps the first', () => {
    const { diagnostics, symbols } = run('a: nop\na: nop\nsize equ 1\nsize equ 2\nb: dw a, size')
    expect(diagnostics.map((d) => [where(d), d.message])).toEqual([
      ['2:1+1 duplicate-symbol', '`a` is already defined on line 1'],
      ['4:1+4 duplicate-symbol', '`size` is already defined on line 3'],
    ])
    expect([...symbols]).toEqual([
      ['a', 0],
      ['size', 1],
      ['b', 2],
    ])
  })
})

describe('assemble: jump sizes', () => {
  it('lets an upgrade push another jump out of rel8 range, and upgrades that one too', () => {
    const source = [
      'start:  jmp     a               ; 127 ahead while `jmp b` is short',
      '        jmp     b               ; too far: its rel16 pushes `a` out of reach',
      '        times   125 nop',
      'a:      nop',
      '        times   200 nop',
      'b:      nop',
    ].join('\n')
    const { bytes, symbols } = run(source)
    expect(hex(bytes.subarray(0, 6))).toBe('E9 80 00 E9 46 01')
    expect(symbols.get('a')).toBe(131)
    // With `b` in reach, neither moves.
    const near = bytesOf('jmp a\njmp b\ntimes 125 nop\na: nop\nb: nop')
    expect(near.slice(0, 11)).toBe('EB 7F EB 7E')
  })

  it('settles a cascade of upgrades, one per pass, and reports one too long to settle', () => {
    const settled = run(cascade(10))
    expect(settled.diagnostics).toEqual([])
    const opcodes = Array.from({ length: 10 }, (_, k) => settled.bytes[3 * k])
    expect(opcodes).toEqual(Array.from({ length: 10 }, () => 0xe9))
    // Pass p moves up jump 32 - p, so pass 16 is still moving jump 16.
    const { diagnostics, bytes } = run(cascade(30))
    expect(diagnostics.map((d) => [where(d), d.message])).toEqual([
      [
        '16:1+7 no-convergence',
        'assembly did not converge: the size of this line still changed in pass 16',
      ],
    ])
    expect(bytes).toHaveLength(0)
  })

  it('keeps a jump at rel16 once it moves up, even when a later pass would let it back', () => {
    // Pass 1 guesses both `add`s long, which puts `t` out of rel8 reach in pass 2. Then they
    // shrink and rel8 would reach `t` again, but the jump stays near: sizes that only grow settle.
    const source = 'jmp t\nadd bx, x\nadd bx, x\nx: times 120 nop\nt: nop'
    expect(bytesOf(source)).toMatch(/^E9 7E 00 83 C3 09 83 C3 09 90/)
  })

  it('reports sizes that never settle', () => {
    // Short, the value is 128 and needs the long form; long, it is 127 and fits the short one.
    const { diagnostics } = run('a: add bx, 131 - (b - a)\nb:')
    expect(diagnostics.map(where)).toEqual(['1:4+21 no-convergence'])
  })

  it('never shrinks a jump, and follows `short` and `near`', () => {
    expect(bytesOf('jmp near $\njmp short $\ncall $\nspl near $')).toBe(
      'E9 FD FF EB FE E8 FD FF 61 FD FF',
    )
    expect(bytesOf('spl fwd\ntimes 126 nop\nfwd:')).toMatch(/^60 7E/)
    expect(bytesOf('spl fwd\ntimes 200 nop\nfwd:')).toMatch(/^61 C8 00/)
  })

  it('reports a conditional jump out of range at its target', () => {
    const { diagnostics } = run('start: jz far_label\ntimes 200 nop\nfar_label: nop')
    expect(diagnostics).toEqual([
      {
        severity: 'error',
        line: 1,
        col: 11,
        len: 9,
        message: 'jump out of range',
        code: 'jump-out-of-range',
      },
    ])
    expect(places('loop $ + 200\njmp short $ + 200\njcxz $ - 200')).toEqual([
      '1:6+7 jump-out-of-range',
      '2:5+13 jump-out-of-range',
      '3:6+7 jump-out-of-range',
    ])
    expect(places('jz near $')).toEqual(['1:4+6 size-mismatch'])
  })
})

/**
 * `n` forward jumps in a row. With every jump short, jump n - j reaches its target from 128 - j
 * bytes: each jump after it that moves up to rel16 moves the target one byte further, and the
 * last jump starts too far. So one jump moves up per pass, from the last to the first.
 */
function cascade(n: number): string {
  const jumps = Array.from({ length: n }, (_, k) => `jmp t${k + 1}`)
  // Sled offsets: t(n-j) at 128 - 3j, t(n) at 300.
  const offsets = new Map<number, number>([[n, 300]])
  for (let j = 1; j < n; j++) offsets.set(n - j, 128 - 3 * j)
  const sled: string[] = []
  let at = 0
  for (const [k, offset] of [...offsets].sort((a, b) => a[1] - b[1])) {
    sled.push(`times ${offset - at} nop`, `t${k}:`)
    at = offset
  }
  return [...jumps, ...sled, 'nop'].join('\n')
}

describe('assemble: encoder errors', () => {
  it('points `operation size not specified` at the [ of the memory operand', () => {
    const { diagnostics } = run('        mov     [bx], 0')
    expect(diagnostics).toEqual([
      {
        severity: 'error',
        line: 1,
        col: 17,
        len: 4,
        message: 'operation size not specified',
        code: 'size-not-specified',
      },
    ])
  })

  it('gives the ISA §9.1 DAT message for `add byte [bx], al`', () => {
    const { diagnostics } = run('add byte [bx], al')
    expect(diagnostics).toEqual([
      {
        severity: 'error',
        line: 1,
        col: 5,
        len: 9,
        message:
          'this form encodes as 0x00 (DAT) and is unavailable; use `add <mem8>, imm8` or a word operation',
        code: 'dat-form',
      },
    ])
  })

  it('reports every other encoder error with its code, at the operand when it names one', () => {
    expect(places('mov al, 300\nrep add ax, 1\nnop 1\nmov ax, bl\npush')).toEqual([
      '1:9+3 out-of-range',
      '2:1+13 invalid-prefix',
      '3:1+5 invalid-operands',
      '4:1+10 size-mismatch',
      '5:1+4 invalid-operands',
    ])
  })

  it('keeps the size of a line the encoder refuses, so the lines after it stay in place', () => {
    // `mov al, imm8` takes 2 bytes whatever the value, so `target` is out of the jump's reach.
    expect(places('jz target\nmov al, 300\ntimes 126 nop\ntarget:')).toEqual([
      '1:4+6 jump-out-of-range',
      '2:9+3 out-of-range',
    ])
  })

  it('reads a size on an immediate the way NASM does', () => {
    expect(bytesOf('add ax, byte 5\nadd [bx], byte 5\nadd [bx], word 5')).toBe(
      '83 C0 05 80 07 05 83 07 05',
    )
    expect(bytesOf('mov [bx], word 5\nadd bx, word 5\nshl ax, byte 1')).toBe(
      'C7 07 05 00 83 C3 05 D1 E0',
    )
    expect(bytesOf('add ax, strict word 5\nadd word [bx], strict byte 5')).toBe('05 05 00 83 07 05')
    expect(places('mov ax, byte 5\nmov al, word 5\nadd word [bx], byte 200')).toEqual([
      '1:1+14 size-mismatch',
      '2:1+14 size-mismatch',
      '3:16+8 out-of-range',
    ])
  })
})

describe('assemble: data, times, align', () => {
  it('emits db, dw, resb, and resw', () => {
    expect(bytesOf('db "hé", 0, -1, 255, -256\ndw 0x1234, -2\nresb 2\nresw 1')).toBe(
      '68 C3 A9 00 FF FF 00 34 12 FE FF 00 00 00 00',
    )
    expect(places('db 256, -257\ndb nope')).toEqual([
      '1:4+3 out-of-range',
      '1:9+4 out-of-range',
      '2:4+4 undefined-symbol',
    ])
  })

  it('repeats with times: `times 16 dat` is 32 zero bytes', () => {
    expect(bytesOf('times 16 dat')).toBe(Array.from({ length: 32 }, () => '00').join(' '))
    expect(bytesOf('times 2 db 1, 2\ntimes 3 rep movsb\ntimes 0 nop')).toBe(
      '01 02 01 02 F3 A4 F3 A4 F3 A4',
    )
  })

  it('keeps `$` at the times line for every repeat and counts each target from its repeat', () => {
    // NASM 3.02 assembles this source to these bytes.
    const source = [
      'nop',
      'times 3 jmp $',
      'times 3 mov ax, $',
      'times 2 dw $',
      'times 2 db $-$$',
      'times 2 add bx, $-$$',
    ].join('\n')
    expect(bytesOf(source)).toBe(
      '90 EB FE EB FC EB FA B8 07 00 B8 07 00 B8 07 00 10 00 10 00 14 14 83 C3 16 83 C3 16',
    )
  })

  it('sizes the jumps of a times body repeat by repeat, as NASM does', () => {
    const want: string[] = []
    for (let k = 0, at = 0; k < 70; k++) {
      const short = -(at + 2) >= -128
      const disp = short ? -(at + 2) : -(at + 3)
      want.push(short ? `EB ${hex([disp & 0xff])}` : `E9 ${hex([disp & 0xff, (disp >> 8) & 0xff])}`)
      at += short ? 2 : 3
    }
    expect(bytesOf('start: times 70 jmp start')).toBe(want.join(' '))
    expect(want.slice(63, 66)).toEqual(['EB 80', 'E9 7D FF', 'E9 7A FF'])
  })

  it('checks counts, and reports only undefined symbols in a body repeated 0 times', () => {
    expect(places('times -1 nop\nresb 0x10000\nN equ -2\nresw N\ntimes x nop')).toEqual([
      '1:7+2 bad-directive',
      '2:6+7 bad-directive',
      '4:6+1 bad-directive',
      '5:7+1 undefined-symbol',
    ])
    expect(places('times 0 db nope\ntimes 0 mov [bx], 0\ntimes 0 jz $ + 500')).toEqual([
      '1:12+4 undefined-symbol',
    ])
  })

  it('reports the first error of a times body once', () => {
    expect(places('times 5 mov [bx], 0\ntimes 100 jz $')).toEqual([
      '1:13+4 size-not-specified',
      '2:14+1 jump-out-of-range',
    ])
  })

  it('pads with zeros (DAT) to a power of 2', () => {
    expect(bytesOf('nop\nalign 4\nnop\nalign 1\nalign 2')).toBe('90 00 00 00 90 00')
    expect(places('align 3\nalign 0\nalign -4\nalign 0x20000')).toEqual([
      '1:7+1 bad-directive',
      '2:7+1 bad-directive',
      '3:7+2 bad-directive',
      '4:7+7 bad-directive',
    ])
  })
})

describe('assemble: metadata and limits', () => {
  it('reads the metadata directives', () => {
    const r = assemble(
      '%name "Dwarf"\n%author "A. K. Dewdney"\n%strategy "Bombs."\n%version "1"\nnop',
    )
    expect(r.diagnostics).toEqual([])
    expect([r.name, r.author, r.strategy, r.version, r.entry]).toEqual([
      'Dwarf',
      'A. K. Dewdney',
      'Bombs.',
      '1',
      0,
    ])
    expect(assemble('%name "x"').author).toBe('')
  })

  it('requires one %name that is not empty', () => {
    const missing = assemble('nop')
    expect(missing.diagnostics).toEqual([
      {
        severity: 'error',
        line: 1,
        col: 1,
        len: 0,
        message: 'a bot needs a name: add a `%name "..."` line',
        code: 'missing-name',
      },
    ])
    expect(missing.bytes).toHaveLength(0)
    expect(
      assemble('%name "a"\n%name "b"\n%author "x"\n%author "y"').diagnostics.map(where),
    ).toEqual(['2:1+9 bad-directive', '4:1+11 bad-directive'])
    expect(assemble('%name "  "').diagnostics.map(where)).toEqual(['1:7+4 bad-directive'])
    // The parser's error for a broken %name line is enough.
    expect(assemble('%name').diagnostics.map(where)).toEqual(['1:6+0 bad-directive'])
  })

  it('rejects a bot over the size limit, at the line that crosses it', () => {
    const over = run('nop\ntimes 600 nop\nnop')
    expect(over.diagnostics).toEqual([
      {
        severity: 'error',
        line: 2,
        col: 1,
        len: 13,
        message: 'the bot is 602 bytes, 90 over the limit of 512',
        code: 'size-over-cap',
      },
    ])
    expect(over.bytes).toHaveLength(0)
    expect(run('times 512 nop').bytes).toHaveLength(512)
    expect(run('times 101 nop', { maxBytes: 100 }).diagnostics.map((d) => d.message)).toEqual([
      'the bot is 101 bytes, 1 over the limit of 100',
    ])
    expect(run('times 60000 nop', { maxBytes: 65536 }).bytes).toHaveLength(60000)
  })

  it('stops laying out past the 64 KB core', () => {
    const { diagnostics } = run('nop\ntimes 60000 resw 60000\ntimes 65535 jmp $')
    expect(diagnostics.map((d) => [where(d), d.message])).toEqual([
      ['2:1+22 size-over-cap', 'the bot is more than 65536 bytes, over the limit of 512'],
    ])
  })

  it('throws on a size limit it cannot use', () => {
    for (const maxBytes of [-1, 1.5, 65537, Number.NaN]) {
      expect(() => assemble('%name "x"', { maxBytes })).toThrow(RangeError)
    }
  })
})

describe('assemble: output', () => {
  const source = [
    '%name "Out"',
    'start:  mov     ax, 0x1234',
    '        ; a comment',
    '.x:     db      "ab"',
    'size    equ     $ - start',
    '        times   2 nop',
    '',
  ].join('\r\n')

  it('lists every source line with its address, bytes, and text', () => {
    const { listing } = assemble(source)
    expect(listing.map((l) => [l.lineNo, l.address, l.bytesHex, l.source, l.bytes.length])).toEqual(
      [
        [1, 0, '', '%name "Out"', 0],
        [2, 0, 'B8 34 12', 'start:  mov     ax, 0x1234', 3],
        [3, 3, '', '        ; a comment', 0],
        [4, 3, '61 62', '.x:     db      "ab"', 2],
        [5, 5, '', 'size    equ     $ - start', 0],
        [6, 5, '90 90', '        times   2 nop', 2],
        [7, 7, '', '', 0],
      ],
    )
  })

  it('maps every byte to its line, and lists the symbols in source order', () => {
    const { bytes, sourceMap, symbols } = assemble(source)
    expect(hex(bytes)).toBe('B8 34 12 61 62 90 90')
    expect([...sourceMap]).toEqual([2, 2, 2, 4, 4, 6, 6])
    expect([...symbols]).toEqual([
      ['start', 0],
      ['start.x', 3],
      ['size', 5],
    ])
  })

  it('gives no bytes, listing, or source map when there is an error, but keeps the rest', () => {
    const r = assemble('%name "Bad"\nstart: nop\nmov [bx], 0\nend:')
    expect(r.diagnostics.map(where)).toEqual(['3:5+4 size-not-specified'])
    expect([r.bytes.length, r.listing.length, r.sourceMap.length]).toEqual([0, 0, 0])
    expect(r.name).toBe('Bad')
    expect(r.symbols.get('start')).toBe(0)
  })

  it('merges lexer, parser, and assembler diagnostics in source order', () => {
    expect(places('mov [bx], 0\nmov ax, 0x\njmp nope\nmov ax, [bx+bp]\n@')).toEqual([
      '1:5+4 size-not-specified',
      '2:9+2 bad-number',
      '3:5+4 undefined-symbol',
      '4:13+2 invalid-address',
      '5:1+1 bad-char',
    ])
  })

  it('assembles the ISA §6 dwarf', () => {
    const dwarf = readFileSync(join(import.meta.dir, 'fixtures', 'parse', 'dwarf.asm'), 'utf8')
    const { bytes, diagnostics, name, symbols } = assemble(dwarf)
    expect(diagnostics).toEqual([])
    expect(name).toBe('Dwarf')
    expect(hex(bytes)).toBe('E8 00 00 5B 83 EB 03 8D 7F 13 83 C7 04 C7 05 00 00 EB F7 00 00')
    expect(symbols.get('bomb')).toBe(19)
  })
})

/** Runs NASM (`cpu 8086`) on `body`: the bytes, or undefined when it reports an error. */
function nasm(dir: string, body: string): Uint8Array | undefined {
  const src = join(dir, 'bot.asm')
  const out = join(dir, 'bot.bin')
  writeFileSync(src, `bits 16\ncpu 8086\n${body}\n`)
  rmSync(out, { force: true })
  const result = spawnSync('nasm', ['-f', 'bin', '-o', out, src], { encoding: 'utf8' })
  return result.status === 0 ? new Uint8Array(readFileSync(out)) : undefined
}

/**
 * A random program in the part of the dialect where x16c and NASM agree on sizes: jumps and
 * calls to any label, `times` padding and repeated jumps, label values in fixed-size fields, and
 * label differences in sized fields only when both labels come earlier. (NASM gives any label
 * value a 16-bit field, and guesses a forward difference short where x16c guesses it long.)
 */
function program(next: () => number, lines: number): string {
  const labels = Array.from({ length: 12 }, (_, i) => `l${i}`)
  const at = new Map<number, string[]>()
  for (const label of labels) {
    const line = next() % lines
    at.set(line, [...(at.get(line) ?? []), label])
  }
  const defined: string[] = []
  const nearby = (i: number) => at.get(i + 1)?.[0] ?? at.get(i)?.[0] ?? '$'
  const any = () => labels[next() % labels.length] as string
  const earlier = () => defined[next() % defined.length] as string
  const out: string[] = []
  for (let i = 0; i < lines; i++) {
    for (const label of at.get(i) ?? []) {
      out.push(`${label}:`)
      defined.push(label)
    }
    const pick = next() % 20
    if (pick < 6) out.push(`jmp ${any()}`)
    else if (pick === 6) out.push(`jmp near ${any()}`)
    else if (pick === 7) out.push(`call ${any()}`)
    else if (pick === 8) out.push(`${['jz', 'jnc', 'loop', 'jcxz'][next() % 4]} ${nearby(i)}`)
    else if (pick < 13) out.push(`times ${next() % 48} nop`)
    else if (pick === 13) out.push(`times ${1 + (next() % 3)} jmp ${any()}`)
    else if (pick === 14) out.push(`mov cx, ${any()} - ${any()}`)
    else if (pick === 15) out.push(`dw ${any()}, ${any()} - ${any()}`)
    else if (pick === 16 && defined.length > 0) out.push(`add bx, ${earlier()} - ${earlier()}`)
    else if (pick === 17 && defined.length > 0) out.push(`mov ax, [si+${earlier()}-${earlier()}]`)
    else out.push('db 1, 2')
  }
  return out.join('\n')
}

describe.skipIf(!hasNasm())('assemble: NASM cross-check', () => {
  it('lays out 120 random programs as NASM does', () => {
    const dir = mkdtempSync(join(tmpdir(), 'asm-nasm-'))
    try {
      const next = lcg(0x3a55)
      const wrong: string[] = []
      let compared = 0
      for (let n = 0; n < 120; n++) {
        const body = program(next, 40)
        const ours = run(body)
        // Out-of-range conditional jumps: NASM rewrites them, x16c reports them (ISA §3.3).
        if (ours.diagnostics.length > 0) continue
        compared++
        const theirs = nasm(dir, body)
        if (theirs === undefined || hex(theirs) !== hex(ours.bytes)) {
          wrong.push(`program ${n}: NASM ${theirs === undefined ? 'fails' : hex(theirs)}\n${body}`)
        }
      }
      expect(wrong.slice(0, 3)).toEqual([])
      expect(compared).toBeGreaterThan(60)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('settles the 10-jump cascade as NASM does', () => {
    const dir = mkdtempSync(join(tmpdir(), 'asm-nasm-'))
    try {
      expect(hex(nasm(dir, cascade(10)) ?? [])).toBe(hex(run(cascade(10)).bytes))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
