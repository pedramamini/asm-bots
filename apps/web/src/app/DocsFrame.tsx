import { cx, Input, Panel, PanelGrid } from '@asmbots/ui'
import { Link, useRouter } from '@tanstack/react-router'
import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { DOCS, type DocSection, docEntries, docNeighbors, findDoc } from '../docs'
import {
  excerpt,
  loadSearchIndex,
  type SearchIndex,
  type SearchRecord,
  searchIndex,
} from '../docs/search'
import { ROUTE_SEARCH } from './keys'

/** A sidebar link, which may wrap: a search hit, an entry of the page's contents. */
const ITEM = cx(
  'block rounded-sm px-2 py-0.5 text-body text-muted transition-colors duration-120 ease-out hover:text-text',
  'focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-accent',
  'data-[status=active]:bg-accent-10 data-[status=active]:text-accent',
)

/** A page of the tree: one line. */
const LINK = cx(ITEM, 'truncate')

const TEXT_LINK = cx(
  'text-accent underline-offset-2 hover:underline',
  'focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent',
)

/**
 * The docs' page (PRODUCT_SPEC §7): the sidebar on the left (the search `/` focuses, and the
 * pages by section), the page on the right.
 */
export function DocsFrame({
  children,
  docs = DOCS,
  loadIndex = loadSearchIndex,
}: {
  children: ReactNode
  docs?: readonly DocSection[]
  /** The search index; the built one by default (tests hand their own). */
  loadIndex?: () => Promise<SearchIndex>
}) {
  return (
    <PanelGrid className="items-start p-3">
      <Panel className="col-span-12 md:sticky md:top-3 md:col-span-3" title="docs" dense>
        <DocsSidebar docs={docs} loadIndex={loadIndex} />
      </Panel>
      <div className="col-span-12 min-w-0 md:col-span-9">{children}</div>
    </PanelGrid>
  )
}

/**
 * A docs page's panel: its title and the text in reading width (72ch). A page of the tree (`slug`)
 * also gets its contents beside it, and its previous and next pages under it.
 */
export function DocsArticle({
  title,
  slug,
  docs = DOCS,
  children,
}: {
  title: string
  slug?: string | undefined
  docs?: readonly DocSection[]
  children: ReactNode
}) {
  const article = useRef<HTMLElement>(null)
  return (
    <div className="flex items-start gap-3">
      <Panel title={title} className="min-w-0 flex-1">
        <article ref={article} className="max-w-[72ch]">
          {children}
        </article>
        {slug !== undefined && <PrevNext slug={slug} docs={docs} />}
      </Panel>
      {slug !== undefined && <OnThisPage slug={slug} article={article} />}
    </div>
  )
}

interface TocEntry {
  id: string
  text: string
  level: 2 | 3
}

/**
 * The page's contents: its `##` and `###` headings, read from the drawn page (each has the id
 * `text.ts` gives it). Wide screens only; a page with fewer than two headings has none.
 */
function OnThisPage({ slug, article }: { slug: string; article: RefObject<HTMLElement | null> }) {
  const [entries, setEntries] = useState<TocEntry[]>([])
  useEffect(() => {
    const headings = article.current?.querySelectorAll<HTMLElement>('h2[id], h3[id]') ?? []
    setEntries(
      [...headings].map((h) => ({
        id: h.id,
        text: h.textContent ?? '',
        level: h.tagName === 'H3' ? 3 : 2,
      })),
    )
  }, [slug, article])
  if (entries.length < 2) return null
  return (
    <div className="sticky top-3 hidden w-56 shrink-0 xl:block">
      <Panel title="on this page" dense>
        <nav aria-label="page contents" className="flex flex-col gap-0.5">
          {entries.map(({ id, text, level }) => (
            <a key={id} href={`#${id}`} className={cx(ITEM, level === 3 && 'ml-3 text-data')}>
              {text}
            </a>
          ))}
        </nav>
      </Panel>
    </div>
  )
}

/** The pages before and after this one in reading order. */
function PrevNext({ slug, docs }: { slug: string; docs: readonly DocSection[] }) {
  const { prev, next } = docNeighbors(slug, docs)
  if (prev === undefined && next === undefined) return null
  return (
    <nav
      aria-label="previous and next pages"
      className="mt-6 flex max-w-[72ch] justify-between gap-3 border-t border-border pt-3 text-body"
    >
      {prev === undefined ? (
        <span />
      ) : (
        <Link to="/docs/$" params={{ _splat: prev.page.slug }} rel="prev" className={TEXT_LINK}>
          ← {prev.page.title}
        </Link>
      )}
      {next !== undefined && (
        <Link to="/docs/$" params={{ _splat: next.page.slug }} rel="next" className={TEXT_LINK}>
          {next.page.title} →
        </Link>
      )}
    </nav>
  )
}

/** The index while it loads, once loaded, or when it could not load. */
type IndexState =
  | { status: 'idle' | 'loading' | 'failed' }
  | { status: 'ready'; index: SearchIndex }

/**
 * The search field, and under it the pages by section, or, while the field holds a query, the
 * sections of the pages that match it (the built index, loaded on first use). Enter opens the
 * best match at its heading, and clears and leaves the field, as Escape does.
 */
function DocsSidebar({
  docs,
  loadIndex,
}: {
  docs: readonly DocSection[]
  loadIndex: () => Promise<SearchIndex>
}) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [state, setState] = useState<IndexState>({ status: 'idle' })
  const listId = useId()

  const load = () => {
    if (state.status !== 'idle') return
    setState({ status: 'loading' })
    loadIndex().then(
      (index) => setState({ status: 'ready', index }),
      () => setState({ status: 'failed' }),
    )
  }

  const searching = query.trim() !== ''
  const hits = useMemo(() => {
    if (state.status !== 'ready' || !searching) return []
    // A hit on a page the tree no longer has is dropped: the index is older than the tree.
    return searchIndex(state.index, query).filter(({ slug }) => findDoc(slug, docs) !== undefined)
  }, [state, query, searching, docs])

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const first = hits[0]
    if (event.key === 'Enter' && first !== undefined) {
      // Found: the search is done, and the tree comes back with the page lit.
      event.preventDefault()
      setQuery('')
      event.currentTarget.blur()
      void router.navigate({
        to: '/docs/$',
        params: { _splat: first.slug },
        hash: first.anchor,
      })
    } else if (event.key === 'Escape') {
      setQuery('')
      event.currentTarget.blur()
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Input
        {...{ [ROUTE_SEARCH]: '' }}
        type="search"
        aria-label="search the docs"
        aria-controls={listId}
        placeholder="search docs"
        value={query}
        onFocus={load}
        onChange={(event) => {
          load()
          setQuery(event.currentTarget.value)
        }}
        onKeyDown={onKeyDown}
        className="w-full"
      />
      {searching ? (
        <SearchResults id={listId} state={state} hits={hits} query={query} docs={docs} />
      ) : (
        <DocsTree id={listId} docs={docs} />
      )}
    </div>
  )
}

function DocsTree({ id, docs }: { id: string; docs: readonly DocSection[] }) {
  return (
    <nav id={id} aria-label="docs pages" className="flex flex-col gap-3">
      <Link to="/docs" activeOptions={{ exact: true }} className={LINK}>
        contents
      </Link>
      {docs
        .filter(({ pages }) => pages.length > 0)
        .map(({ title, pages }) => (
          <div key={title} className="flex flex-col gap-0.5">
            <h3 className="px-2 text-panel-status text-muted">{title}</h3>
            {pages.map((page) => (
              <Link key={page.slug} to="/docs/$" params={{ _splat: page.slug }} className={LINK}>
                {page.title}
              </Link>
            ))}
          </div>
        ))}
    </nav>
  )
}

function SearchResults({
  id,
  state,
  hits,
  query,
  docs,
}: {
  id: string
  state: IndexState
  hits: readonly SearchRecord[]
  query: string
  docs: readonly DocSection[]
}) {
  const titles = useMemo(
    () => new Map(docEntries(docs).map(({ page }) => [page.slug, page.title])),
    [docs],
  )
  const message =
    state.status === 'failed'
      ? 'could not load the index. reload the page.'
      : state.status !== 'ready'
        ? 'loading the index…'
        : hits.length === 0
          ? 'no section matches.'
          : null
  return (
    <nav id={id} aria-label="search results" className="flex flex-col gap-1">
      {message !== null && (
        <p role="status" className="px-2 text-body text-muted">
          {message}
        </p>
      )}
      {hits.map((hit) => {
        const page = titles.get(hit.slug) ?? hit.slug
        return (
          <Link
            key={`${hit.slug}#${hit.anchor}`}
            to="/docs/$"
            params={{ _splat: hit.slug }}
            hash={hit.anchor}
            className={ITEM}
          >
            <span className="block truncate text-text">
              {hit.anchor === '' ? page : `${page} › ${hit.heading}`}
            </span>
            {hit.text !== '' && (
              <span className="block text-data text-dim">{excerpt(hit.text, query)}</span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
