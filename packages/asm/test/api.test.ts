import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as byName from '@asmbots/asm'
import { ALIASES, MNEMONICS } from '@asmbots/codec'
import { AssembleError, assemble, assembleOrThrow } from '../src/assemble'
import { DIAG_CODES, type Diag, formatDiag } from '../src/diag'
import { lint } from '../src/lint'

const PACKAGE = join(import.meta.dir, '..')

const hex = (bytes: ArrayLike<number>) =>
  Array.from(bytes, (b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')

/** What `fn` throws, or undefined. */
function thrown(fn: () => unknown): unknown {
  try {
    fn()
  } catch (e) {
    return e
  }
  return undefined
}

describe('api: exports', () => {
  it('exports the API by the package name', () => {
    expect(Object.keys(byName).sort()).toEqual([
      'AssembleError',
      'DIAG_CODES',
      'MAX_BOT_BYTES',
      'WORDS',
      'assemble',
      'assembleOrThrow',
      'disassemble',
      'evaluate',
      'evaluateCondition',
      'evaluateExact',
      'formatDiag',
      'formatSource',
      'lint',
      'parse',
      'parseCondition',
      'tokenize',
    ])
    expect(byName.assemble).toBe(assemble)
    expect(byName.MAX_BOT_BYTES).toBe(512)
  })

  it('lists each diagnostic code once', () => {
    expect(new Set(DIAG_CODES).size).toBe(DIAG_CODES.length)
  })
})

describe('api: WORDS', () => {
  const { WORDS } = byName
  /** The codes of the errors of `source` as a bot. */
  const codes = (source: string) => assemble(`${source}\n%name "t"`).diagnostics.map((d) => d.code)

  it('holds the words the parser reserves: none of them can be a label', () => {
    for (const word of [...WORDS.registers, ...WORDS.sizes, ...WORDS.directives]) {
      expect([word, codes(`${word}: nop`)]).toEqual([word, ['bad-label']])
    }
  })

  it('holds every mnemonic and prefix, in any case, and each starts an instruction', () => {
    expect(WORDS.mnemonics).toEqual(new Set([...MNEMONICS, ...ALIASES.keys()]))
    expect([...WORDS.prefixes].sort()).toEqual(['rep', 'repe', 'repne', 'repnz', 'repz'])
    expect(codes('JE $')).toEqual([])
    expect(codes('REPZ CMPSB')).toEqual([])
    for (const target of WORDS.targets) expect(WORDS.mnemonics.has(target)).toBe(true)
    for (const target of ['jmp', 'call', 'jz', 'je', 'loopz', 'jcxz', 'spl']) {
      expect([target, WORDS.targets.has(target)]).toEqual([target, true])
    }
    expect(WORDS.targets.has('mov')).toBe(false)
  })

  it('holds the % directives', () => {
    expect([...WORDS.percent].sort()).toEqual([
      '%author',
      '%define',
      '%name',
      '%strategy',
      '%version',
    ])
    expect(codes('%define STEP 4\n%author "a"\n%strategy "s"\n%version "1"\nadd ax, STEP')).toEqual(
      [],
    )
  })
})

describe('api: assembleOrThrow', () => {
  it('returns what assemble returns for a bot without errors', () => {
    const source = '%name "t"\nstart: jmp start'
    const bot = assembleOrThrow(source)
    expect(bot).toEqual(assemble(source))
    expect(hex(bot.bytes)).toBe('EB FE')
  })

  it('throws an AssembleError with a line per error and every diagnostic', () => {
    const source = 'mov [bx], 0\njz $ + 200\n%name "t"'
    const e = thrown(() => assembleOrThrow(source, { file: 'bots/bad.asm' }))
    expect(e).toBeInstanceOf(AssembleError)
    expect(e).toBeInstanceOf(Error)
    const error = e as AssembleError
    expect(error.name).toBe('AssembleError')
    expect(error.diagnostics).toEqual(assemble(source).diagnostics)
    expect(error.message).toBe(
      [
        'bots/bad.asm:1:5: error: operation size not specified [size-not-specified]',
        'bots/bad.asm:2:4: error: jump out of range [jump-out-of-range]',
      ].join('\n'),
    )
  })

  it('starts each line of the message at line:col without a file', () => {
    expect(thrown(() => assembleOrThrow('nop'))).toMatchObject({
      message: '1:1: error: a bot needs a name: add a `%name "..."` line [missing-name]',
    })
  })

  it('puts errors in the message, not warnings', () => {
    const at = { line: 2, col: 1, len: 3, message: 'm' }
    const warning: Diag = { ...at, severity: 'warning', code: 'unreachable', fix: 'f' }
    const error: Diag = { ...at, severity: 'error', code: 'syntax' }
    const e = new AssembleError([warning, error], 'x.asm')
    expect(e.message).toBe('x.asm:2:1: error: m [syntax]')
    expect(e.diagnostics).toEqual([warning, error])
  })

  it('passes the size limit on', () => {
    const source = '%name "t"\ntimes 20 nop'
    expect(assembleOrThrow(source, { maxBytes: 20 }).bytes).toHaveLength(20)
    expect(() => assembleOrThrow(source, { maxBytes: 19 })).toThrow(
      'the bot is 20 bytes, 1 over the limit of 19 [size-over-cap]',
    )
    expect(() => assembleOrThrow(source, { maxBytes: -1 })).toThrow(RangeError)
  })
})

describe('api: formatDiag', () => {
  it('writes file:line:col: severity: message [code], without the fix', () => {
    const d: Diag = {
      severity: 'warning',
      line: 3,
      col: 9,
      len: 4,
      message: 'm',
      code: 'unreachable',
      fix: 'f',
    }
    expect(formatDiag(d, 'a.asm')).toBe('a.asm:3:9: warning: m [unreachable]')
    expect(formatDiag(d)).toBe('3:9: warning: m [unreachable]')
  })

  it('places a lint warning as the editor does', () => {
    const source = 'nop\n%name "t"'
    const [warning] = lint(source, assemble(source))
    expect(warning === undefined ? undefined : formatDiag(warning, 'x.asm')).toBe(
      'x.asm:2:1: warning: no `%strategy` [no-strategy]',
    )
  })
})

describe('api: dependencies', () => {
  it('depends on @asmbots/codec and nothing else', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE, 'package.json'), 'utf8'))
    expect(pkg.dependencies).toEqual({ '@asmbots/codec': 'workspace:*' })
    for (const field of ['devDependencies', 'peerDependencies', 'optionalDependencies']) {
      expect(pkg[field]).toBeUndefined()
    }
  })

  it('imports only its own files and @asmbots/codec, so it runs in browsers and Workers', () => {
    const src = join(PACKAGE, 'src')
    const files = readdirSync(src, { recursive: true, encoding: 'utf8' }).filter((f) =>
      f.endsWith('.ts'),
    )
    expect(files.length).toBeGreaterThan(10)
    const outside: string[] = []
    for (const file of files) {
      const text = readFileSync(join(src, file), 'utf8')
      for (const [, spec] of text.matchAll(/\b(?:from|import)\s*\(?\s*'([^']+)'/g)) {
        if (spec !== '@asmbots/codec' && !spec?.startsWith('./')) outside.push(`${file}: ${spec}`)
      }
    }
    expect(outside).toEqual([])
  })
})
