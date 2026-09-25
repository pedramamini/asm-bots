/**
 * The docs for AI agents, written into the web build (`bun run build:vite` runs this after Vite):
 *
 * - `/docs/<slug>.md`: each page of `src/docs/nav.ts` as plain Markdown, from the same MDX the
 *   site renders. The docs' components become Markdown: `Note` and `Warn` are quotes, `Flags`,
 *   `Encoding`, and the keyboard map are tables of their data, `Fig` is its description, `Shot`
 *   an image, and `Keys` inline code. Code fences lose their meta, and site links point at the
 *   `.md` files on https://asmbots.io.
 * - `/llms.txt` (https://llmstxt.org) and `/llms-full.txt`: the index, and every page in one file.
 * - `/skill/SKILL.md` and `/skill/asm-bots.zip`: the agent skill (`skill/SKILL.md`, its
 *   instructions), with the pages as `references/`, the roster as `examples/`, and the CLI
 *   bundled for Node as `bin/asmbots.js`.
 *
 * `bun scripts/agent-docs.ts [dist]` writes them into `dist` (default `apps/web/dist`).
 * `test/agent-docs.test.ts` checks the output without a build.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROSTER, rosterSource } from '@asmbots/bots'
import { createProcessor } from '@mdx-js/mdx'
import { type Zippable, zipSync } from 'fflate'
import { SITE_URL, sitePath } from '../src/app/site'
import { blockSource } from '../src/docs/Asm'
import {
  docMarkdownPath,
  LLMS_FULL_TXT,
  LLMS_TXT,
  SKILL_MD,
  SKILL_ZIP,
} from '../src/docs/agent-files'
import { SHOT_PATH } from '../src/docs/blocks'
import { allBindings } from '../src/docs/keymap'
import { DOCS, type DocPage, docSource } from '../src/docs/nav'
import { encodingFields, findForm } from '../src/docs/reference'
import { REMARK_PLUGINS } from '../src/docs/remark'
import { FLAG_NAMES, opcodeEntry } from '../src/features/editor/cm/opcodes'
import { pageFile } from './gen-docs-index'

const APP_DIR = fileURLToPath(new URL('../', import.meta.url))
/** Where the build is: `apps/web/dist`. */
export const DIST = join(APP_DIR, 'dist')
/** The skill's instructions, with `{{references}}` and `{{examples}}` for the generated lists. */
export const SKILL_TEMPLATE = join(APP_DIR, 'skill/SKILL.md')
const CLI_DIR = fileURLToPath(new URL('../../cli/', import.meta.url))

/** The name of the skill, and of the folder in its zip. */
export const SKILL_NAME = 'asm-bots'

interface Point {
  line: number
  column: number
  offset?: number
}

interface MdNode {
  type: string
  name?: string | null
  value?: string
  url?: string
  meta?: string | null
  attributes?: { type: string; name?: string; value?: unknown }[]
  position?: { start: Point; end: Point }
  children?: MdNode[]
}

/** How a page's links read: where a docs page (and its anchor) is, and which page this is. */
export interface MarkdownOptions {
  /** How the file reads: MDX, or plain Markdown (the changelog). */
  format?: 'md' | 'mdx'
  /** The page's slug: a bare `#anchor` link points into it. */
  slug?: string
  /** The target of a link to docs page `slug` at `hash` (no `#`; empty for the top). */
  docLink?: (slug: string, hash: string) => string
}

/** A docs page's Markdown on the site: `https://asmbots.io/docs/strategy/imps.md#stride`. */
export function webDocLink(slug: string, hash: string): string {
  return `${SITE_URL}${docMarkdownPath(slug)}${hash === '' ? '' : `#${hash}`}`
}

/** The file name of a page in the skill's `references/`: `strategy/imps` is `strategy-imps.md`. */
export function referenceFile(slug: string): string {
  return `${slug.replaceAll('/', '-')}.md`
}

/** A docs page's file beside the others in the skill's `references/`. */
export function skillDocLink(slug: string, hash: string): string {
  return `${referenceFile(slug)}${hash === '' ? '' : `#${hash}`}`
}

/** The string value of a JSX element's attribute, or undefined when it has none. */
function attribute(node: MdNode, name: string): string | undefined {
  const found = node.attributes?.find((a) => a.type === 'mdxJsxAttribute' && a.name === name)
  if (found === undefined) return undefined
  if (typeof found.value === 'string') return found.value
  throw new Error(`<${node.name} ${name}>: only a plain string converts to Markdown`)
}

function required(node: MdNode, name: string): string {
  const value = attribute(node, name)
  if (value === undefined) throw new Error(`<${node.name}> needs ${name}`)
  return value
}

/** A quote of `body` under a bold label: the Markdown form of `Note`, `Warn`, and `Fig`. */
function quote(label: string, body: string, inline: boolean): string {
  const text = inline ? `**${label}:** ${body.trim()}` : `**${label}:**\n\n${body.trim()}`
  return text
    .split('\n')
    .map((line) => (line.trim() === '' ? '>' : `> ${line}`))
    .join('\n')
}

/** A Markdown table: a header row, then the rows. */
function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const line = (cells: readonly string[]) => `| ${cells.join(' | ')} |`
  return [line(header), line(header.map(() => '---')), ...rows.map(line)].join('\n')
}

/** Keys as text: `g a` (one, then the other) is `` `g` then `a` ``; `ctrl+enter` stays one. */
export function keysText(keys: readonly string[]): string {
  return keys.map((key) => `\`${key}\``).join(' then ')
}

const EFFECTS = '`*` from the result, `-` unchanged, `0` cleared, `1` set'

/** `<Flags op="add" />` or `<Flags set="CZ" />` as a table of ODITSZAPC. */
function flagsTable(node: MdNode): string {
  const op = attribute(node, 'op')
  let effects: string
  let caption: string
  if (op !== undefined) {
    const entry = opcodeEntry(op)
    if (entry?.kind !== 'mnemonic') throw new Error(`<Flags op="${op}">: no such mnemonic`)
    effects = entry.doc.flags
    caption = `**Flags of \`${op}\`** (${EFFECTS}):`
  } else {
    const set = (attribute(node, 'set') ?? '').toUpperCase()
    effects = [...FLAG_NAMES].map((flag) => (set.includes(flag) ? '*' : '-')).join('')
    caption = `**Flags** (\`*\` marks ${[...set].join(', ')}):`
  }
  return `${caption}\n\n${table([...FLAG_NAMES], [[...effects]])}`
}

/** `<Encoding form="mov r/m16, imm16" />` as its fields in memory order, with their sizes. */
function encodingTable(node: MdNode): string {
  const { syntax, encoding } = findForm(required(node, 'form'))
  const fields = encodingFields(encoding)
  const min = fields.reduce((sum, f) => sum + f.bytes[0], 0)
  const max = fields.reduce((sum, f) => sum + f.bytes[1], 0)
  const size = min === max ? `${min} ${min === 1 ? 'byte' : 'bytes'}` : `${min} to ${max} bytes`
  const sizeOf = ([lo, hi]: readonly [number, number]) => (lo === hi ? `${lo}` : `${lo} to ${hi}`)
  const rows = fields.map((f) => [
    `\`${f.kind === 'modrm' ? `mod ${f.reg} r/m` : f.value}\``,
    f.label,
    sizeOf(f.bytes),
  ])
  return `**Encoding of \`${syntax}\`:** \`${encoding}\`, ${size}, in memory order:\n\n${table(
    ['field', 'holds', 'bytes'],
    rows,
  )}`
}

/** `<KeyMap />`: every key of the app, a table per group. */
function keyMapTables(): string {
  const groups = new Map<string, string[][]>()
  for (const { keys, description, group } of allBindings()) {
    const name = group ?? 'other'
    const rows = groups.get(name) ?? []
    rows.push([keysText(keys), description])
    groups.set(name, rows)
  }
  return [...groups]
    .map(([group, rows]) => `**${group}**\n\n${table(['keys', 'does'], rows)}`)
    .join('\n\n')
}

/**
 * The Markdown of one docs file: the MDX less its JSX, its imports, and its fences' meta, with
 * each site link made absolute (`docLink` for docs pages). Throws for a component it cannot
 * write as Markdown, so a new one fails the tests rather than reach an agent as JSX.
 */
export function toMarkdown(source: string, options: MarkdownOptions = {}): string {
  const { format = 'mdx', slug = '', docLink = webDocLink } = options
  const tree = createProcessor({ format, remarkPlugins: REMARK_PLUGINS }).parse(source) as MdNode
  const start = (node: MdNode) => node.position?.start.offset ?? 0
  const end = (node: MdNode) => node.position?.end.offset ?? 0

  /** The link's target on the web or in the skill, or the URL as it is when it leaves the site. */
  const target = (url: string): string => {
    const path = sitePath(url) ?? url
    if (path.startsWith('#')) return slug === '' ? path : docLink(slug, path.slice(1))
    if (!path.startsWith('/')) return url
    const at = path.indexOf('#')
    const bare = at < 0 ? path : path.slice(0, at)
    const hash = at < 0 ? '' : path.slice(at + 1)
    if (bare === '/docs' || bare === '/docs/') return `${SITE_URL}${LLMS_TXT}`
    if (bare.startsWith('/docs/')) {
      // A page, or its Markdown file: both are the page's Markdown here.
      return docLink(bare.slice('/docs/'.length).replace(/(\.md|\/)$/, ''), hash)
    }
    return `${SITE_URL}${path}`
  }

  /** The source of `node` from `from` to `to`, each child written by `write`. */
  const inner = (node: MdNode, from = start(node), to = end(node)): string => {
    let out = ''
    let at = from
    for (const child of node.children ?? []) {
      out += source.slice(at, start(child)) + write(child)
      at = end(child)
    }
    return out + source.slice(at, to)
  }

  /** What a JSX element holds, less the indent of the element's own column. */
  const content = (node: MdNode): string => {
    const children = node.children ?? []
    const first = children[0]
    const last = children[children.length - 1]
    if (first === undefined || last === undefined) return ''
    const pad = ' '.repeat((node.position?.start.column ?? 1) - 1)
    return inner(node, start(first), end(last))
      .split('\n')
      .map((line, at) => (at > 0 && line.startsWith(pad) ? line.slice(pad.length) : line))
      .join('\n')
      .trim()
  }

  const element = (node: MdNode): string => {
    const body = () => content(node)
    // The label joins a first paragraph; a list, code, or table goes on the lines below it.
    const startsWithText = () =>
      !['list', 'code', 'table', 'blockquote', 'heading'].includes(node.children?.[0]?.type ?? '')
    switch (node.name) {
      case 'Note':
        return quote('Note', body(), startsWithText())
      case 'Warn':
        return quote('Warning', body(), startsWithText())
      case 'Keys':
        return keysText(body().split(/\s+/).filter(Boolean))
      case 'Flags':
        return flagsTable(node)
      case 'Encoding':
        return encodingTable(node)
      case 'KeyMap':
        return keyMapTables()
      case 'Fig': {
        const caption = body()
        return quote(
          'Figure',
          `${required(node, 'alt')}.${caption === '' ? '' : ` ${caption}`}`,
          true,
        )
      }
      case 'Asm':
        // `<Asm>{`…`}</Asm>`: the same x16c block as a fenced ```asm one.
        return `\`\`\`asm\n${blockSource(body())}\n\`\`\``
      case 'br':
        // A line break in a table cell: GitHub's Markdown takes the HTML tag.
        return '<br>'
      case 'Shot': {
        const alt = required(node, 'alt')
        const image = `![${alt}](${SITE_URL}${SHOT_PATH}${required(node, 'src')}.webp)`
        const caption = body()
        return caption === '' ? image : `${image}\n\n${caption}`
      }
      default:
        throw new Error(`<${node.name ?? 'fragment'}>: no Markdown form; add one to agent-docs.ts`)
    }
  }

  /** A link, image, or definition with its URL made absolute. */
  const relink = (node: MdNode): string => {
    const text = inner(node)
    const url = node.url ?? ''
    const next = target(url)
    if (next === url) return text
    const at = node.type === 'definition' ? text.indexOf(']:') + 2 : text.lastIndexOf('](') + 2
    if (at < 2) return text
    const tail = text.slice(at)
    const written = /^\s*<?([^\s>)]*)>?/.exec(tail)?.[1] ?? ''
    const cut = tail.indexOf(written)
    return text.slice(0, at) + tail.slice(0, cut) + next + tail.slice(cut + written.length)
  }

  const write = (node: MdNode): string => {
    switch (node.type) {
      case 'mdxjsEsm':
        return ''
      case 'html':
        // An HTML comment (the changelog's note to its editors) is for the file's readers only.
        return /^<!--[\s\S]*-->$/.test((node.value ?? '').trim()) ? '' : inner(node)
      case 'mdxFlowExpression':
      case 'mdxTextExpression': {
        const value = (node.value ?? '').trim()
        if (/^\/\*[\s\S]*\*\/$/.test(value)) return ''
        const literal = /^'([^'\\]*)'$|^"([^"\\]*)"$|^`((?:[^`\\$]|\$(?!\{))*)`$/.exec(value)
        if (literal === null) throw new Error(`{${value}}: only a string converts to Markdown`)
        return literal[1] ?? literal[2] ?? literal[3] ?? ''
      }
      case 'mdxJsxFlowElement':
      case 'mdxJsxTextElement':
        return element(node)
      case 'code': {
        const text = source.slice(start(node), end(node))
        // ```asm run="vs=imp" is ```asm: the meta drives the site's buttons, not the code.
        return text.replace(/^([`~]{3,})([^\s`~]*)[^\n]*/, '$1$2')
      }
      case 'link':
      case 'image':
      case 'definition':
        return relink(node)
      default:
        return inner(node)
    }
  }

  return `${write(tree)
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()}\n`
}

/** One docs page for agents: where it sits, and its Markdown. */
export interface AgentPage {
  slug: string
  /** The sidebar's title, lowercase. */
  title: string
  section: string
  blurb: string
  /** Its Markdown on the site. */
  url: string
  markdown: string
}

/** The page's file on disk. */
export function readPage(page: DocPage): string {
  return readFileSync(pageFile(page), 'utf8')
}

/**
 * Every docs page as Markdown, in reading order. Each starts with its `# ` heading and the URL of
 * its Markdown on the site; `docLink` says where its links to other pages go.
 */
export function agentPages(
  read: (page: DocPage) => string = readPage,
  docLink: MarkdownOptions['docLink'] = webDocLink,
): AgentPage[] {
  return DOCS.flatMap((section) =>
    section.pages.map((page) => {
      const url = webDocLink(page.slug, '')
      const body = toMarkdown(read(page), {
        format: docSource(page).format,
        slug: page.slug,
        docLink,
      })
      const heading = /^# .*$/m.exec(body)
      const [title, rest] =
        heading === null
          ? [`# ${capitalize(page.title)}`, body]
          : [
              heading[0],
              body.slice(0, heading.index) + body.slice(heading.index + heading[0].length),
            ]
      const markdown = `${title}\n\nURL: ${url}\n\n${rest.trim()}\n`
      return {
        slug: page.slug,
        title: page.title,
        section: section.title,
        blurb: page.blurb,
        url,
        markdown,
      }
    }),
  )
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** The pages grouped by section, in reading order. */
function bySection(pages: readonly AgentPage[]): [string, AgentPage[]][] {
  const sections = new Map<string, AgentPage[]>()
  for (const page of pages)
    sections.set(page.section, [...(sections.get(page.section) ?? []), page])
  return [...sections]
}

/** What llms.txt says ASM Bots is: the rules a bot author needs first (ISA_SPEC §1, §5). */
const SUMMARY =
  'ASM Bots is Core War in a real 16-bit 8086 subset, "x16c v1": bots of up to 512 bytes share ' +
  'one 64 KB core and run one instruction a cycle each, and a process that runs a zero byte ' +
  '(DAT) dies. The last bot with a live process wins.'

const FACTS = [
  'The core is 65,536 bytes, one flat ring with no segments: addresses and values wrap. It starts zeroed, and the byte `0x00` is DAT.',
  'A process dies when it runs DAT (`0x00`), `hlt`, `int3`, or an undefined opcode, or when `div` or `idiv` fails. A bot with no process left is dead.',
  'Every instruction costs one cycle, and each cycle every living bot runs one instruction of the process at the front of its queue. `spl` adds a process (up to 64 a bot): it buys resilience, not speed.',
  'The loader puts each bot at a random base from a seeded PRNG, at least 1,024 bytes from any other, and does not relocate it: `[label]` is absolute, so a bot finds its base with `call`, `pop bx`, `sub bx, .here`.',
  'A round ends when one bot or none is alive, or at the cycle cap (100,000; 80,000 on the hills). Each of S survivors of N bots scores floor((N*N - 1) / S): 3 for a duel won, 1 each for a tie.',
  'Source is NASM syntax with `%name` (required), `%author`, and `%strategy` directives. `rep` runs one iteration a cycle.',
]

/** `/llms.txt`: what ASM Bots is, then a link to each page's Markdown, by section. */
export function llmsTxt(pages: readonly AgentPage[]): string {
  const sections = bySection(pages).map(
    ([section, list]) =>
      `## ${capitalize(section)}\n\n${list
        .map((page) => `- [${page.title}](${page.url}): ${page.blurb}`)
        .join('\n')}`,
  )
  const agents = [
    `- [every page in one file](${SITE_URL}${LLMS_FULL_TXT}): the docs above, in reading order, as Markdown.`,
    `- [the asm-bots skill](${SITE_URL}${SKILL_MD}): how an agent writes, tests, and submits a bot.`,
    `- [the skill download](${SITE_URL}${SKILL_ZIP}): the skill folder with these docs, the roster bots as examples, and the \`asmbots\` CLI for Node.`,
    `- [the api](${webDocLink('tools/api', '')}): the server's routes and API tokens.`,
  ]
  return `${[
    '# ASM Bots',
    `> ${SUMMARY}`,
    FACTS.map((fact) => `- ${fact}`).join('\n'),
    ...sections,
    `## Agents\n\n${agents.join('\n')}`,
  ].join('\n\n')}\n`
}

/** `/llms-full.txt`: every page, in reading order, each under its heading and URL. */
export function llmsFullTxt(pages: readonly AgentPage[]): string {
  return `# ASM Bots docs\n\n> ${SUMMARY}\n\n${pages.map((page) => page.markdown.trim()).join('\n\n')}\n`
}

/**
 * The roster bots the skill ships as examples: the six Core War families, not the painters (made
 * to be watched) or the test bots.
 */
export function exampleBots() {
  return ROSTER.filter((entry) => entry.family !== 'test' && entry.family !== 'painter')
}

/** SKILL.md: the template with the lists of references and examples written in. */
export function skillMarkdown(
  pages: readonly AgentPage[],
  template = readFileSync(SKILL_TEMPLATE, 'utf8'),
): string {
  const references = bySection(pages)
    .map(
      ([section, list]) =>
        `**${section}**\n\n${list
          .map((page) => `- \`references/${referenceFile(page.slug)}\`: ${page.blurb}`)
          .join('\n')}`,
    )
    .join('\n\n')
  const examples = exampleBots()
    .map((bot) => `- \`examples/${bot.slug}.asm\` (${bot.family}): ${bot.blurb}`)
    .join('\n')
  return template.replace('{{references}}', references).replace('{{examples}}', examples)
}

/** The files of the skill folder, by path under it, and the CLI's to mark executable. */
export function skillFiles(
  pages: readonly AgentPage[],
  cli: string,
  template?: string,
): Record<string, string> {
  const files: Record<string, string> = { 'SKILL.md': skillMarkdown(pages, template) }
  for (const page of pages) files[`references/${referenceFile(page.slug)}`] = page.markdown
  for (const bot of exampleBots()) files[`examples/${bot.slug}.asm`] = rosterSource(bot.slug)
  files['bin/asmbots.js'] = cli
  return files
}

/**
 * The skill as a zip of `asm-bots/`: entries sorted, one fixed time, so the same files make the
 * same bytes. The time is local (a zip stores no zone), so it is built from local parts.
 */
export function skillZip(files: Readonly<Record<string, string>>): Uint8Array {
  const mtime = new Date(2026, 0, 1, 0, 0, 0)
  const encoder = new TextEncoder()
  const entries: Zippable = {}
  for (const path of Object.keys(files).sort()) {
    // Made on Unix (os 3), so unzip keeps the modes: the CLI is executable.
    const mode = path.startsWith('bin/') ? 0o100755 : 0o100644
    entries[`${SKILL_NAME}/${path}`] = [
      encoder.encode(files[path]),
      { mtime, os: 3, attrs: mode << 16, level: 9 },
    ]
  }
  return zipSync(entries, { mtime })
}

/**
 * The CLI bundled for Node: `apps/cli`'s `bundle` script when it has one, else the same
 * `bun build`, into a temporary folder. Its first line runs it with Node.
 */
export function buildCli(): string {
  const scripts = JSON.parse(readFileSync(join(CLI_DIR, 'package.json'), 'utf8')).scripts ?? {}
  let file = join(CLI_DIR, 'dist/asmbots.js')
  let temp: string | undefined
  if (typeof scripts.bundle === 'string') {
    execFileSync('bun', ['run', 'bundle'], { cwd: CLI_DIR, stdio: 'ignore' })
  } else {
    temp = mkdtempSync(join(tmpdir(), 'asmbots-cli-'))
    file = join(temp, 'asmbots.js')
    execFileSync('bun', ['build', 'src/main.ts', '--target=node', `--outfile=${file}`], {
      cwd: CLI_DIR,
      stdio: 'ignore',
    })
  }
  if (!existsSync(file)) throw new Error(`the CLI bundle did not write ${file}`)
  const text = readFileSync(file, 'utf8')
  if (temp !== undefined) rmSync(temp, { recursive: true, force: true })
  return `#!/usr/bin/env node\n${text.replace(/^#![^\n]*\n/, '')}`
}

/** Every file this writes, by its path on the site: text, or the zip's bytes. */
export function agentFiles(cli: string): Map<string, string | Uint8Array> {
  const pages = agentPages()
  const out = new Map<string, string | Uint8Array>()
  out.set(LLMS_TXT, llmsTxt(pages))
  out.set(LLMS_FULL_TXT, llmsFullTxt(pages))
  for (const page of pages) out.set(docMarkdownPath(page.slug), page.markdown)
  const skill = skillFiles(agentPages(readPage, skillDocLink), cli)
  out.set(SKILL_MD, skill['SKILL.md'] as string)
  out.set(SKILL_ZIP, skillZip(skill))
  return out
}

if (import.meta.main) {
  const dist = process.argv[2] ?? DIST
  if (!existsSync(dist)) throw new Error(`no build at ${dist}: run vite build first`)
  const files = agentFiles(buildCli())
  for (const [path, body] of files) {
    const file = join(dist, path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, body)
  }
  const zip = files.get(SKILL_ZIP) as Uint8Array
  console.log(
    `agent docs: ${files.size} files in ${relative(process.cwd(), dist) || '.'}, ${SKILL_ZIP} ${(zip.length / 1024).toFixed(1)} KB`,
  )
}
