import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { OUT, pageRecords, render } from '../scripts/gen-docs-index'
import { buildSearchIndex, excerpt, searchIndex, wordsOf } from '../src/docs/search'

describe('gen-docs-index: the file', () => {
  it('is what the generator writes: run `bun run docs-index` after changing a page', () => {
    expect(readFileSync(OUT, 'utf8')).toBe(render())
  })

  it('says so from the command line with --check', () => {
    const run = Bun.spawnSync(['bun', 'scripts/gen-docs-index.ts', '--check'], {
      cwd: `${import.meta.dir}/..`,
    })
    expect(run.stdout.toString()).toBe('src/docs/generated/search-index.json is up to date\n')
    expect(run.exitCode).toBe(0)
  })
})

describe('gen-docs-index: a page', () => {
  const MDX = [
    "import x from './x'",
    '',
    '# Papers',
    '',
    'A paper copies itself **whole**.',
    '',
    '## Why `spl` before `rep movsw`?',
    '',
    '- the copy runs',
    '- in a new process',
    '',
    '```asm',
    'rep movsw',
    '```',
    '',
    '<Asm>{`movsw`}</Asm>',
    '',
    '<Note>A [link](/docs) inside.</Note>',
    '',
    '| form | bytes |',
    '|---|---|',
    '| `movsw` | A5 |',
    '',
    '### Silk',
    '',
    'Faster.',
  ].join('\n')

  it('cuts at ## and ###, and keeps prose, lists, callouts, and tables, not code', () => {
    expect(pageRecords('strategy/paper', 'paper', MDX)).toEqual([
      {
        slug: 'strategy/paper',
        heading: 'paper',
        anchor: '',
        text: 'A paper copies itself whole.',
      },
      {
        slug: 'strategy/paper',
        heading: 'Why spl before rep movsw?',
        anchor: 'why-spl-before-rep-movsw',
        text: 'the copy runs in a new process A link inside. form bytes movsw A5',
      },
      { slug: 'strategy/paper', heading: 'Silk', anchor: 'silk', text: 'Faster.' },
    ])
  })

  it('refuses two headings with one anchor', () => {
    expect(() => pageRecords('p', 'p', '## Imp\n\n### imp?\n')).toThrow(
      'p.mdx: two headings have the anchor #imp',
    )
  })
})

describe('search', () => {
  const index = buildSearchIndex(
    [
      { slug: 'a', heading: 'imp', anchor: '', text: 'an imp runs movsw forever.' },
      { slug: 'b', heading: 'paper', anchor: '', text: 'rep movsw copies the paper.' },
      { slug: 'b', heading: 'rep movsw', anchor: 'rep-movsw', text: 'the string copy.' },
    ],
    (record) => (record.anchor === '' ? 'strategy' : ''),
  )

  it('reads words in lowercase', () => {
    expect(wordsOf('ModR/M: `rep movsw`, 0x1F!')).toEqual(['modr', 'm', 'rep', 'movsw', '0x1f'])
  })

  it('lists each word once, sorted, with its records', () => {
    expect(index.words.movsw).toEqual([0, 1, 2])
    expect(index.words.strategy).toEqual([0, 1])
    expect(Object.keys(index.words)).toEqual([...Object.keys(index.words)].sort())
  })

  it('finds every word by prefix, the heading hits first', () => {
    const slugs = (query: string) => searchIndex(index, query).map((r) => `${r.slug}#${r.anchor}`)
    expect(slugs('rep movsw')).toEqual(['b#rep-movsw', 'b#'])
    expect(slugs('REP MOV')).toEqual(['b#rep-movsw', 'b#'])
    expect(slugs('movsw')).toEqual(['b#rep-movsw', 'a#', 'b#'])
    expect(slugs('strategy imp')).toEqual(['a#'])
    expect(slugs('vampire')).toEqual([])
    expect(slugs('  ')).toEqual([])
    expect(searchIndex(index, 'movsw', 1)).toHaveLength(1)
  })

  it('cuts a line around the first hit', () => {
    const text = `${'a '.repeat(60)}the stride is 4 ${'b '.repeat(60)}`
    const line = excerpt(text, 'stride', 40)
    expect(line).toContain('stride')
    expect(line.startsWith('…') && line.endsWith('…')).toBe(true)
    expect(excerpt('short', 'x')).toBe('short')
    expect(excerpt(text, 'nothing', 10).startsWith('a a')).toBe(true)
  })
})
