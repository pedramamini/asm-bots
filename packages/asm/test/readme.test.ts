import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assemble, type ListingLine } from '../src/assemble'
import { DIAG_CODES } from '../src/diag'
import { formatSource } from '../src/format'
import * as api from '../src/index'
import { lint } from '../src/lint'

/*
 * The README's tables are claims about the assembler: codes, messages, and bytes. This reads the
 * tables and checks each row, so a change that breaks a claim fails here until the README follows.
 */
const README = readFileSync(join(import.meta.dir, '..', 'README.md'), 'utf8')

const hex = (bytes: ArrayLike<number>) =>
  Array.from(bytes, (b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')

/** `source` as a bot: the `%name` line goes last, so line numbers stay as written. */
const bot = (source: string) => `${source}\n%name "t"`

/** The text under `heading`, up to the next heading of the same level or higher. */
function section(heading: string): string {
  const level = heading.indexOf(' ')
  const lines = README.split('\n')
  const start = lines.indexOf(heading)
  if (start < 0) throw new Error(`the README has no \`${heading}\``)
  let fenced = false
  let end = start + 1
  for (; end < lines.length; end++) {
    const line = lines[end] ?? ''
    if (line.startsWith('```')) fenced = !fenced
    const hashes = /^(#+) /.exec(line)?.[1]
    if (!fenced && hashes !== undefined && hashes.length <= level) break
  }
  return lines.slice(start + 1, end).join('\n')
}

/** The rows of the first table in `text`, as trimmed cells, without the header and the rule. */
function table(text: string): string[][] {
  const lines = text.split('\n')
  const first = lines.findIndex((l) => l.startsWith('|'))
  const rows: string[][] = []
  for (const line of lines.slice(first + 2)) {
    if (!line.startsWith('|')) break
    rows.push(
      line
        .slice(1, -1)
        .split(' | ')
        .map((c) => c.trim()),
    )
  }
  return rows
}

/** The source in a cell of code spans, one line per span: `` `ret`<br>`nop` `` is two lines. */
function source(cell: string | undefined): string {
  return (cell ?? '')
    .split('<br>')
    .map((part) => {
      const span = /^`([^`]+)`$/.exec(part.trim())?.[1]
      if (span === undefined) throw new Error(`not a code cell: ${cell}`)
      return span
    })
    .join('\n')
}

/** The body of the first fenced block of `lang` in `text`. */
function fenced(text: string, lang: string): string {
  const body = new RegExp(`\`\`\`${lang}\\n([\\s\\S]*?)\\n\`\`\``).exec(text)?.[1]
  if (body === undefined) throw new Error(`no \`\`\`${lang} block`)
  return body
}

describe('README: API', () => {
  it('names every export', () => {
    const text = section('## API')
    const missing = Object.keys(api).filter((name) => !new RegExp(`\`${name}\\b`).test(text))
    expect(missing).toEqual([])
  })
})

describe('README: codes table', () => {
  const rows = table(section('### Codes'))

  it('has a row for each code, in the order of DIAG_CODES', () => {
    expect(rows.map(([code]) => code)).toEqual(DIAG_CODES.map((code) => `\`${code}\``))
  })

  for (const [cell, severity, , example] of rows) {
    const code = cell?.slice(1, -1) ?? ''
    it(`gives \`${code}\` for its example, and no other code`, () => {
      const name = code === 'missing-name' ? '' : '\n%name "t"'
      const strategy = code === 'no-strategy' ? '' : '\n%strategy "s"'
      const text = `${source(example)}${name}${strategy}`
      const assembled = assemble(text)
      const all = [...assembled.diagnostics, ...lint(text, assembled)]
      const found = new Set(all.map((d) => `${d.severity} ${d.code}`))
      expect(found).toEqual(new Set([`${severity} ${code}`]))
    })
  }
})

describe('README: dialect', () => {
  for (const heading of ['### Rejected', '### Errors where NASM guesses']) {
    for (const [cell, code, message] of table(section(heading))) {
      const text = source(cell)
      it(`${heading.slice(4)}: \`${text}\` gives ${code}`, () => {
        const found = assemble(bot(text)).diagnostics.map((d) => `\`${d.code}\` ${d.message}`)
        expect(found).toContain(`${code} ${message}`)
      })
    }
  }

  for (const [cell, bytes] of table(section('### Different bytes'))) {
    const text = source(cell)
    it(`Different bytes: \`${text.replace('\n', ' / ')}\` is ${bytes}`, () => {
      const assembled = assemble(bot(text))
      expect(assembled.diagnostics).toEqual([])
      expect(`\`${hex(assembled.bytes)}\``).toBe(bytes ?? '')
    })
  }
})

describe('README: listing', () => {
  const text = section('### Listing')
  const example = fenced(text, 'nasm')
  const assembled = assemble(example)

  it('shows a bot that assembles, lints, and formats clean', () => {
    expect(assembled.diagnostics).toEqual([])
    expect(lint(example, assembled)).toEqual([])
    expect(formatSource(example)).toBe(`${example}\n`)
    expect(text).toContain(`assembles to ${assembled.bytes.length} bytes`)
  })

  it('shows the listing the assembler gives', () => {
    const row = (lineNo: string, address: string, bytes: string, line: string) =>
      `${lineNo.padStart(4)}  ${address}  ${bytes.padEnd(11)}  ${line}`.trimEnd()
    const address = (l: ListingLine) => l.address.toString(16).toUpperCase().padStart(4, '0')
    const rows = assembled.listing.map((l) => row(`${l.lineNo}`, address(l), l.bytesHex, l.source))
    expect(fenced(text, 'text')).toBe([row('line', 'addr', 'bytes', 'source'), ...rows].join('\n'))
  })

  it('shows the symbols and the source map the assembler gives', () => {
    const symbols = [...assembled.symbols].map(([name, value]) => `\`${name}\` ${value}`)
    const last = symbols.pop()
    expect(text).toContain(`Its \`symbols\` are ${symbols.join(', ')}, and ${last}.`)
    expect(text).toContain(`Its \`sourceMap\` is \`${Array.from(assembled.sourceMap).join(' ')}\`.`)
  })
})
