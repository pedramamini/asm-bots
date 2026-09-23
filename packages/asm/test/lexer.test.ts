import { describe, expect, it } from 'bun:test'
import { type Diag, type Token, tokenize } from '../src/index'

/** `kind text` per token, eof dropped; a newline is just `newline`. */
const show = (tokens: readonly Token[]) =>
  tokens.slice(0, -1).map((t) => (t.kind === 'newline' ? 'newline' : `${t.kind} ${t.text}`))
const kinds = (source: string) => show(tokenize(source))

/** The one token of `source` before eof. */
function only(source: string): Token {
  const tokens = tokenize(source)
  expect(tokens.map((t) => t.kind).slice(1)).toEqual(['eof'])
  return tokens[0] as Token
}

/** The value of the one token of `source`. */
function valueIn(source: string): number | string | undefined {
  const token = only(source)
  return 'value' in token ? token.value : undefined
}

/** Asserts that every token's text is the source at its line, col, and len. */
function expectPositions(source: string, tokens: readonly Token[]) {
  const lines = source.split(/\r\n|\r|\n/)
  for (const t of tokens) {
    if (t.kind === 'newline') continue
    const at = (lines[t.line - 1] ?? '').slice(t.col - 1, t.col - 1 + t.len)
    expect(`${t.line}:${t.col} ${at}`).toBe(`${t.line}:${t.col} ${t.text}`)
  }
}

const error = (line: number, col: number, len: number, code: Diag['code'], message: string) => ({
  severity: 'error',
  line,
  col,
  len,
  code,
  message,
})

/** The ISA §6 example, verbatim. */
const DWARF = `; Every line after ';' is a comment.
%name     "Dwarf"                 ; ASM Bots metadata directives use %name/%author/%strategy
%author   "A. K. Dewdney"
%strategy "Bombs every 4th word with DAT, walking the whole core."

        org 0                     ; optional; always 0. Bots are position independent (see 6.4).
start:  call .here                ; the base-register idiom
.here:  pop  bx
        sub  bx, .here            ; bx = this bot's base address
        lea  di, [bx+bomb]        ; di = absolute address of our bomb
.loop:  add  di, 4
        mov  word [di], 0         ; drop a DAT every 4 bytes, forever, wrapping the core
        jmp  .loop
bomb:   dat
`

describe('tokenize: numbers', () => {
  it('reads every ISA §6.1 number form, prefix and suffix in either case', () => {
    const forms: [string, number][] = [
      ['123', 123],
      ['0', 0],
      ['007', 7],
      ['0x1F', 0x1f],
      ['0x1f', 0x1f],
      ['0X1F', 0x1f],
      ['0xFFFF', 0xffff],
      ['1Fh', 0x1f],
      ['1fh', 0x1f],
      ['1FH', 0x1f],
      ['0FFh', 0xff],
      ['0h', 0],
      ['0b1010', 10],
      ['0B1010', 10],
      ['0b0', 0],
    ]
    for (const [text, value] of forms) {
      expect(only(text)).toEqual({ kind: 'number', value, text, line: 1, col: 1, len: text.length })
    }
  })

  it('reads a trailing h as hex, even after 0b', () => {
    expect(valueIn('0B800h')).toBe(0xb800)
    expect(valueIn('0bh')).toBe(0x0b)
  })

  it('keeps values past 16 bits exact, for the evaluator to wrap', () => {
    expect(valueIn('0x10000')).toBe(0x10000)
    expect(valueIn('0xFFFFFFFF')).toBe(0xffffffff)
    expect(valueIn('9007199254740991')).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('reads -7 as unary minus and 7', () => {
    expect(kinds('-7')).toEqual(['punct -', 'number 7'])
  })

  it('reads a one-character literal in either quote as its character code', () => {
    expect(only("'A'")).toEqual({ kind: 'char', value: 65, text: "'A'", line: 1, col: 1, len: 3 })
    expect(only('"A"')).toEqual({ kind: 'char', value: 65, text: '"A"', line: 1, col: 1, len: 3 })
  })
})

describe('tokenize: strings and escapes', () => {
  it('resolves every escape in a character literal', () => {
    const escapes: [string, number][] = [
      ["'\\n'", 10],
      ["'\\t'", 9],
      ["'\\r'", 13],
      ["'\\0'", 0],
      ["'\\\\'", 92],
      ["'\\''", 39],
      ["'\\\"'", 34],
    ]
    for (const [text, value] of escapes) {
      expect(only(text)).toEqual({ kind: 'char', value, text, line: 1, col: 1, len: 4 })
    }
  })

  it('resolves escapes in strings and keeps the source text', () => {
    const strings: [string, string][] = [
      ['"a\\tb\\n"', 'a\tb\n'],
      ["'it\\'s'", "it's"],
      ['"say \\"hi\\""', 'say "hi"'],
      ['"C:\\\\bots"', 'C:\\bots'],
      [`"it's"`, "it's"],
      [`'say "hi"'`, 'say "hi"'],
      ['"a\tb"', 'a\tb'],
      ['""', ''],
      ["''", ''],
    ]
    for (const [text, value] of strings) {
      expect(only(text)).toEqual({ kind: 'string', value, text, line: 1, col: 1, len: text.length })
    }
  })

  it('does not read a ; inside a string as a comment', () => {
    expect(kinds('db "a;b", 0 ; tail')).toEqual(['ident db', 'string "a;b"', 'punct ,', 'number 0'])
  })
})

describe('tokenize: identifiers', () => {
  it('reads $ and $$ as identifiers', () => {
    expect(kinds('jmp short $')).toEqual(['ident jmp', 'ident short', 'ident $'])
    expect(kinds('$$')).toEqual(['ident $$'])
    expect(kinds('dw $-$$+2')).toEqual([
      'ident dw',
      'ident $',
      'punct -',
      'ident $$',
      'punct +',
      'number 2',
    ])
  })

  it('reads local labels as identifiers that start with .', () => {
    expect(kinds('.loop:  jnz .loop')).toEqual([
      'ident .loop',
      'punct :',
      'ident jnz',
      'ident .loop',
    ])
    expect(kinds('start.loop')).toEqual(['ident start.loop'])
  })

  it('takes every ISA §6.1 identifier character', () => {
    expect(kinds('_a ?b a1_.$?#@~z')).toEqual(['ident _a', 'ident ?b', 'ident a1_.$?#@~z'])
  })

  it('reads mnemonics, registers, and keywords as identifiers, case kept', () => {
    expect(kinds('MOV Word [BX+si], 0')).toEqual([
      'ident MOV',
      'ident Word',
      'punct [',
      'ident BX',
      'punct +',
      'ident si',
      'punct ]',
      'punct ,',
      'number 0',
    ])
  })
})

describe('tokenize: operators and directives', () => {
  it('reads every operator', () => {
    const ops = [
      '[',
      ']',
      ',',
      ':',
      '+',
      '-',
      '*',
      '/',
      '%',
      '<<',
      '>>',
      '&',
      '|',
      '^',
      '~',
      '(',
      ')',
    ]
    expect(kinds(ops.join(' '))).toEqual(ops.map((op) => `punct ${op}`))
    expect(kinds('a<<2>>1')).toEqual(['ident a', 'punct <<', 'number 2', 'punct >>', 'number 1'])
  })

  it('reads a % name that starts a line as a directive, and any other % as modulo', () => {
    const source = '%name "Dwarf"\n  %DEFINE gap 4\nmov ax, 7 % gap\nmov ax, 7%gap\n% gap'
    expect(kinds(source)).toEqual([
      'directive %name',
      'string "Dwarf"',
      'newline',
      'directive %DEFINE',
      'ident gap',
      'number 4',
      'newline',
      'ident mov',
      'ident ax',
      'punct ,',
      'number 7',
      'punct %',
      'ident gap',
      'newline',
      'ident mov',
      'ident ax',
      'punct ,',
      'number 7',
      'punct %',
      'ident gap',
      'newline',
      'punct %',
      'ident gap',
    ])
  })
})

describe('tokenize: lines, columns, and comments', () => {
  it('drops comments and keeps their line breaks', () => {
    expect(kinds('; header\nnop ; tail\n')).toEqual(['newline', 'ident nop', 'newline'])
    const tokens = tokenize('nop ; a\r\nnop ; b\rnop')
    expect(tokens.map((t) => t.text)).toEqual(['nop', '\r\n', 'nop', '\r', 'nop', ''])
  })

  it('keeps each comment as a token to the end of its line when asked', () => {
    const source = '; head\nnop ; tail \r\ndb "a;b" ;x'
    const tokens = tokenize(source, [], { comments: true })
    expect(show(tokens)).toEqual([
      'comment ; head',
      'newline',
      'ident nop',
      'comment ; tail ',
      'newline',
      'ident db',
      'string "a;b"',
      'comment ;x',
    ])
    expectPositions(source, tokens)
  })

  it('counts 1-based columns, a tab as one column', () => {
    const source = '\tmov\tax,\t0x10 ; c'
    const tokens = tokenize(source)
    expect(tokens.map((t) => [t.text, t.col, t.len])).toEqual([
      ['mov', 2, 3],
      ['ax', 6, 2],
      [',', 8, 1],
      ['0x10', 10, 4],
      ['', 18, 0],
    ])
    expectPositions(source, tokens)
  })

  it('ends a line at \\n, \\r\\n, or a lone \\r', () => {
    const source = 'a\nb\r\nc\rd'
    const tokens = tokenize(source)
    expect(tokens.map((t) => [t.kind, t.text, t.line, t.col, t.len])).toEqual([
      ['ident', 'a', 1, 1, 1],
      ['newline', '\n', 1, 2, 1],
      ['ident', 'b', 2, 1, 1],
      ['newline', '\r\n', 2, 2, 2],
      ['ident', 'c', 3, 1, 1],
      ['newline', '\r', 3, 2, 1],
      ['ident', 'd', 4, 1, 1],
      ['eof', '', 4, 2, 0],
    ])
    expectPositions(source, tokens)
  })

  it('yields a newline per line break and puts eof after the last', () => {
    expect(tokenize('')).toEqual([{ kind: 'eof', text: '', line: 1, col: 1, len: 0 }])
    expect(kinds('\n\n')).toEqual(['newline', 'newline'])
    expect(tokenize('nop\n').at(-1)).toEqual({ kind: 'eof', text: '', line: 2, col: 1, len: 0 })
  })

  it('skips spaces, tabs, vertical tabs, and form feeds', () => {
    const diags: Diag[] = []
    expect(show(tokenize(' \t\v\fnop \t\v\f', diags))).toEqual(['ident nop'])
    expect(diags).toEqual([])
  })

  it('lexes the ISA §6 example without diagnostics', () => {
    const diags: Diag[] = []
    const tokens = tokenize(DWARF, diags)
    expect(diags).toEqual([])
    expectPositions(DWARF, tokens)
    expect(show(tokens).join(' ').split('newline')).toEqual([
      '',
      ' directive %name string "Dwarf" ',
      ' directive %author string "A. K. Dewdney" ',
      ' directive %strategy string "Bombs every 4th word with DAT, walking the whole core." ',
      ' ',
      ' ident org number 0 ',
      ' ident start punct : ident call ident .here ',
      ' ident .here punct : ident pop ident bx ',
      ' ident sub ident bx punct , ident .here ',
      ' ident lea ident di punct , punct [ ident bx punct + ident bomb punct ] ',
      ' ident .loop punct : ident add ident di punct , number 4 ',
      ' ident mov ident word punct [ ident di punct ] punct , number 0 ',
      ' ident jmp ident .loop ',
      ' ident bomb punct : ident dat ',
      '',
    ])
  })
})

describe('tokenize: diagnostics', () => {
  it('reports 0x at its column, yields 0 in its place, and goes on', () => {
    const diags: Diag[] = []
    const tokens = tokenize('nop\nmov ax, 0x ; oops\nnop', diags)
    expect(diags).toEqual([
      error(2, 9, 2, 'bad-number', "invalid number '0x': no digits after '0x'"),
    ])
    expect(tokens[5]).toEqual({ kind: 'number', value: 0, text: '0x', line: 2, col: 9, len: 2 })
    expect(show(tokens)).toEqual([
      'ident nop',
      'newline',
      'ident mov',
      'ident ax',
      'punct ,',
      'number 0x',
      'newline',
      'ident nop',
    ])
  })

  it('reports an unterminated string, runs it to the end of the line, and goes on', () => {
    const diags: Diag[] = []
    const tokens = tokenize('db "abc\nnop', diags)
    expect(diags).toEqual([
      error(1, 4, 4, 'unterminated-string', 'unterminated string: no closing "'),
    ])
    expect(tokens[1]).toEqual({
      kind: 'string',
      value: 'abc',
      text: '"abc',
      line: 1,
      col: 4,
      len: 4,
    })
    expect(show(tokens)).toEqual(['ident db', 'string "abc', 'newline', 'ident nop'])
  })

  it('ends an unterminated literal at the line break, even after a backslash', () => {
    const diags: Diag[] = []
    const tokens = tokenize('mov al, \'A\ndb "ab\\\r\n', diags)
    expect(diags).toEqual([
      error(1, 9, 2, 'unterminated-string', "unterminated string: no closing '"),
      error(2, 4, 4, 'unterminated-string', 'unterminated string: no closing "'),
    ])
    expect(tokens[3]).toMatchObject({ kind: 'char', value: 65, text: "'A" })
    expect(tokens[6]).toMatchObject({ kind: 'string', value: 'ab', text: '"ab\\' })
    expect(show(tokens).at(-1)).toBe('newline')
  })

  it('reports every malformed number with the reason', () => {
    const decimal = 'is not a decimal digit (hex needs 0x or an h suffix, binary needs 0b)'
    const numbers: [string, string][] = [
      ['0b', "no digits after '0b'"],
      ['0X', "no digits after '0X'"],
      ['0b102', "'2' is not a binary digit"],
      ['0x1G', "'G' is not a hex digit"],
      ['0x1Fh', "'x' is not a hex digit"],
      ['12ab', `'a' ${decimal}`],
      ['1010b', `'b' ${decimal}`],
      ['1.5', `'.' ${decimal}`],
      ['1_000', `'_' ${decimal}`],
      ['0x20000000000000', 'too large'],
      ['99999999999999999999', 'too large'],
    ]
    for (const [text, reason] of numbers) {
      const diags: Diag[] = []
      const tokens = tokenize(text, diags)
      expect(tokens[0]).toEqual({
        kind: 'number',
        value: 0,
        text,
        line: 1,
        col: 1,
        len: text.length,
      })
      expect(diags).toEqual([
        error(1, 1, text.length, 'bad-number', `invalid number '${text}': ${reason}`),
      ])
    }
  })

  it('reports an unknown escape and keeps the escaped character', () => {
    const diags: Diag[] = []
    const tokens = tokenize("mov al, '\\q'", diags)
    expect(tokens[3]).toMatchObject({ kind: 'char', value: 0x71 })
    expect(diags).toEqual([
      error(
        1,
        10,
        2,
        'bad-escape',
        "unknown escape '\\q'; the escapes are \\n \\t \\r \\0 \\\\ \\' \\\"",
      ),
    ])
  })

  it('reports an unexpected character, skips it, and goes on', () => {
    const diags: Diag[] = []
    const tokens = tokenize('mov ax, !5 < 2\n\u00a0nop `😀`', diags)
    expect(show(tokens)).toEqual([
      'ident mov',
      'ident ax',
      'punct ,',
      'number 5',
      'number 2',
      'newline',
      'ident nop',
    ])
    expect(diags).toEqual([
      error(1, 9, 1, 'bad-char', "unexpected character '!'"),
      error(1, 12, 1, 'bad-char', "unexpected character '<'"),
      error(2, 1, 1, 'bad-char', 'unexpected character U+00A0'),
      error(2, 6, 1, 'bad-char', "unexpected character '`'"),
      error(2, 7, 2, 'bad-char', 'unexpected character U+1F600'),
      error(2, 9, 1, 'bad-char', "unexpected character '`'"),
    ])
  })
})
