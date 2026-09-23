import { describe, expect, it } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assemble } from '../src/assemble'
import type { Diag } from '../src/diag'
import { formatSource } from '../src/format'
import { tokenize } from '../src/lexer'
import { parse } from '../src/parser'
import { asmFiles, UPDATE } from './fixture'

/*
 * Fixtures: `fixtures/format/<name>.asm` formats to `<name>.fmt.asm`. After a deliberate change,
 * regenerate with `UPDATE_FIXTURES=1 bun test packages/asm` and review the diff.
 */
const FIXTURES = join(import.meta.dir, 'fixtures')
const FORMAT = join(FIXTURES, 'format')

const hex = (bytes: ArrayLike<number>) =>
  Array.from(bytes, (b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')

/**
 * What the formatter must keep: the parsed lines without positions (blank and comment lines
 * dropped, since blank lines move), the lexer and parser diagnostics, and what the assembler
 * makes of the source.
 */
function meaning(source: string) {
  const diags: Diag[] = []
  const parsed = parse(tokenize(source, diags))
  const unplaced = (v: unknown) =>
    JSON.stringify(v, (k, x) => (k === 'line' || k === 'col' || k === 'len' ? undefined : x))
  const assembled = assemble(source, { maxBytes: 0x10000 })
  return {
    lines: parsed.lines.filter((l) => l.kind !== 'empty' || l.label !== undefined).map(unplaced),
    diags: [...diags, ...parsed.diags].map((d) => `${d.code}: ${d.message}`).sort(),
    bytes: hex(assembled.bytes),
    errors: assembled.diagnostics.map((d) => d.code).sort(),
  }
}

/** Asserts that formatting `source` keeps its meaning and that the result is a fixed point. */
function expectSound(source: string, name: string) {
  const out = formatSource(source)
  expect({ name, again: formatSource(out) }).toEqual({ name, again: out })
  expect({ name, ...meaning(out) }).toEqual({ name, ...meaning(source) })
}

/** Each line of `text`, with `·` for a space so columns show in a failure. */
const shown = (text: string) => text.split('\n').map((l) => l.replaceAll(' ', '·'))

/** Asserts that `source` formats to `lines`. */
function expectFormat(source: string, lines: readonly string[]) {
  expect(shown(formatSource(source))).toEqual(shown(`${lines.join('\n')}\n`))
}

describe('formatSource: fixtures', () => {
  for (const name of asmFiles(FORMAT).filter((f) => !f.endsWith('.fmt.asm'))) {
    const want = name.replace(/\.asm$/, '.fmt.asm')
    it(`formats ${name} to ${want}`, () => {
      const out = formatSource(readFileSync(join(FORMAT, name), 'utf8'))
      if (UPDATE) writeFileSync(join(FORMAT, want), out)
      expect(shown(out)).toEqual(shown(readFileSync(join(FORMAT, want), 'utf8')))
    })
  }

  it('is idempotent and keeps the meaning of every file in test/fixtures', () => {
    const files = asmFiles(FIXTURES, true)
    expect(files.length).toBeGreaterThanOrEqual(20)
    for (const file of files) expectSound(readFileSync(join(FIXTURES, file), 'utf8'), file)
  })
})

describe('formatSource: columns', () => {
  it('puts a label at 0, the mnemonic at 8, the operands at 16, and a comment at 40', () => {
    expectFormat('start: mov ax,1 ; go\n', ['start:  mov     ax, 1                   ; go'])
    expectFormat('   nop\n.x:\n', ['        nop', '.x:'])
  })

  it('starts a field one space after a field that runs past its column', () => {
    expectFormat('averyveryverylongname: mov ax, 1\nlonglabel: nop\nx: movsw ; c', [
      'averyveryverylongname: mov ax, 1',
      'longlabel: nop',
      'x:      movsw                           ; c',
    ])
    expectFormat('lea di, [bx+someverylonglabelname+2] ; c', [
      '        lea     di, [bx+someverylonglabelname+2] ; c',
    ])
  })

  it('lays out equ, times, prefixes, metadata, and %define', () => {
    expectFormat(
      [
        '%NAME "x"',
        '%strategy "s" ; why',
        '%define  STRIDE 4',
        '%define LONGERNAME 4',
        '%define EMPTY',
        'size EQU 4',
        'loop: equ 5',
        'size2: equ 6',
        'TIMES 2 REP MOVSB',
        'buf: times (8) db 1,2',
        'REPNE SCASW',
      ].join('\n'),
      [
        '%name     "x"',
        '%strategy "s"                           ; why',
        '%define STRIDE  4',
        '%define LONGERNAME 4',
        '%define EMPTY',
        'size    equ     4',
        'loop:   equ     5',
        'size2   equ     6',
        '        times   2 rep movsb',
        '',
        'buf:    times   (8) db 1, 2',
        '        repne   scasw',
      ],
    )
  })

  it('lines comments up in columns counted with tab stops of 8', () => {
    // The trailing comment and the one below it both start at column 32 on screen.
    expectFormat('\tmov\tax, 1\t\t; one\n\t\t\t\t; two\n', [
      '        mov     ax, 1                   ; one',
      '                                        ; two',
    ])
  })
})

describe('formatSource: words and numbers', () => {
  it('lowercases mnemonics, prefixes, registers, keywords, and directives', () => {
    expectFormat('Start: MOV WORD [BX+SI], AX\n.L: JMP SHORT Start\n%VERSION "1"', [
      'Start:  mov     word [bx+si], ax',
      '.L:     jmp     short Start',
      '%version  "1"',
    ])
  })

  it('keeps the case of labels and symbols, mnemonics used as names included', () => {
    expectFormat('LOOP: loop LOOP\nMov: jmp Mov\n$AX: dw $AX', [
      'LOOP:   loop    LOOP',
      'Mov:    jmp     Mov',
      '$AX:    dw      $AX',
    ])
  })

  it('writes hex as 0x with uppercase digits, and binary as 0b', () => {
    expectFormat('dw 0x1f, 0X1F, 1fh, 0FFH, 00ffh, 0B800h, 0bh, 0B101, 17, 007', [
      '        dw      0x1F, 0x1F, 0x1F, 0xFF, 0x00FF, 0xB800, 0xB, 0b101, 17, 007',
    ])
  })

  it('spaces binary operators outside [ ] and packs them inside', () => {
    expectFormat('mov ax,[ bx + si - 2 ]\nmov ax,end-start\njmp $+2\ndw -1,~0x80,-(4),5- -1', [
      '        mov     ax, [bx+si-2]',
      '        mov     ax, end - start',
      '        jmp     $ + 2',
      '        dw      -1, ~0x80, -(4), 5 - -1',
    ])
    expectFormat('add word[byte bx+0],strict word 5\nmov ax,[word 0x0100]\nmov ax,(1+2)*3', [
      '        add     word [byte bx+0], strict word 5',
      '        mov     ax, [word 0x0100]',
      '        mov     ax, (1 + 2) * 3',
    ])
  })
})

describe('formatSource: labels', () => {
  it('adds the colon a label may leave out, except on an equ name', () => {
    expectFormat('.msg db "hi"\n.here mov ax, .msg\nsize equ 4\n.x: equ 5', [
      '.msg:   db      "hi"',
      '.here:  mov     ax, .msg',
      'size    equ     4',
      '.x      equ     5',
    ])
  })
})

describe('formatSource: comments and blank lines', () => {
  it('keeps comment-only lines: at 0 when they start there, else at 8', () => {
    expectFormat('; top\n  ; indented\n\t; tabbed\nnop   ;   trailing   \n', [
      '; top',
      '        ; indented',
      '        ; tabbed',
      '        nop                             ;   trailing',
    ])
  })

  it('keeps a comment that continues the one above under it, wherever that one goes', () => {
    const at24 = ' '.repeat(24)
    expectFormat(`mov ax, [bx+si+0x1234]  ; a\n${at24}; b\n${at24}; c\n; d\n${at24}; e`, [
      '        mov     ax, [bx+si+0x1234]      ; a',
      '                                        ; b',
      '                                        ; c',
      '; d',
      '        ; e',
    ])
    // Long code pushes its comment to column 46, and the continuation follows it.
    expectFormat(`mov ax, [bx+si+averyverylongname] ; a\n${' '.repeat(34)}; b`, [
      '        mov     ax, [bx+si+averyverylongname] ; a',
      `${' '.repeat(46)}; b`,
    ])
  })

  it('drops blank lines at the ends and collapses runs of them', () => {
    expectFormat('\n\n\nnop\n\n\n\nnop\n\n\n', ['        nop', '', '        nop'])
    expect(formatSource('')).toBe('')
    expect(formatSource('\n \t\n\n')).toBe('')
  })

  it('puts one blank line before a global-label block, with the comments above its label', () => {
    expectFormat('a: nop\nnop\n; about b\n; more\nb: nop\n.x: nop\nc:\nd: nop', [
      'a:      nop',
      '        nop',
      '',
      '; about b',
      '; more',
      'b:      nop',
      '.x:     nop',
      '',
      'c:',
      'd:      nop',
    ])
  })

  it('keeps one-line blocks together, and a bare label with the block after it', () => {
    expectFormat('bomb: dat\nptr: dw 0\ncount: dw 0\nalias:\nmain: nop\njmp main', [
      'bomb:   dat',
      'ptr:    dw      0',
      'count:  dw      0',
      'alias:',
      'main:   nop',
      '        jmp     main',
    ])
  })

  it('treats .local, ..@, and equ names as part of the block they are in', () => {
    expectFormat('a: nop\n.x: nop\n..@y: nop\nk equ 1\nk2: equ 2\nnop', [
      'a:      nop',
      '.x:     nop',
      '..@y:   nop',
      'k       equ     1',
      'k2      equ     2',
      '        nop',
    ])
  })

  it('ends every line with \\n, whatever the line breaks were', () => {
    expect(formatSource('nop\r\nnop\rnop')).toBe('        nop\n        nop\n        nop\n')
  })
})

describe('formatSource: safety', () => {
  it('keeps a line with a lexer or parser error exactly as written', () => {
    expectFormat('MOV  AX , 0x   \n\tjmp far [bx]\t\nfoo  \n%define F(x) x\ndb "ab  ', [
      'MOV  AX , 0x   ',
      '\tjmp far [bx]\t',
      'foo  ',
      '%define F(x) x',
      'db "ab  ',
    ])
  })

  it('formats a line with an assembler error, which only the assembler sees', () => {
    expectFormat('MOV [BX], 0\njz nowhere', ['        mov     [bx], 0', '        jz      nowhere'])
  })

  it('keeps the case of a word that is a macro name, as written or in lowercase', () => {
    const source = '%define mov nop\n%define AX bx\nMOV AX, 1\nmov\nPUSH Ax'
    expectFormat(source, [
      '%define mov     nop',
      '%define AX      bx',
      '        MOV     AX, 1',
      '        mov',
      '        push    ax',
    ])
    expectSound(source, 'macros')
  })

  it('keeps the text of a macro, and its spacing where it had none', () => {
    expectFormat('%define F (1+2)\n%define G 0ffh\n%define H a ~b\ndw F, G', [
      '%define F       (1+2)',
      '%define G       0ffh',
      '%define H       a ~b',
      '        dw      F, G',
    ])
  })

  it('never lets two words touch, so no token merges with the next', () => {
    // `~` is a name character after the first: `X~2` would be one name.
    const source = '%define X 1 +\ndw X ~2\n%define P +\ndw 1 P 2'
    expectFormat(source, [
      '%define X       1 +',
      '        dw      X ~2',
      '%define P       +',
      '        dw      1 P 2',
    ])
    expectSound(source, 'words')
  })

  it('keeps the meaning of 2,000 random programs, and formats each to a fixed point', () => {
    const next = lcg(0xf0a7)
    for (let n = 0; n < 2000; n++) {
      const source = program(next)
      expectSound(source, source)
    }
  })
})

/** A deterministic stream of 24-bit values. */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0
    return s >>> 8
  }
}

/**
 * A random program in messy style: any case, any spacing, every number form, labels with and
 * without colons, `.local` names, macros whose names clash with keywords in some case, comments
 * in any column, blank lines, three kinds of line break, and lines with errors.
 */
function program(next: () => number): string {
  const r = (n: number) => next() % n
  const pick = <T>(xs: readonly T[]): T => xs[r(xs.length)] as T
  const cased = (w: string) => pick([w, w, w.toUpperCase(), `${w[0]?.toUpperCase()}${w.slice(1)}`])
  const ws = () => pick(['', ' ', ' ', '  ', '\t', ' \t '])
  const ws1 = () => pick([' ', ' ', '  ', '\t', '    '])
  const syms = ['start', 'loop', 'bomb', 'Size', 'X', 'ax2', 'end', '$ax', 'mov', 'Loop', 'N']
  const locals = ['.l', '.x', '.Loop', '..@t']
  const macros = ['M', 'MOV', 'ax', 'Ax', 'STRIDE', 'W', 'P', 'X', 'nop', 'Nop']
  const num = () => {
    const v = r(5) === 0 ? r(0x10000) : r(40)
    const h = v.toString(16)
    return pick([
      String(v),
      `0x${h}`,
      `0X${h.toUpperCase()}`,
      `0${h}h`,
      `${h.toUpperCase()}H`.replace(/^([A-F])/, '0$1'),
      `0b${v.toString(2)}`,
      `'${String.fromCharCode(65 + r(26))}'`,
    ])
  }
  const atom = () => pick([num(), num(), pick(syms), pick(locals), '$', '$$', pick(macros)])
  const ops = ['+', '-', '*', '/', '%', '<<', '>>', '&', '|', '^']
  const expr = (d = 0): string => {
    const k = r(d > 2 ? 2 : 6)
    if (k < 2) return atom()
    if (k === 2) return `${pick(['-', '~', '+'])}${ws()}${expr(d + 1)}`
    if (k === 3) return `(${ws()}${expr(d + 1)}${ws()})`
    return `${expr(d + 1)}${ws()}${pick(ops)}${ws()}${expr(d + 1)}`
  }
  const size = () => `${cased(pick(['byte', 'word']))}${ws1()}`
  const mem = () => {
    const parts = [
      ...(r(2) ? [cased(pick(['bx', 'bp']))] : []),
      ...(r(2) ? [cased(pick(['si', 'di']))] : []),
      ...(r(2) ? [expr(2)] : []),
    ]
    if (parts.length === 0) parts.push(expr(2))
    const inner = parts.sort(() => r(3) - 1).join(`${ws()}+${ws()}`)
    return `${r(3) === 0 ? size() : ''}[${ws()}${r(6) === 0 ? size() : ''}${inner}${ws()}]`
  }
  const reg = () => cased(pick(['ax', 'bx', 'cx', 'si', 'di', 'bp', 'al', 'ah', 'cl', 'dh']))
  const operand = () =>
    pick([
      reg(),
      mem(),
      expr(),
      `${size()}${expr()}`,
      `${cased('strict')}${ws1()}${size()}${expr()}`,
    ])
  const list = (f: () => string) => Array.from({ length: 1 + r(3) }, f).join(`${ws()},${ws()}`)
  const text = () => pick(['"hi"', "'it''", '"a;b"', "'x'", '""'])
  const instr = (): string => {
    switch (r(14)) {
      case 0: {
        const hint = r(3) === 0 ? `${cased(pick(['short', 'near']))}${ws1()}` : ''
        return `${cased(pick(['jmp', 'jz', 'je', 'call', 'loop', 'spl']))}${ws1()}${hint}${expr()}`
      }
      case 1:
        return cased(pick(['ret', 'hlt', 'nop', 'dat', 'int3', 'movsw', 'stosb', 'cld']))
      case 2:
        return `${cased(pick(['rep', 'repz', 'repne']))}${ws1()}${cased(pick(['movsb', 'scasb']))}`
      case 3:
        return `${cased(pick(['push', 'pop', 'inc', 'dec', 'not', 'mul']))}${ws1()}${operand()}`
      case 4:
        return `${cased(pick(['db', 'dw']))}${ws1()}${list(() => (r(4) === 0 ? text() : expr()))}`
      case 5:
        return `${cased(pick(['resb', 'resw']))}${ws1()}${r(40)}`
      case 6:
        return `${cased('times')}${ws1()}${r(4)}${ws1()}${instr()}`
      case 7:
        return `${cased('align')}${ws1()}${pick(['2', '4', '0x10'])}`
      case 8:
        return `${cased(pick(['org', 'bits']))}${ws1()}${pick(['0', '16'])}`
      case 9:
        return pick(macros)
      default: {
        const m = cased(pick(['mov', 'add', 'sub', 'xor', 'cmp', 'lea', 'shl', 'test', 'xchg']))
        return `${m}${ws1()}${operand()}${ws()},${ws()}${operand()}`
      }
    }
  }
  const line = (): string => {
    switch (r(20)) {
      case 0:
        return pick(['', '  ', '\t'])
      case 1:
        return `${pick(['', '  ', '\t', ' '.repeat(r(48))])};${pick([' c', '', ' ; x'])}${ws()}`
      case 2: {
        const body = pick([expr(), `${cased('word')} [di]`, 'bx+si', instr(), pick(macros)])
        return `${ws()}%${cased('define')}${ws1()}${pick(macros)}${r(4) ? `${ws1()}${body}` : ''}`
      }
      case 3: {
        const meta = cased(pick(['name', 'author', 'strategy', 'version']))
        return `${ws()}%${meta}${ws1()}${pick(['"Bot"', "'A'", '""', 'X', '"a ; b"'])}`
      }
      case 4:
        return `${pick([...syms, ...locals])}${ws()}:`
      case 5:
        return `${pick(syms)}${ws1()}${cased('equ')}${ws1()}${expr()}`
      case 6:
        return pick([
          ...['mov ax,', 'db 1,', '5 nop', '0x', 'mov ax, 0x1g', '"abc', '%macro x'],
          ...['jmp far [bx]', 'mov ax, [bx+bp]', 'foo', '\u00a0nop', '%define F(x) x'],
        ])
      default: {
        const label = pick([
          '',
          `${pick(syms)}${ws1()}`,
          `${pick([...syms, ...locals])}${ws()}:${ws()}`,
          `${pick([...syms, ...locals])}${ws()}:${ws()}`,
        ])
        const comment = r(3) === 0 ? `${ws1()};${pick([' note', ' x ; y', ''])}` : ''
        return `${r(2) ? ws() : ''}${label}${instr()}${comment}`
      }
    }
  }
  const eol = pick(['\n', '\n', '\n', '\r\n', '\r'])
  const lines = Array.from({ length: 3 + r(30) }, line)
  return lines.join(eol) + pick(['', eol, eol + eol])
}
