import { cx, Input, Panel, PanelGrid } from '@asmbots/ui'
import { Link, useRouter } from '@tanstack/react-router'
import { type KeyboardEvent, type ReactNode, useId, useState } from 'react'
import { DOCS, type DocSection, searchDocs } from '../docs'
import { ROUTE_SEARCH } from './keys'

const LINK = cx(
  'block truncate rounded-sm px-2 py-0.5 text-body text-muted transition-colors duration-120 ease-out hover:text-text',
  'focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-accent',
  'data-[status=active]:bg-accent-10 data-[status=active]:text-accent',
)

/**
 * The docs' page (PRODUCT_SPEC §7): the sidebar on the left (the search `/` focuses, and the
 * pages by section), the page on the right.
 */
export function DocsFrame({
  children,
  docs = DOCS,
}: {
  children: ReactNode
  docs?: readonly DocSection[]
}) {
  return (
    <PanelGrid className="items-start p-3">
      <Panel className="col-span-12 md:sticky md:top-3 md:col-span-3" title="docs" dense>
        <DocsSidebar docs={docs} />
      </Panel>
      <div className="col-span-12 min-w-0 md:col-span-9">{children}</div>
    </PanelGrid>
  )
}

/** A docs page's panel: its title, and the text in reading width. */
export function DocsArticle({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Panel title={title}>
      <article className="max-w-[72ch]">{children}</article>
    </Panel>
  )
}

/**
 * The search field and the pages that match it, by section. Enter opens the first match; Escape
 * clears the field and leaves it.
 */
function DocsSidebar({ docs }: { docs: readonly DocSection[] }) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const matches = searchDocs(query, docs)
  const listId = useId()

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && matches[0] !== undefined) {
      event.preventDefault()
      void router.navigate({ to: '/docs/$', params: { _splat: matches[0].page.slug } })
    } else if (event.key === 'Escape') {
      setQuery('')
      event.currentTarget.blur()
    }
  }

  const sections = docs
    .map(({ title }) => ({ title, entries: matches.filter((entry) => entry.section === title) }))
    .filter(({ entries }) => entries.length > 0)

  return (
    <div className="flex flex-col gap-3">
      <Input
        {...{ [ROUTE_SEARCH]: '' }}
        type="search"
        aria-label="search the docs"
        aria-controls={listId}
        placeholder="search docs"
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
        onKeyDown={onKeyDown}
        className="w-full"
      />
      <nav id={listId} aria-label="docs pages" className="flex flex-col gap-3">
        <Link to="/docs" activeOptions={{ exact: true }} className={LINK}>
          contents
        </Link>
        {sections.map(({ title, entries }) => (
          <div key={title} className="flex flex-col gap-0.5">
            <h3 className="px-2 text-panel-status text-muted">{title}</h3>
            {entries.map(({ page }) => (
              <Link key={page.slug} to="/docs/$" params={{ _splat: page.slug }} className={LINK}>
                {page.title}
              </Link>
            ))}
          </div>
        ))}
        {matches.length === 0 && <p className="px-2 text-body text-muted">no page matches.</p>}
      </nav>
    </div>
  )
}
