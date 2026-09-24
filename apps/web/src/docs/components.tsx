import { Button, cx, useToast } from '@asmbots/ui'
import { Link } from '@tanstack/react-router'
import { Copy } from 'lucide-react'
import type { MDXComponents } from 'mdx/types'
import { type ComponentProps, isValidElement, type ReactNode } from 'react'
import { Asm } from './Asm'
import { Fig, Keys, Note, Shot, Warn } from './blocks'
import { KeyMap } from './keymap'
import { Encoding, Flags } from './reference'
import { headingId, textOf } from './text'

/** Keyboard focus on a link: the kit's 1 px accent outline. */
const FOCUS = 'focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent'

// Underlined at rest: in a paragraph a link must not rely on its color alone (WCAG 1.4.1).
const LINK = cx(
  'text-accent underline decoration-accent-45 underline-offset-2 hover:decoration-accent',
  FOCUS,
)

/**
 * A docs link: an app path goes through the router (no reload), its `#anchor` as the router's
 * hash; anything else leaves the app.
 */
function DocLink({ href = '', children }: ComponentProps<'a'>) {
  if (href.startsWith('/')) {
    const at = href.indexOf('#')
    const to = at < 0 ? { to: href } : { to: href.slice(0, at), hash: href.slice(at + 1) }
    return (
      <Link {...to} className={LINK}>
        {children}
      </Link>
    )
  }
  return (
    <a href={href} target="_blank" rel="noreferrer" className={LINK}>
      {children}
    </a>
  )
}

/** The languages a fenced block may name to be x16c: ```` ```asm ````, ```` ```x16c ````. */
const X16C = /\blanguage-(asm|x16c|nasm)\b/

/** The attributes of a fenced block's meta: `run="vs=imp" fragment` (remark-code-meta.ts). */
export function metaAttributes(meta: string): Record<string, string | true> {
  const attributes: Record<string, string | true> = {}
  for (const [, key, value] of meta.matchAll(/([a-z]+)(?:="([^"]*)")?/g)) {
    attributes[key as string] = value ?? true
  }
  return attributes
}

/**
 * A fenced block: x16c goes to `Asm` (colors, `copy`, `open in editor`, and `open in arena` when
 * its meta says `run="vs=…"`); any other language is plain text with `copy`.
 */
function CodeBlock({ children }: ComponentProps<'pre'>) {
  const code = isValidElement<{ className?: string; 'data-meta'?: string; children?: ReactNode }>(
    children,
  )
    ? children.props
    : { children }
  if (X16C.test(code.className ?? '')) {
    const { run, fragment } = metaAttributes(code['data-meta'] ?? '')
    return (
      <Asm run={typeof run === 'string' ? run : undefined} fragment={fragment !== undefined}>
        {code.children}
      </Asm>
    )
  }
  return <PlainBlock text={textOf(code.children).replace(/\n$/, '')} />
}

function PlainBlock({ text }: { text: string }) {
  const { toast } = useToast()
  const copy = () => {
    navigator.clipboard.writeText(text).then(
      () => toast('copied.', { variant: 'accent' }),
      () => toast('could not copy the code.', { variant: 'danger' }),
    )
  }
  return (
    <div className="relative my-3 min-w-0">
      <pre className="overflow-x-auto rounded-sm border border-border bg-panel-2 p-3 pr-20 text-code text-text">
        <code className="whitespace-pre">{text}</code>
      </pre>
      {/* The kit's Button owns its `position`: the corner is a wrapper's. */}
      <span className="absolute top-1 right-1">
        <Button variant="ghost" icon={Copy} onClick={copy}>
          copy
        </Button>
      </span>
    </div>
  )
}

/** A section heading with the id the search index and the page's contents link to. */
function heading(Tag: 'h2' | 'h3', className: string) {
  return function Heading({ children, id, ...props }: ComponentProps<'h2'>) {
    return (
      <Tag {...props} id={id ?? headingId(textOf(children))} className={className}>
        {children}
      </Tag>
    )
  }
}

/**
 * How a docs page draws its Markdown, in the kit's type (DESIGN_SYSTEM §3): body text at 13 px,
 * headings as panel titles, code in `--panel-2`; and the docs' own blocks, which a page uses with
 * no import: `Asm`, `Encoding`, `Flags`, `Keys`, `Note`, `Warn`, `Fig`, `Shot`, `KeyMap`.
 */
export const MDX_COMPONENTS: MDXComponents = {
  h1: (props) => <h1 {...props} className="mb-4 text-modal-title text-bright" />,
  h2: heading(
    'h2',
    'mt-6 mb-2 scroll-mt-3 border-b border-border pb-1 text-panel-title text-accent',
  ),
  h3: heading('h3', 'mt-4 mb-2 scroll-mt-3 text-nav text-text'),
  p: (props) => <p {...props} className="my-3 text-body text-text" />,
  a: DocLink,
  ul: (props) => <ul {...props} className="my-3 list-disc pl-5 text-body marker:text-dim" />,
  ol: (props) => <ol {...props} className="my-3 list-decimal pl-6 text-body marker:text-dim" />,
  li: (props) => <li {...props} className="my-1" />,
  strong: (props) => <strong {...props} className="font-semibold text-bright" />,
  blockquote: (props) => (
    <blockquote {...props} className="my-3 border-l-2 border-accent-45 pl-3 text-muted" />
  ),
  pre: CodeBlock,
  code: (props) => <code {...props} className="rounded-sm bg-panel-2 px-1 text-code text-bright" />,
  hr: (props) => <hr {...props} className="my-6 border-border" />,
  table: (props) => (
    <div className="my-3 overflow-x-auto">
      <table {...props} className="border-collapse text-data" />
    </div>
  ),
  th: (props) => (
    <th {...props} className="border-b border-border-strong px-2 py-1 text-left text-muted" />
  ),
  td: (props) => <td {...props} className="border-b border-border px-2 py-1 align-top" />,
  Asm,
  Encoding,
  Flags,
  Keys,
  Note,
  Warn,
  Fig,
  Shot,
  KeyMap,
}
