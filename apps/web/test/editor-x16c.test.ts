/**
 * The x16c tokenizer and its colors (src/features/editor/cm/x16c.ts): the fixture files'
 * token classes, token for token the same spans as `@asmbots/asm`'s lexer, labels and statement
 * words where the parser finds them, the tokens CodeMirror's parse gives the highlighter, and a
 * color from the kit for every class in every theme.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type Diag, type Line, parse, type Token, tokenize } from '@asmbots/asm'
import { Pcg32 } from '@asmbots/engine'
import { THEMES } from '@asmbots/ui/themes'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { highlightTree } from '@lezer/highlight'
import { asmFiles, expectFixture } from '../../../packages/asm/test/fixture'
import { parseTokenRules, themeTokens } from '../../../packages/ui/src/css-tokens'
import {
  EDITOR_THEME,
  isNumber,
  scan,
  scanLine,
  TOKEN_COLORS,
  TOKEN_TAGS,
  type X16cToken,
  x16cHighlightStyle,
  x16cLanguage,
} from '../src/features/editor/cm/x16c'

const REPO = join(import.meta.dir, '..', '..', '..')
const FIXTURES = join(import.meta.dir, 'fixtures', 'x16c')

/** Sources of every kind: the fixtures here, the roster, and the assembler's own fixtures. */
function sources(): [name: string, text: string][] {
  const read = (dir: string, recursive = false) =>
    asmFiles(dir, recursive).map((f): [string, string] => [
      `${dir.slice(REPO.length + 1)}/${f}`,
      readFileSync(join(dir, f), 'utf8'),
    ])
  return [
    ...read(FIXTURES),
    ...read(join(REPO, 'packages/bots/roster')),
    ...read(join(REPO, 'packages/asm/test/fixtures'), true),
  ]
}

const lines = (source: string) => source.split(/\r\n|\r|\n/)

interface Placed {
  line: number
  col: number
  len: number
  type: X16cToken
}

/** The editor's tokens of `source`, placed as the lexer places its tokens (1-based). */
function editorTokens(source: string): Placed[] {
  return lines(source).flatMap((text, i) =>
    scanLine(text).map((t) => ({ line: i + 1, col: t.from + 1, len: t.to - t.from, type: t.type })),
  )
}

const key = (t: { line: number; col: number; len: number }) => `${t.line}:${t.col}+${t.len}`

/** The editor classes a lexer token kind may take; a number's depends on its error. */
const COMPATIBLE: Readonly<Record<string, readonly X16cToken[]>> = {
  ident: [
    'mnemonic',
    'prefix',
    'register',
    'label',
    'symbol',
    'macro',
    'directive',
    'size',
    'here',
  ],
  char: ['number'],
  string: ['string'],
  directive: ['directive'],
  punct: ['bracket', 'operator', 'punctuation'],
  comment: ['comment'],
}

/**
 * Where the editor and the lexer disagree about `source`: a lexer token the editor splits, joins,
 * or colors as the wrong kind, and an editor token the lexer does not have that is not a character
 * it rejects. A number is `invalid` exactly when the lexer says `bad-number`.
 */
function disagreements(source: string): string[] {
  const diags: Diag[] = []
  const lexed = tokenize(source, diags, { comments: true }).filter(
    (t: Token) => t.kind !== 'newline' && t.kind !== 'eof',
  )
  const mine = new Map(editorTokens(source).map((t) => [key(t), t]))
  const errors = new Map(diags.map((d) => [key(d), d.code]))
  const out: string[] = []
  const text = (t: { line: number; col: number; len: number }) =>
    (lines(source)[t.line - 1] ?? '').slice(t.col - 1, t.col - 1 + t.len)
  for (const t of lexed) {
    const found = mine.get(key(t))
    mine.delete(key(t))
    const bad = errors.get(key(t)) === 'bad-number'
    const allowed = t.kind === 'number' ? [bad ? 'invalid' : 'number'] : (COMPATIBLE[t.kind] ?? [])
    const where = `${key(t)} ${t.kind} ${JSON.stringify(text(t))}`
    if (found === undefined) out.push(`${where}: no token`)
    else if (!allowed.includes(found.type)) out.push(`${where}: ${found.type}`)
  }
  for (const t of mine.values()) {
    if (t.type !== 'invalid' || errors.get(key(t)) !== 'bad-char') {
      out.push(`${key(t)} ${JSON.stringify(text(t))}: ${t.type}, not a lexer token`)
    }
  }
  return out
}

describe('x16c: fixtures', () => {
  for (const file of asmFiles(FIXTURES)) {
    it(`gives ${file} its token classes`, () => {
      const source = readFileSync(join(FIXTURES, file), 'utf8')
      const got = lines(source.replace(/\n$/, '')).map((text) =>
        scanLine(text).map((t) => [text.slice(t.from, t.to), t.type]),
      )
      expectFixture(join(FIXTURES, file.replace(/\.asm$/, '.tokens.json')), got)
    })
  }
})

describe('x16c: the lexer agrees', () => {
  for (const [name, source] of sources()) {
    it(`on ${name}`, () => {
      expect(disagreements(source)).toEqual([])
    })
  }

  it('on 3,000 random lines', () => {
    const rng = new Pcg32(0x16c, 3)
    const parts = [
      ...' \t\t    ,:;[]()+-*/%&|^~<<>>@!#=`\'"\\ é😀',
      ...['mov', 'rep', 'ax', 'al', 'byte', 'short', 'db', 'times', 'equ', '%name', '%define'],
      ...['start', '.here', '$', '$$', '$ax', '..@x', 'loop', 'x.y', '?q'],
      ...['0', '12', '0x1F', '1Fh', '0b101', '0B800h', '1010b', '0x', '1.5', '1_0'],
      ...["'A'", '"hi"', "'\\n'", '"a\\"b"', "'\\q'"],
    ]
    const bad: string[] = []
    for (let n = 0; n < 3000; n++) {
      let line = ''
      for (let k = rng.nextInt(12); k >= 0; k--) line += parts[rng.nextInt(parts.length)]
      for (const d of disagreements(line)) bad.push(`${JSON.stringify(line)} ${d}`)
    }
    expect(bad.slice(0, 5)).toEqual([])
  })

  it('reads numbers as the lexer does', () => {
    for (const good of [
      '0',
      '123',
      '0x1F',
      '0X1f',
      '1Fh',
      '0FFh',
      '0b1010',
      '0B800h',
      '1H',
      '0bh',
    ]) {
      expect([good, isNumber(good)]).toEqual([good, true])
    }
    for (const bad of [
      '0x',
      '0b',
      '0b102',
      '1010b',
      '1_000',
      '1.5',
      '0x1Fh',
      '99999999999999999',
    ]) {
      expect([bad, isNumber(bad)]).toEqual([bad, false])
    }
  })
})

/**
 * What the editor must say about a line the parser read without an error: the label is a `label`
 * token where the parser found it, and each statement word is a token of its class.
 */
function misreads(line: Line, text: string): string[] {
  const tokens = scanLine(text)
  const out: string[] = []
  const has = (word: string, type: X16cToken) => {
    const ok = tokens.some(
      (t) => text.slice(t.from, t.to).toLowerCase() === word && t.type === type,
    )
    if (!ok) out.push(`${line.line}: \`${word}\` is no ${type}`)
  }
  if (line.label !== undefined) {
    const { col, len } = line.label
    const token = tokens.find((t) => t.from === col - 1 && t.to === col - 1 + len)
    if (token?.type !== 'label') out.push(`${line.line}:${col}: the label is ${token?.type}`)
  }
  switch (line.kind) {
    case 'instr':
      if (line.prefix !== undefined) has(line.prefix, 'prefix')
      // A macro's use expands to text from another line.
      if (new RegExp(`\\b${line.mnemonic}\\b`, 'i').test(text)) has(line.mnemonic, 'mnemonic')
      break
    case 'times':
      has('times', 'directive')
      out.push(...misreads({ ...line.body, label: undefined } as Line, text))
      break
    case 'data':
    case 'directive':
    case 'equ':
      has(line.mnemonic, 'directive')
      break
  }
  return out
}

describe('x16c: the parser agrees', () => {
  const ROSTER = join(REPO, 'packages/bots/roster')
  const files = [
    ...asmFiles(ROSTER).map((f) => join(ROSTER, f)),
    join(FIXTURES, 'statements.asm'),
    join(FIXTURES, 'directives.asm'),
  ]
  for (const file of files) {
    it(`finds the labels and statement words of ${file.slice(REPO.length + 1)}`, () => {
      const source = readFileSync(file, 'utf8')
      const { lines: parsed, diags } = parse(tokenize(source))
      const failed = new Set(diags.map((d) => d.line))
      const read = parsed.filter((l) => !failed.has(l.line) && l.kind !== 'empty')
      expect(read.length).toBeGreaterThan(5)
      expect(read.flatMap((l) => misreads(l, lines(source)[l.line - 1] ?? ''))).toEqual([])
    })
  }
})

describe('x16c: in CodeMirror', () => {
  /** Each character's class, `.` for none: what the highlighter paints on `text`. */
  function painted(text: string): string[] {
    const state = EditorState.create({ doc: text, extensions: [x16cLanguage] })
    const tree = ensureSyntaxTree(state, state.doc.length, 5000)
    if (tree === null) throw new Error('no syntax tree')
    const byClass = new Map(
      (Object.keys(TOKEN_TAGS) as X16cToken[]).map((t) => [
        x16cHighlightStyle.style([TOKEN_TAGS[t]]),
        t,
      ]),
    )
    const out = [...text].map(() => '.')
    highlightTree(tree, x16cHighlightStyle, (from, to, classes) => {
      for (let i = from; i < to; i++) out[i] = byClass.get(classes) ?? `?${classes}`
    })
    return out
  }

  it('paints what scanLine gives, character for character, across a whole bot', () => {
    const source = readFileSync(join(REPO, 'packages/bots/roster/dwarf.asm'), 'utf8')
    const want = [...source].map(() => '.')
    let offset = 0
    for (const text of source.split('\n')) {
      for (const t of scanLine(text)) {
        for (let i = t.from; i < t.to; i++) want[offset + i] = t.type
      }
      offset += text.length + 1
    }
    expect(painted(source)).toEqual(want)
  })

  it('starts each line afresh', () => {
    // Neither a `times` count nor an unterminated string reaches into the next line.
    expect(scan('        times   4').at).toBe('times')
    const source = '        times   4\nnop\ndb "abc\nmov ax, 1'
    const classes = painted(source)
    const at = (word: string) => classes.slice(source.indexOf(word), source.indexOf(word) + 3)
    expect(at('nop')).toEqual(['mnemonic', 'mnemonic', 'mnemonic'])
    expect(at('mov')).toEqual(['mnemonic', 'mnemonic', 'mnemonic'])
  })
})

describe('x16c: colors', () => {
  const rules = parseTokenRules(readFileSync(join(REPO, 'packages/ui/src/tokens.css'), 'utf8'))

  it('colors each class as the spec asks', () => {
    expect(TOKEN_COLORS).toMatchObject({
      mnemonic: '--accent-fg',
      register: '--text-bright',
      number: '--info',
      label: '--warn',
      comment: '--text-muted',
      directive: '--accent-2',
    })
    for (const token of Object.keys(TOKEN_TAGS) as X16cToken[]) {
      const cls = x16cHighlightStyle.style([TOKEN_TAGS[token]])
      expect(x16cHighlightStyle.module?.getRules()).toContain(
        `.${cls} {color: var(${TOKEN_COLORS[token]});}`,
      )
    }
  })

  it('uses only kit tokens, set in every theme, and no color of its own', () => {
    const css = JSON.stringify(EDITOR_THEME)
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/)
    const used = new Set([
      ...Object.values(TOKEN_COLORS),
      ...[...css.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1] as string),
    ])
    expect(used.size).toBeGreaterThan(12)
    for (const theme of THEMES) {
      const tokens = themeTokens(rules, theme)
      expect([theme, [...used].filter((v) => tokens[v] === undefined)]).toEqual([theme, []])
    }
  })
})
