import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
  appRoutes,
  checkDocsLinks,
  type LinkContext,
  linkProblem,
  pageLinks,
} from '../scripts/check-docs-links'
import { DOCS_DIR, pageFile } from '../scripts/gen-docs-index'

describe('check-docs-links: the docs', () => {
  it('have no broken link', () => {
    expect(checkDocsLinks()).toEqual([])
  })

  it('reads the changelog page as the Markdown of CHANGELOG.md', () => {
    const problems = checkDocsLinks((page) => {
      const text = readFileSync(pageFile(page), 'utf8')
      return page.slug === 'changelog'
        ? text.replace('/docs/isa-versions', '/docs/isa-version')
        : text
    })
    const line = readFileSync(`${DOCS_DIR}../../../../CHANGELOG.md`, 'utf8')
      .split('\n')
      .findIndex((text: string) => text.includes('/docs/isa-versions'))
    expect(problems).toEqual([
      {
        file: '../../../../CHANGELOG.md',
        line: line + 1,
        message: '/docs/isa-version: no docs page isa-version',
      },
    ])
  })

  it('says so from the command line', () => {
    const run = Bun.spawnSync(['bun', 'scripts/check-docs-links.ts'], {
      cwd: `${import.meta.dir}/..`,
    })
    expect(run.stdout.toString()).toMatch(/^docs links: \d+ checked, none broken\n$/)
    expect(run.exitCode).toBe(0)
  })

  it('finds a link broken on a real page, with its file and line', () => {
    const problems = checkDocsLinks((page) => {
      const mdx = readFileSync(pageFile(page), 'utf8')
      return page.slug === 'strategy/imps'
        ? mdx.replace('](/docs/strategy/imp-gates', '](/docs/strategy/imp-gate')
        : mdx
    })
    expect(problems).toHaveLength(1)
    expect(problems[0]?.file).toBe('strategy/imps.mdx')
    expect(problems[0]?.message).toMatch(/no docs page strategy\/imp-gate$/)
    const line = readFileSync(`${DOCS_DIR}strategy/imps.mdx`, 'utf8')
      .split('\n')
      .findIndex((text: string) => text.includes('](/docs/strategy/imp-gates'))
    expect(problems[0]?.line).toBe(line + 1)
  })
})

describe('check-docs-links: the rules', () => {
  const ctx: LinkContext = {
    anchors: new Map([
      ['a', new Set(['', 'first'])],
      ['b/c', new Set(['', 'why-spl'])],
    ]),
    routes: appRoutes(),
    figures: new Set(['modrm']),
    hasShot: (name) => name === 'tour-arena',
  }
  const problem = (url: string, kind: 'link' | 'Fig' | 'Shot' = 'link') =>
    linkProblem('a', { url, line: 1, kind }, ctx)

  it('reads Markdown links, JSX hrefs, and pictures, with their lines', () => {
    const mdx = [
      '# Page',
      '',
      'See [b](/docs/b/c#why-spl) and <a href="/editor">x</a>.',
      '',
      '<Note>A [link](#first) inside.</Note>',
      '',
      '<Fig src="modrm" alt="x">cap</Fig>',
      '',
      '<Shot src="tour-arena" alt="y" />',
      '',
      '[ref]: https://example.com',
    ].join('\n')
    expect(pageLinks(mdx)).toEqual([
      { url: '/docs/b/c#why-spl', line: 3, kind: 'link' },
      { url: '/editor', line: 3, kind: 'link' },
      { url: '#first', line: 5, kind: 'link' },
      { url: 'modrm', line: 7, kind: 'Fig' },
      { url: 'tour-arena', line: 9, kind: 'Shot' },
      { url: 'https://example.com', line: 11, kind: 'link' },
    ])
  })

  it('passes pages, headings, routes, and pictures that are there', () => {
    for (const url of ['/docs/b/c', '/docs/b/c#why-spl', '#first', '/docs', '/docs/a#']) {
      expect(problem(url)).toBeUndefined()
    }
    for (const url of ['/', '/editor', '/arena', '/hills/core', '/tournaments/', '/settings']) {
      expect(problem(url)).toBeUndefined()
    }
    expect(problem('https://bun.sh')).toBeUndefined()
    expect(problem('https://asmbots.io/docs/b/c#why-spl')).toBeUndefined()
    expect(problem('mailto:a@b.c')).toBeUndefined()
    expect(problem('modrm', 'Fig')).toBeUndefined()
    expect(problem('tour-arena', 'Shot')).toBeUndefined()
  })

  it('names what is missing', () => {
    expect(problem('/docs/b')).toBe('/docs/b: no docs page b')
    // A link to the canonical site is the app's path there: CHANGELOG.md links so.
    expect(problem('https://asmbots.io/docs/b')).toBe('/docs/b: no docs page b')
    expect(problem('https://asmbots.io/nowhere')).toBe('/nowhere: no route matches /nowhere')
    expect(problem('/docs/b/c#why')).toBe('/docs/b/c#why: b/c has no heading #why')
    expect(problem('#nope')).toBe('#nope: a has no heading #nope')
    expect(problem('/nowhere')).toBe('/nowhere: no route matches /nowhere')
    expect(problem('/hills/a/b')).toBe('/hills/a/b: no route matches /hills/a/b')
    expect(problem('/docs#top')).toBe('/docs#top: the contents page has no headings to link to')
    expect(problem('../b/c')).toMatch(/a relative link/)
    expect(problem('http://bun.sh')).toMatch(/must be https/)
    expect(problem('javascript:alert(1)')).toMatch(/must be https/)
    expect(problem('https://')).toMatch(/not a URL/)
    expect(problem('core', 'Fig')).toBe('<Fig src="core">: no such figure')
    expect(problem('tour-x', 'Shot')).toBe('<Shot src="tour-x">: no /docs-shots/tour-x.webp')
  })
})
