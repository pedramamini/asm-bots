import { describe, expect, it } from 'bun:test'
import { unzipSync } from 'fflate'
import {
  agentPages,
  keysText,
  llmsFullTxt,
  llmsTxt,
  referenceFile,
  SKILL_NAME,
  skillDocLink,
  skillFiles,
  skillZip,
  toMarkdown,
} from '../scripts/agent-docs'
import { isAgentFile, markdownSlug } from '../src/docs/agent-files'
import { docEntries } from '../src/docs/index'

const pages = agentPages()
const skillPages = agentPages(undefined, skillDocLink)
const CLI = '#!/usr/bin/env node\nconsole.log("asmbots")\n'
const decoder = new TextDecoder()

/** The lines of `text` outside its code fences, so a rule about prose skips the code. */
function prose(text: string): string[] {
  let fenced = false
  return text.split('\n').filter((line) => {
    if (/^[>\s]*(```|~~~)/.test(line)) {
      fenced = !fenced
      return false
    }
    return !fenced
  })
}

describe('agent docs: every page', () => {
  it('converts, in reading order', () => {
    expect(pages.map((page) => page.slug)).toEqual(docEntries().map(({ page }) => page.slug))
  })

  it('starts with its heading and its URL', () => {
    for (const page of pages) {
      const [heading, blank, url] = page.markdown.split('\n')
      expect(heading).toMatch(/^# \S/)
      expect(blank).toBe('')
      expect(url).toBe(`URL: https://asmbots.io/docs/${page.slug}.md`)
    }
  })

  it('has no JSX, no MDX import or export, and no fence meta', () => {
    for (const page of [...pages, ...skillPages]) {
      expect({ slug: page.slug, jsx: page.markdown.match(/<[A-Z][^\n]*/g) }).toEqual({
        slug: page.slug,
        jsx: null,
      })
      expect(prose(page.markdown).filter((line) => /^(import|export) /.test(line))).toEqual([])
      expect(page.markdown.match(/^[>\s]*(```|~~~)\S*[ \t]+\S.*$/gm)).toBeNull()
    }
  })

  it('links to the pages as .md on the site, and in the skill as sibling files', () => {
    const all = pages.map((page) => page.markdown).join('\n')
    expect(all).not.toMatch(/\]\(\/docs/)
    expect(all).toContain('](https://asmbots.io/docs/machine/position-independence.md)')
    const skill = skillPages.map((page) => page.markdown).join('\n')
    expect(skill).toContain('](machine-position-independence.md)')
    expect(skill).not.toMatch(/\]\(https:\/\/asmbots\.io\/docs\//)
  })

  it('keeps the data of the diagrams: flags, encodings, figures, shots, and keys', () => {
    const page = (slug: string) => pages.find((p) => p.slug === slug)?.markdown ?? ''
    expect(page('reference/arithmetic')).toContain('**Flags of `add`**')
    expect(page('reference/addressing')).toContain('**Encoding of `mov r/m16, imm16`:** `C7 /0 iw`')
    expect(page('machine/memory')).toContain('> **Figure:** the core as a ring')
    expect(page('start-here')).toContain('](https://asmbots.io/docs-shots/tour-arena.webp)')
    expect(page('tools/keys')).toContain('| `g` then `a` | go to arena |')
  })
})

describe('agent docs: toMarkdown', () => {
  it('writes the components as Markdown', () => {
    const mdx = [
      '# T',
      '',
      '<Note>',
      '',
      'Press <Keys>ctrl+enter</Keys>, then read [death](/docs/machine/death#one-of-each).',
      '',
      '</Note>',
      '',
      '<Warn>',
      '',
      '- one',
      '- two',
      '',
      '</Warn>',
      '',
      '```asm run="vs=imp" fragment',
      'movsw',
      '```',
      '',
      '<Flags op="inc" />',
      '',
      '[top](#t) · [arena](/arena) · [docs](/docs) · [out](https://example.com)',
    ].join('\n')
    expect(toMarkdown(mdx, { slug: 'x/y' })).toBe(
      [
        '# T',
        '',
        '> **Note:** Press `ctrl+enter`, then read [death](https://asmbots.io/docs/machine/death.md#one-of-each).',
        '',
        '> **Warning:**',
        '>',
        '> - one',
        '> - two',
        '',
        '```asm',
        'movsw',
        '```',
        '',
        '**Flags of `inc`** (`*` from the result, `-` unchanged, `0` cleared, `1` set):',
        '',
        '| O | D | I | T | S | Z | A | P | C |',
        '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
        '| * | - | - | - | * | * | * | * | - |',
        '',
        '[top](https://asmbots.io/docs/x/y.md#t) · [arena](https://asmbots.io/arena) · [docs](https://asmbots.io/llms.txt) · [out](https://example.com)',
        '',
      ].join('\n'),
    )
  })

  it('writes an Asm block as a fence and drops imports', () => {
    const mdx = "import x from './x'\n\n<Asm>{`\n    jmp $\n`}</Asm>\n"
    expect(toMarkdown(mdx)).toBe('```asm\njmp $\n```\n')
  })

  it('throws for a component it has no Markdown for', () => {
    expect(() => toMarkdown('<Chart data="x" />')).toThrow('<Chart>: no Markdown form')
  })

  it('writes keys as a sequence', () => {
    expect(keysText(['g', 'a'])).toBe('`g` then `a`')
  })
})

describe('agent docs: llms.txt', () => {
  const text = llmsTxt(pages)

  it('names the site, sums it up, and lists every page', () => {
    expect(text.startsWith('# ASM Bots\n\n> ')).toBe(true)
    for (const page of pages) {
      expect(text).toContain(`- [${page.title}](https://asmbots.io/docs/${page.slug}.md): `)
    }
  })

  it('links the agents files', () => {
    expect(text).toContain('## Agents')
    for (const path of ['/llms-full.txt', '/skill/SKILL.md', '/skill/asm-bots.zip']) {
      expect(text).toContain(`](https://asmbots.io${path})`)
    }
  })

  it('llms-full.txt holds every page', () => {
    const full = llmsFullTxt(pages)
    for (const page of pages) expect(full).toContain(page.markdown.trim())
  })
})

describe('agent docs: the skill', () => {
  const files = skillFiles(skillPages, CLI)
  const zip = skillZip(files)
  const entries = unzipSync(zip)
  const skill = files['SKILL.md'] ?? ''

  it('zips SKILL.md, the CLI, the examples, and the references under asm-bots/', () => {
    const names = Object.keys(entries)
    expect(names).toContain(`${SKILL_NAME}/SKILL.md`)
    expect(names).toContain(`${SKILL_NAME}/bin/asmbots.js`)
    expect(names).toContain(`${SKILL_NAME}/examples/imp.asm`)
    expect(names).toContain(`${SKILL_NAME}/references/machine-memory.md`)
    expect(names.every((name) => name.startsWith(`${SKILL_NAME}/`))).toBe(true)
    expect(names).toEqual([...names].sort())
    expect(decoder.decode(entries[`${SKILL_NAME}/bin/asmbots.js`])).toBe(CLI)
  })

  it('makes the same bytes from the same files', () => {
    expect(skillZip(files)).toEqual(zip)
  })

  it('has frontmatter, and names only files it holds', () => {
    expect(skill).toMatch(/^---\nname: asm-bots\ndescription: .+\n---\n/)
    expect(skill).not.toContain('{{')
    const named = [...skill.matchAll(/\b((?:references|examples)\/[a-z0-9-]+\.(?:md|asm))\b/g)]
    expect(named.length).toBeGreaterThan(20)
    for (const [, path] of named) expect(Object.keys(files)).toContain(path as string)
    for (const [, name] of skill.matchAll(/`((?:machine|strategy|reference)-[a-z-]+\.md)`/g)) {
      expect(Object.keys(files)).toContain(`references/${name}`)
    }
  })

  it('names each reference by its slug', () => {
    expect(referenceFile('strategy/imps')).toBe('strategy-imps.md')
    for (const page of skillPages) {
      expect(files[`references/${referenceFile(page.slug)}`]).toBe(page.markdown)
    }
  })
})

describe('agent files', () => {
  it('are the fixed files and each page as .md', () => {
    expect(isAgentFile('/llms.txt')).toBe(true)
    expect(isAgentFile('/skill/asm-bots.zip')).toBe(true)
    expect(isAgentFile('/docs/strategy/imps.md')).toBe(true)
    expect(isAgentFile('/docs/strategy/imps')).toBe(false)
    expect(markdownSlug('/docs/strategy/imps.md')).toBe('strategy/imps')
    expect(markdownSlug('/docs')).toBeNull()
  })
})
