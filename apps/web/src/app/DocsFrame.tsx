import { cx, Input, Panel, PanelGrid } from '@asmbots/ui'
import { Link, useRouter, useRouterState } from '@tanstack/react-router'
import { ArrowLeft, ArrowRight, ChevronRight, Menu as MenuIcon, X } from 'lucide-react'
import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  DOCS,
  type DocEntry,
  type DocSection,
  docEntries,
  docNeighbors,
  docPlace,
  findDoc,
} from '../docs'
import {
  excerpt,
  loadSearchIndex,
  type SearchIndex,
  type SearchRecord,
  searchIndex,
} from '../docs/search'
import { sectionAnchor, sectionMeta } from '../docs/sections'
import { ROUTE_SEARCH } from './keys'

const FOCUS = 'focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-accent'

/** A sidebar link, which may wrap: a search hit, an entry of the page's contents. */
const ITEM = cx(
  'block rounded-sm px-2 py-0.5 text-body text-muted transition-colors duration-120 ease-out hover:text-text',
  FOCUS,
  'data-[status=active]:bg-accent-10 data-[status=active]:text-accent-fg',
)

/** A page of the tree: one line, hung from its section's rail. */
const LINK = cx(
  ITEM,
  'truncate border-l border-border pl-3 rounded-l-none',
  'data-[status=active]:border-accent',
)

/**
 * A sticky sidebar's most height: the window less the frame's rows (ticker 24, header 40, status
 * 22 and its 8 below) and the page's 12 px above and below, rounded up. Past it the sidebar scrolls
 * itself, so Tab never lands on a link the window cannot show.
 */
const STICKY_HEIGHT = 'max-h-[calc(100dvh-7.5rem)] overflow-y-auto'
/** The same from `md` up, where the pages' sidebar sticks. */
const STICKY_HEIGHT_MD = 'md:max-h-[calc(100dvh-7.5rem)] md:overflow-y-auto'

const TEXT_LINK = cx(
  'rounded-sm text-accent-fg underline-offset-2 hover:underline',
  'focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent',
)

/** The docs page's slug from the path: `/docs/machine/memory` is `machine/memory`, `/docs` is ''. */
function useDocSlug(): string {
  return useRouterState({
    select: ({ location }) => location.pathname.replace(/^\/docs\/?/, '').replace(/\/$/, ''),
  })
}

/**
 * The docs' page (PRODUCT_SPEC §7): the sidebar on the left (the search `/` focuses, and the
 * sections, the reader's open), the page on the right.
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
      <Panel
        className={cx(
          'col-span-12 md:sticky md:top-3 md:col-span-4 lg:col-span-3',
          STICKY_HEIGHT_MD,
        )}
        title="docs"
        status={`${docEntries(docs).length} pages`}
        data-tour="docs-nav"
        dense
      >
        <DocsSidebar docs={docs} loadIndex={loadIndex} />
      </Panel>
      <div className="col-span-12 min-w-0 md:col-span-8 lg:col-span-9">{children}</div>
    </PanelGrid>
  )
}

/**
 * A docs page's panel, named by its title: over the text, where the page sits (its trail and its
 * place in its section); the text, which fills the panel so code and tables have room; under it,
 * the pages before and after. Its contents stand beside it on a wide screen.
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
      <Panel aria-label={title} className="min-w-0 flex-1">
        {slug !== undefined && <DocsTrail slug={slug} docs={docs} />}
        <article ref={article}>{children}</article>
        {slug !== undefined && <PrevNext slug={slug} docs={docs} />}
      </Panel>
      {slug !== undefined && <OnThisPage slug={slug} article={article} />}
    </div>
  )
}

/**
 * Over a page: `docs / the machine / memory`, and on the right its place in the section, `3 / 8`,
 * with a tick for each page (the lit ones read so far, in order).
 */
function DocsTrail({ slug, docs }: { slug: string; docs: readonly DocSection[] }) {
  const place = docPlace(slug, docs)
  if (place === undefined) return null
  const { section, page, at, of } = place
  const Icon = sectionMeta(section.title).icon
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border pb-2">
      <nav aria-label="breadcrumb" className="min-w-0">
        <ol className="flex flex-wrap items-center gap-1.5 text-panel-status text-muted">
          <li>
            <Link to="/docs" className={TEXT_LINK}>
              docs
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="flex items-center gap-1">
            <Icon aria-hidden="true" className="size-3 shrink-0" />
            <Link to="/docs" hash={sectionAnchor(section.title)} className={TEXT_LINK}>
              {section.title}
            </Link>
          </li>
          {page.title !== section.title && (
            <>
              <li aria-hidden="true">/</li>
              <li aria-current="page" className="text-text">
                {page.title}
              </li>
            </>
          )}
        </ol>
      </nav>
      {of > 1 && (
        <p className="flex items-center gap-2 text-panel-status text-muted">
          <span>
            {at + 1} / {of}
            <span className="sr-only"> in {section.title}</span>
          </span>
          <span aria-hidden="true" className="flex gap-0.5">
            {section.pages.map((p, i) => (
              <span
                key={p.slug}
                className={cx(
                  'h-1.5 w-2.5 rounded-[1px]',
                  i === at ? 'bg-accent' : i < at ? 'bg-accent-45' : 'bg-border-strong',
                )}
              />
            ))}
          </span>
        </p>
      )}
    </div>
  )
}

interface TocEntry {
  id: string
  text: string
  level: 2 | 3
}

/** How far under the scroller's top a heading counts as the one being read. */
const READING_LINE = 96

/**
 * The page's contents: its `##` and `###` headings, read from the drawn page (each has the id
 * `text.ts` gives it), with the one being read lit as the page scrolls. Wide screens only; a page
 * with fewer than two headings has none.
 */
function OnThisPage({ slug, article }: { slug: string; article: RefObject<HTMLElement | null> }) {
  const [entries, setEntries] = useState<TocEntry[]>([])
  const [current, setCurrent] = useState<string | undefined>(undefined)
  useEffect(() => {
    const headings = [...(article.current?.querySelectorAll<HTMLElement>('h2[id], h3[id]') ?? [])]
    setEntries(
      headings.map((h) => ({
        id: h.id,
        text: h.textContent ?? '',
        level: h.tagName === 'H3' ? 3 : 2,
      })),
    )
    setCurrent(headings[0]?.id)
    if (headings.length < 2) return
    // The page scrolls in the frame's `main`, not the window; a capturing listener hears either.
    let frame = 0
    const read = () => {
      frame = 0
      const top = article.current?.closest('main')?.getBoundingClientRect().top ?? 0
      let reading = headings[0]?.id
      for (const h of headings) {
        if (h.getBoundingClientRect().top - top > READING_LINE) break
        reading = h.id
      }
      setCurrent(reading)
    }
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(read)
    }
    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true })
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [slug, article])
  if (entries.length < 2) return null
  return (
    <div className={cx('sticky top-3 hidden w-56 shrink-0 xl:block', STICKY_HEIGHT)}>
      <Panel title="on this page" dense>
        <nav aria-label="page contents" className="flex flex-col">
          {entries.map(({ id, text, level }) => (
            <a
              key={id}
              href={`#${id}`}
              aria-current={id === current ? 'location' : undefined}
              className={cx(
                ITEM,
                'rounded-l-none border-l border-border',
                level === 3 ? 'pl-5 text-data' : 'pl-3',
                'aria-[current=location]:border-accent aria-[current=location]:text-accent-fg',
              )}
            >
              {text}
            </a>
          ))}
        </nav>
      </Panel>
    </div>
  )
}

/** A card of the pages before and after this one: which way, the section, and the page's name. */
const NEIGHBOR = cx(
  'flex min-w-0 flex-col gap-0.5 rounded-md border border-border bg-panel-2 px-3 py-2',
  'transition-colors duration-120 ease-out hover:border-accent-45',
  'focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent',
)

function Neighbor({ entry, rel }: { entry: DocEntry; rel: 'prev' | 'next' }) {
  const { page, section } = entry
  const next = rel === 'next'
  return (
    <Link
      to="/docs/$"
      params={{ _splat: page.slug }}
      rel={rel}
      aria-label={`${next ? 'next' : 'previous'}: ${page.title}`}
      className={cx(NEIGHBOR, next && 'items-end text-right sm:col-start-2')}
    >
      <span className="flex items-center gap-1 text-panel-status text-muted">
        {!next && <ArrowLeft aria-hidden="true" className="size-3" />}
        {next ? 'next' : 'previous'} · {section}
        {next && <ArrowRight aria-hidden="true" className="size-3" />}
      </span>
      <span className="max-w-full truncate text-body text-accent-fg">{page.title}</span>
    </Link>
  )
}

/** The pages before and after this one in reading order. */
function PrevNext({ slug, docs }: { slug: string; docs: readonly DocSection[] }) {
  const { prev, next } = docNeighbors(slug, docs)
  if (prev === undefined && next === undefined) return null
  return (
    <nav
      aria-label="previous and next pages"
      className="mt-8 grid gap-3 border-t border-border pt-4 sm:grid-cols-2"
    >
      {prev !== undefined && <Neighbor entry={prev} rel="prev" />}
      {next !== undefined && <Neighbor entry={next} rel="next" />}
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
 * best match at its heading, and clears and leaves the field, as Escape does. An Enter typed
 * before the index has loaded waits for it, so a fast typist still lands on the page.
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
  // Enter pressed while the index loads: open the best match once it is here.
  const [enterPending, setEnterPending] = useState(false)
  const field = useRef<HTMLInputElement>(null)
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

  // Found: the search is done, and the tree comes back with the page lit.
  const open = useCallback(
    (hit: SearchRecord) => {
      setQuery('')
      field.current?.blur()
      void router.navigate({ to: '/docs/$', params: { _splat: hit.slug }, hash: hit.anchor })
    },
    [router],
  )

  useEffect(() => {
    if (!enterPending || state.status === 'loading' || state.status === 'idle') return
    setEnterPending(false)
    const first = hits[0]
    if (first !== undefined) open(first)
  }, [enterPending, state, hits, open])

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const first = hits[0]
    if (event.key === 'Enter' && first !== undefined) {
      event.preventDefault()
      open(first)
    } else if (event.key === 'Enter' && searching && state.status === 'loading') {
      event.preventDefault()
      setEnterPending(true)
    } else if (event.key === 'Escape') {
      setEnterPending(false)
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
        ref={field}
        onChange={(event) => {
          load()
          setEnterPending(false)
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

/**
 * The pages by section. The section of the page on screen is open, and the reader opens and
 * closes the others; each shows its icon and how many pages it has. On a phone the tree folds
 * behind one `browse` button, so the page is not under 48 links, and it folds again on each page.
 */
function DocsTree({ id, docs }: { id: string; docs: readonly DocSection[] }) {
  const slug = useDocSlug()
  const active = docPlace(slug, docs)?.section.title
  // The reader's choice for a section; a section without one is open when it holds the page.
  const [chosen, setChosen] = useState<Record<string, boolean>>({})
  const [browsing, setBrowsing] = useState(false)
  // A new page: its section opens, whatever was chosen for it, and the phone's tree folds.
  useEffect(() => {
    setBrowsing(false)
    if (active === undefined) return
    setChosen((c) => {
      if (!(active in c)) return c
      const rest = { ...c }
      delete rest[active]
      return rest
    })
  }, [slug, active])
  const sections = docs.filter(({ pages }) => pages.length > 0)
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={browsing}
        aria-controls={id}
        onClick={() => setBrowsing((open) => !open)}
        className={cx(
          'flex items-center gap-2 rounded-sm border border-border px-2 py-1 text-nav text-muted hover:text-text md:hidden',
          FOCUS,
        )}
      >
        {browsing ? (
          <X aria-hidden="true" className="size-3.5" />
        ) : (
          <MenuIcon aria-hidden="true" className="size-3.5" />
        )}
        browse {sections.length} sections
      </button>
      <nav
        id={id}
        aria-label="docs pages"
        className={cx('flex-col gap-1', browsing ? 'flex' : 'hidden md:flex')}
      >
        <Link to="/docs" activeOptions={{ exact: true }} className={cx(ITEM, 'mb-1')}>
          overview
        </Link>
        {sections.map((section) => {
          const open = chosen[section.title] ?? section.title === active
          return (
            <TreeSection
              key={section.title}
              section={section}
              open={open}
              current={section.title === active}
              onToggle={() => setChosen((c) => ({ ...c, [section.title]: !open }))}
            />
          )
        })}
      </nav>
    </div>
  )
}

function TreeSection({
  section,
  open,
  current,
  onToggle,
}: {
  section: DocSection
  open: boolean
  /** The page on screen is in this section. */
  current: boolean
  onToggle: () => void
}) {
  const pagesId = useId()
  const Icon = sectionMeta(section.title).icon
  return (
    <div className="flex flex-col">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={pagesId}
          onClick={onToggle}
          className={cx(
            'flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-panel-status transition-colors duration-120 ease-out hover:bg-panel-2 hover:text-text',
            current ? 'text-accent-fg' : 'text-muted',
            FOCUS,
          )}
        >
          <Icon aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{section.title}</span>
          <span aria-hidden="true" className="tabular-nums">
            {section.pages.length}
          </span>
          <ChevronRight
            aria-hidden="true"
            className={cx(
              'size-3 shrink-0 transition-transform duration-120 ease-out',
              open && 'rotate-90',
            )}
          />
        </button>
      </h3>
      {/* Closed, the list stays in the page, hidden, so the button always has what it controls. */}
      <div
        id={pagesId}
        hidden={!open}
        className="mb-1 ml-3.5 flex-col py-0.5 [&:not([hidden])]:flex"
      >
        {section.pages.map((page) => (
          <Link key={page.slug} to="/docs/$" params={{ _splat: page.slug }} className={LINK}>
            {page.title}
          </Link>
        ))}
      </div>
    </div>
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
              <span className="block text-data text-muted">{excerpt(hit.text, query)}</span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
