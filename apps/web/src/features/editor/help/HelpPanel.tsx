/**
 * The editor's help panel (PRODUCT_SPEC §3): what the word under the cursor is, an instruction, a
 * directive, or a register, with its forms, flags, and an example; a search over them all; and,
 * with neither, a short guide to a bot and every instruction by family. Each topic links to its
 * place in the docs, in a new tab, so the editor keeps its place.
 */
import { Chip, cx, Input, Panel } from '@asmbots/ui'
import { ExternalLink } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { FAMILY_NAMES, FLAG_NAMES, opcodeEntries } from '../cm/opcodes'
import { type CursorTopic, useCursorTopic } from './cursor'
import { docsHref, searchTopics, summaryOf, type Topic, topicOf } from './topics'

export interface HelpPanelProps {
  /** The word under the editor's cursor. */
  cursor: CursorTopic
  /** A coach mark over the search: the first visit's, while the debug controls are hidden. */
  coach?: ReactNode | undefined
}

/** The most results a search lists. */
const MAX_RESULTS = 40

/** A topic picked from the search or the index, and the cursor's word when it was picked. */
interface Pick {
  readonly name: string
  readonly cursor: string | null
}

export function HelpPanel({ cursor, coach }: HelpPanelProps) {
  const atCursor = useCursorTopic(cursor)
  const [query, setQuery] = useState('')
  const [pick, setPick] = useState<Pick | null>(null)
  // A pick holds until the cursor moves to another word: then the panel follows the cursor again.
  const picked = pick !== null && pick.cursor === atCursor ? pick.name : null
  const name = picked ?? atCursor
  const topic = name === null ? null : topicOf(name)
  const results = useMemo(() => searchTopics(query).slice(0, MAX_RESULTS), [query])
  const open = (next: string) => {
    setPick({ name: next, cursor: atCursor })
    setQuery('')
  }

  return (
    <Panel
      dense
      title="help"
      status={
        query !== ''
          ? `${results.length} found`
          : topic === null
            ? ''
            : picked === null
              ? 'at the cursor'
              : 'picked'
      }
      aria-label="help"
    >
      <div className="flex min-w-0 flex-col gap-3">
        {coach}
        <Input
          aria-label="search the instructions, directives, and registers"
          placeholder="search: mov, loop, %name, stack"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && query !== '') {
              event.preventDefault()
              setQuery('')
            } else if (event.key === 'Enter' && results[0] !== undefined) {
              event.preventDefault()
              open(results[0].name)
            }
          }}
          className="w-full"
        />
        {query !== '' ? (
          <Results results={results} onOpen={open} />
        ) : topic === null ? (
          <Guide onOpen={open} />
        ) : (
          <TopicCard topic={topic} onBack={picked === null ? undefined : () => setPick(null)} />
        )}
      </div>
    </Panel>
  )
}

/** A search's topics: each its name and its one line; a press opens it. */
function Results({
  results,
  onOpen,
}: {
  results: readonly Topic[]
  onOpen: (name: string) => void
}) {
  if (results.length === 0) {
    return <p className="text-data text-muted">nothing found: try what it does, as copy or jump.</p>
  }
  return (
    <ul aria-label="search results" className="-mx-2">
      {results.map((topic) => (
        <li key={`${topic.kind}:${topic.name}`}>
          <button
            type="button"
            onClick={() => onOpen(topic.name)}
            className={cx(ROW, 'flex w-full min-w-0 items-baseline gap-3 px-2 py-0.5 text-left')}
          >
            <span className="w-20 shrink-0 text-accent-fg">{topic.name}</span>
            <span className="min-w-0 flex-1 truncate text-text">
              {summaryOf(topic).replace(/`/g, '')}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

/** Text whose `code spans` show as code. */
function Prose({ text }: { text: string }) {
  return text.split(/(`[^`]*`)/).map((part, at) =>
    at % 2 === 1 ? (
      // A span's place in the text is its identity.
      <code key={at} className="text-bright">
        {part.slice(1, -1)}
      </code>
    ) : (
      part
    ),
  )
}

/** A row that takes a press: the panel's hover and focus fill. */
const ROW =
  'rounded-sm text-data transition-colors duration-120 ease-out hover:bg-panel-2 focus-visible:bg-panel-2 focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-accent'

/** A titled part of a card: an uppercase label over its body. */
function Part({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="flex flex-col gap-1">
      <h3 className="text-panel-status text-muted uppercase">{label}</h3>
      {children}
    </section>
  )
}

/** Code and its bytes, two columns, as a listing shows them. */
function CodeRows({ rows }: { rows: readonly (readonly [code: string, bytes: string])[] }) {
  return (
    <table className="w-full border-collapse text-data">
      <tbody>
        {rows.map(([code, bytes], at) => (
          // A form can repeat in an example: its place is its identity.
          <tr key={at} className="border-b border-border last:border-b-0">
            <td className="py-0.5 pr-3 whitespace-pre text-bright">{code}</td>
            <td className="py-0.5 text-right whitespace-nowrap text-muted">{bytes}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** FLAGS, `O D I T S Z A P C`, the ones the instruction changes lit, each over what it does. */
function FlagRow({ flags }: { flags: string }) {
  const effects = [...FLAG_NAMES].map((name, k) => [name, flags[k] ?? '-'] as const)
  const changed = effects.filter(([, e]) => e !== '-')
  return (
    <div
      role="img"
      aria-label={
        changed.length === 0
          ? 'no flag changes'
          : changed.map(([n, e]) => `${n} ${EFFECTS[e] ?? e}`).join(', ')
      }
      className="grid w-fit grid-cols-9 gap-px text-center text-data"
    >
      {effects.map(([name, effect]) => (
        <span
          key={name}
          className={cx(
            'w-6 rounded-sm border',
            effect === '-'
              ? 'border-border text-muted'
              : 'border-accent-45 bg-accent-10 text-accent-fg',
          )}
        >
          {name}
          <br />
          {effect}
        </span>
      ))}
    </div>
  )
}

const EFFECTS: Readonly<Record<string, string>> = {
  '*': 'from the result',
  '0': 'cleared',
  '1': 'set',
}

/** A topic: its name and kind, what it does, its forms, flags, example, and the docs' link. */
function TopicCard({ topic, onBack }: { topic: Topic; onBack: (() => void) | undefined }) {
  const kind =
    topic.kind === 'opcode'
      ? topic.entry.kind === 'prefix'
        ? 'prefix'
        : (FAMILY_NAMES[topic.entry.doc.family] ?? 'instruction')
      : topic.kind
  const aliases = topic.kind === 'opcode' ? topic.entry.doc.aliases : []
  return (
    <article aria-label={topic.name} className="flex min-w-0 flex-col gap-3">
      <header className="flex min-w-0 flex-wrap items-baseline gap-2">
        <h3 className="text-body text-bright">{topic.name}</h3>
        {aliases.length > 0 && <span className="text-data text-muted">{aliases.join(' ')}</span>}
        <Chip className="ml-auto">{kind}</Chip>
      </header>
      <p className="text-data text-text">
        <Prose text={summaryOf(topic)} />
      </p>
      {topic.kind === 'opcode' && topic.entry.kind === 'mnemonic' && (
        <>
          {topic.entry.doc.kills && (
            <p className="text-data text-danger">running it kills the process.</p>
          )}
          <Part label="forms">
            <CodeRows rows={topic.entry.doc.forms.map((f) => [f.syntax, f.encoding] as const)} />
          </Part>
          <Part label="flags">
            <FlagRow flags={topic.entry.doc.flags} />
          </Part>
        </>
      )}
      {topic.kind === 'opcode' && topic.entry.kind === 'prefix' && (
        <Part label="takes">
          <p className="text-data text-text">{topic.entry.doc.takes.join(' · ')}</p>
        </Part>
      )}
      {topic.kind === 'opcode' ? (
        <Part label="example">
          <CodeRows rows={topic.entry.doc.example.map((l) => [l.source, l.bytes] as const)} />
        </Part>
      ) : (
        <Part label="written">
          <code className="text-data whitespace-pre text-bright">{topic.doc.syntax}</code>
        </Part>
      )}
      <div className="flex flex-wrap items-center gap-3 text-data">
        <DocsLink href={docsHref(topic)}>read more in the docs</DocsLink>
        {onBack !== undefined && (
          <button type="button" onClick={onBack} className={cx(ROW, 'px-1 text-muted')}>
            back to the cursor
          </button>
        )}
      </div>
    </article>
  )
}

/** A link into the docs, in a new tab: the editor keeps its place. */
function DocsLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener"
      className="inline-flex items-center gap-1 rounded-sm text-accent-fg underline underline-offset-2 focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      {children}
      <ExternalLink aria-hidden="true" size={12} strokeWidth={1.75} />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}

/** The families in reading order, each with its instructions. */
function families(): [string, string[]][] {
  const out = new Map<string, string[]>()
  for (const entry of opcodeEntries()) {
    const family = entry.kind === 'prefix' ? 'string' : entry.doc.family
    const list = out.get(family)
    if (list) list.push(entry.name)
    else out.set(family, [entry.name])
  }
  return [...out]
}

/** With no topic: how to use the panel, a bot in brief, and every instruction by family. */
function Guide({ onOpen }: { onOpen: (name: string) => void }) {
  const index = useMemo(families, [])
  return (
    <div className="flex min-w-0 flex-col gap-3 text-data">
      <p className="text-muted">
        put the cursor on an instruction, a directive, or a register to read about it here, or
        search above.
      </p>
      <Part label="a bot, in brief">
        <ul className="flex list-disc flex-col gap-1 pl-4 text-text marker:text-dim">
          <li>
            <Word onOpen={onOpen}>%name</Word> names it; it is the one line every bot needs.
          </li>
          <li>
            a label ends in a colon: <code className="text-bright">loop:</code>. jumps and data
            reach it by name.
          </li>
          <li>
            the core does not relocate the bot: read your own data as{' '}
            <code className="text-bright">[bx+label]</code> after the base idiom in the templates.
          </li>
          <li>
            zero bytes are DAT: a process that runs one dies. that is the bomb, and the danger of{' '}
            <Word onOpen={onOpen}>resb</Word>.
          </li>
        </ul>
        <p className="flex flex-wrap gap-x-3 gap-y-1">
          <DocsLink href="/docs/start-here">start here</DocsLink>
          <DocsLink href="/docs/machine/memory">the machine</DocsLink>
          <DocsLink href="/docs/strategy/imps">strategy</DocsLink>
        </p>
      </Part>
      {index.map(([family, names]) => (
        <Part key={family} label={FAMILY_NAMES[family] ?? family}>
          <ul className="flex flex-wrap gap-1">
            {names.map((n) => (
              <li key={n}>
                <Word onOpen={onOpen}>{n}</Word>
              </li>
            ))}
          </ul>
        </Part>
      ))}
    </div>
  )
}

/** A topic's name that opens it. */
function Word({ children, onOpen }: { children: string; onOpen: (name: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(children)}
      className={cx(ROW, 'border border-border px-1.5 text-accent-fg hover:border-border-strong')}
    >
      {children}
    </button>
  )
}
