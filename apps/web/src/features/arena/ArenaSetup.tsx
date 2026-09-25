import type { Diag } from '@asmbots/asm'
import {
  Button,
  Chip,
  EmptyState,
  type EmptyStateAction,
  HueSwatch,
  IconButton,
  Identicon,
  Input,
  Modal,
  Panel,
  PanelGrid,
  Segmented,
  useToast,
} from '@asmbots/ui'
import { FileUp, Link, Plus, Save, Swords, X } from 'lucide-react'
import {
  type ChangeEvent,
  type DragEvent,
  lazy,
  type ReactNode,
  Suspense,
  useDeferredValue,
  useMemo,
  useRef,
  useState,
} from 'react'
import { ARENA_ABOUT } from '../../app/intros/arena'
import { ROUTE_SEARCH } from '../../app/keys'
import { useLinkAction } from '../../app/link-action'
import { PageIntro } from '../../app/PageIntro'
import { useRouteStat } from '../../app/slots'
import { type LocalBot, useLocalBotActions, useLocalBots } from '../../store/local-bots'
import { useSettings } from '../../store/settings'
import { loadAssembly, useAssemble } from './setup/assembler'
import type { BotFile } from './setup/assembly'
import {
  type ArenaFight,
  type Assemble,
  arenaFight,
  type CatalogBot,
  carriesFiles,
  errorsOf,
  fightSeed,
  fightStatus,
  localCatalog,
  matchesQuery,
  resolveSelection,
  rosterCatalog,
  type SetupBot,
  sharedSources,
  sizesOf,
} from './setup/bots'
import { ConfigForm } from './setup/ConfigForm'
import {
  MAX_ARENA_BOTS,
  MIN_ARENA_BOTS,
  type PresetName,
  randomSeed,
  withConfig,
  withPreset,
} from './setup/config'
import { Diagnostics } from './setup/Diagnostics'
import { type ArenaSetupSpec, type BotRef, formatRef } from './setup/url'
import { copyShareLink } from './share'
import { FightStep, RosterStep } from './tour'

/**
 * The intro's banner, loaded after the page: the setup sits at the edge of its budget. Its box is
 * held by a placeholder of `IntroArt`'s size, so the intro's text does not reflow.
 */
const IntroArt = lazy(() => import('../../app/IntroArt').then((m) => ({ default: m.IntroArt })))

/** Where the picker's bots come from. */
type Source = 'roster' | 'mine' | 'paste'

const SOURCES = [
  { value: 'roster', label: 'roster' },
  { value: 'mine', label: 'my bots' },
  { value: 'paste', label: 'paste' },
] as const satisfies readonly { value: Source; label: string }[]

/** The pair a first visit can fight at once: a bomber and a replicator. */
const STARTERS: readonly BotRef[] = [
  { kind: 'roster', slug: 'dwarf' },
  { kind: 'roster', slug: 'paper' },
]

/** A file or a bot that did not assemble, as the problem modal lists it. */
interface Problem {
  readonly name: string
  readonly source: string
  /** Why it was not read at all, instead of diagnostics. */
  readonly reason: string | null
  readonly diagnostics: readonly Diag[]
}

export interface ArenaSetupProps {
  /** The bots and the config: the URL's. */
  spec: ArenaSetupSpec
  /** Changes the setup; the update gets the latest spec. */
  onSpecChange: (update: (spec: ArenaSetupSpec) => ArenaSetupSpec) => void
  /** The sources a share link carries, by id. */
  shared: ReadonlyMap<string, string>
  /** The fight button: the bots, placed and ready, and the config. */
  onFight: (fight: ArenaFight) => void
  /** The first-visit tour, while it is on: its button puts it away (`tour.tsx`). */
  tour?: { readonly onDismiss: () => void } | undefined
}

/**
 * The arena before a battle (PRODUCT_SPEC §2). On the left, the picker: the roster, the local
 * bots, or a paste box, with a search. Dropped `.asm` files (anywhere on the setup, or through
 * `open files`) are assembled and saved as local bots; one that does not assemble opens its
 * diagnostics in a modal. On the right: the bots picked, in hue order, the config, and the fight
 * button, which says what is missing until the setup can fight.
 */
export function ArenaSetup({ spec, onSpecChange, shared, onFight, tour }: ArenaSetupProps) {
  const { toast } = useToast()
  const link = useLinkAction()
  const setLastArenaConfig = useSettings((state) => state.setLastArenaConfig)
  const localBots = useLocalBots()
  const { save } = useLocalBotActions()
  const [source, setSource] = useState<Source>('roster')
  const [query, setQuery] = useState('')
  const [problems, setProblems] = useState<{ title: string; list: Problem[] } | null>(null)
  const [dragDepth, setDragDepth] = useState(0)
  const picker = useRef<HTMLInputElement>(null)
  // The setup as it stands, for the steps that finish after an await.
  const latest = useRef(spec)
  latest.current = spec

  const local = useMemo(() => {
    // A store that cannot be read (storage off) holds nothing, rather than loading forever.
    if (localBots.isError) return new Map<string, LocalBot>()
    return localBots.data === undefined ? null : new Map(localBots.data.map((b) => [b.id, b]))
  }, [localBots.data, localBots.isError])
  // The roster comes prebuilt: the assembler loads for my bots, the paste box, and a local or
  // shared bot picked.
  const assemble = useAssemble(source !== 'roster' || spec.bots.some((ref) => ref.kind === 'local'))
  const selection = useMemo(
    () => resolveSelection(spec.bots, { local, shared, assemble }),
    [spec.bots, local, shared, assemble],
  )
  const status = fightStatus(selection, spec)
  const full = spec.bots.length >= MAX_ARENA_BOTS
  // The tour's step: the roster until two bots are in, then the fight button.
  const tourStep =
    tour === undefined ? null : selection.length >= MIN_ARENA_BOTS ? 'fight' : 'roster'
  const clearSearch = { label: 'clear the search', onClick: () => setQuery('') }

  useRouteStat(
    `${selection.length} ${selection.length === 1 ? 'bot' : 'bots'} · ${
      spec.config.preset ?? 'custom'
    } · seed ${spec.config.seed ?? 'random'}`,
  )

  /** Appends `refs` as far as there is room. Returns how many did not fit. */
  const add = (refs: readonly BotRef[]): number => {
    const room = Math.max(0, MAX_ARENA_BOTS - latest.current.bots.length)
    if (room > 0 && refs.length > 0) {
      onSpecChange((s) => ({ ...s, bots: [...s.bots, ...refs.slice(0, room)] }))
    }
    return Math.max(0, refs.length - room)
  }

  const remove = (index: number) =>
    onSpecChange((s) => ({ ...s, bots: s.bots.filter((_, i) => i !== index) }))

  /** Saves each new source as a local bot, the same source once. Returns the refs, in order. */
  const saveSources = async (list: readonly { name: string; source: string }[]) => {
    const known = new Map((localBots.data ?? []).map((b) => [b.source, b.id]))
    const refs: BotRef[] = []
    for (const { name, source } of list) {
      let id = known.get(source)
      if (id === undefined) {
        id = (await save.mutateAsync({ name, source })).id
        known.set(source, id)
      }
      refs.push({ kind: 'local', id })
    }
    return refs
  }

  const addFiles = async (files: readonly File[]) => {
    if (files.length === 0) return
    let assembly: Awaited<ReturnType<typeof loadAssembly>>
    try {
      assembly = await loadAssembly()
    } catch {
      toast('could not load the assembler: check the network and drop them again.', {
        variant: 'danger',
      })
      return
    }
    const { fileAssembles, readBotFiles } = assembly
    const read = await readBotFiles(files)
    const good = read.filter(fileAssembles)
    const bad = read.filter((file) => !fileAssembles(file))
    try {
      const refs = await saveSources(
        good.map((file) => ({
          name: file.assembled.name || file.file.replace(/\.asm$/i, ''),
          source: file.source,
        })),
      )
      const left = add(refs)
      const added = refs.length - left
      if (left > 0) {
        toast(`${MAX_ARENA_BOTS} bots at most: ${left} saved to my bots, not added.`, {
          variant: 'warn',
        })
      } else if (added > 0) {
        const name = added === 1 ? good[0]?.assembled.name : undefined
        toast(`added ${name ?? `${added} bots`}.`, { variant: 'accent' })
      }
    } catch {
      toast('could not save the bots in this browser.', { variant: 'danger' })
    }
    if (bad.length > 0) {
      setProblems({
        title: `${bad.length === 1 ? (bad[0]?.file ?? 'a file') : `${bad.length} files`} did not assemble`,
        list: bad.map(fileProblem),
      })
    }
  }

  const showErrors = (bot: CatalogBot) =>
    setProblems({
      title: `${bot.name} does not assemble`,
      list: [
        { name: bot.name, source: bot.source ?? '', reason: null, diagnostics: errorsOf(bot) },
      ],
    })

  const fight = () => {
    const { minSpacing, seed: fixed, rounds } = spec.config
    const seed = fightSeed(sizesOf(selection), minSpacing, fixed, randomSeed, rounds)
    if (seed === null) {
      toast('the bots do not fit in the core: lower the spacing.', { variant: 'danger' })
      return
    }
    setLastArenaConfig(spec.config)
    onFight(arenaFight(selection, spec, seed))
  }

  const share = () => copyShareLink(spec, sharedSources(selection), toast)

  const saveShared = async (index: number) => {
    const bot = selection[index]?.bot
    if (bot?.origin !== 'shared' || bot.ref.kind !== 'local' || bot.source === null) return
    await save.mutateAsync({ id: bot.ref.id, name: bot.name, source: bot.source })
    toast(`saved ${bot.name} to my bots.`, { variant: 'accent' })
  }

  // Files dragged over the setup: the overlay says where they go. A counter, since each child the
  // drag crosses sends its own enter and leave.
  const dragging = dragDepth > 0
  const onDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!carriesFiles(event)) return
    event.preventDefault()
    setDragDepth((depth) => depth + 1)
  }
  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!carriesFiles(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }
  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (carriesFiles(event)) setDragDepth((depth) => Math.max(0, depth - 1))
  }
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!carriesFiles(event)) return
    event.preventDefault()
    setDragDepth(0)
    void addFiles(Array.from(event.dataTransfer.files))
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a drop target; `open files` is the keyboard's way in.
    <div
      className="relative p-3"
      data-dragging={dragging || undefined}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <PanelGrid>
        <PageIntro
          about={ARENA_ABOUT}
          art={
            <Suspense
              fallback={<div className="-my-2 hidden w-80 shrink-0 self-stretch md:block" />}
            >
              <IntroArt name="arena" />
            </Suspense>
          }
        />
        <Panel
          className="col-span-12 lg:col-span-8"
          title={SOURCES.find((s) => s.value === source)?.label}
          status={source === 'roster' ? `${rosterCatalog().length} bots` : undefined}
          actions={
            <>
              {source !== 'paste' && (
                <Input
                  {...{ [ROUTE_SEARCH]: '' }}
                  aria-label="search bots"
                  placeholder="search bots"
                  className="w-44"
                  value={query}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    setQuery(event.currentTarget.value)
                  }
                />
              )}
              <Segmented<Source>
                label="bot source"
                options={SOURCES}
                value={source}
                onValueChange={setSource}
              />
            </>
          }
        >
          <div className="flex flex-col gap-3">
            {source === 'roster' && (
              <BotGrid
                bots={rosterCatalog().filter((bot) => matchesQuery(bot, query))}
                picked={spec.bots}
                full={full}
                onAdd={(bot) => add([bot.ref])}
                onErrors={showErrors}
                empty={
                  <EmptyState action={clearSearch}>no roster bot matches "{query}".</EmptyState>
                }
                coach={
                  tour !== undefined &&
                  tourStep === 'roster' && <RosterStep onDismiss={tour.onDismiss} />
                }
              />
            )}
            {source === 'mine' && (
              <MineGrid
                bots={localBots.data}
                assemble={assemble}
                query={query}
                picked={spec.bots}
                full={full}
                onAdd={(bot) => add([bot.ref])}
                onErrors={showErrors}
                write={link('write a bot', '/editor')}
                clearSearch={clearSearch}
              />
            )}
            {source === 'paste' && (
              <PasteBox
                full={full}
                assemble={assemble}
                onAdd={async (assembledName, text) => {
                  const refs = await saveSources([{ name: assembledName, source: text }])
                  add(refs)
                  toast(`added ${assembledName}.`, { variant: 'accent' })
                }}
              />
            )}
            <div className="flex items-center justify-between gap-3 rounded-sm border border-dashed border-border px-3 py-2 text-data text-muted">
              <span>drop .asm files anywhere here: each is assembled and saved to my bots.</span>
              <Button icon={FileUp} size="sm" onClick={() => picker.current?.click()}>
                open files
              </Button>
              <input
                ref={picker}
                type="file"
                accept=".asm"
                multiple
                aria-label="open .asm files"
                className="hidden"
                onChange={(event) => {
                  void addFiles(Array.from(event.currentTarget.files ?? []))
                  event.currentTarget.value = ''
                }}
              />
            </div>
          </div>
        </Panel>
        <div className="col-span-12 flex min-w-0 flex-col gap-3 lg:col-span-4">
          <Panel title="bots" status={`${selection.length} / ${MAX_ARENA_BOTS}`}>
            <Selection
              selection={selection}
              onRemove={remove}
              onSave={(index) => void saveShared(index)}
              onErrors={showErrors}
              onStart={() => add(STARTERS)}
            />
          </Panel>
          <Panel title="config" status={spec.config.preset ?? 'custom'}>
            <ConfigForm
              config={spec.config}
              onChange={(change) =>
                onSpecChange((s) => ({ ...s, config: withConfig(s.config, change) }))
              }
              onPreset={(preset: PresetName) =>
                onSpecChange((s) => ({ ...s, config: withPreset(s.config, preset) }))
              }
            />
          </Panel>
          <div className="relative flex items-center gap-2">
            {tour !== undefined && tourStep === 'fight' && <FightStep onDismiss={tour.onDismiss} />}
            <Button
              name="fight"
              variant="primary"
              icon={Swords}
              className="flex-1"
              disabled={!status.ready}
              loading={status.busy}
              onClick={fight}
            >
              {status.label}
            </Button>
            <IconButton
              icon={Link}
              label="copy a share link"
              tooltip="top"
              disabled={selection.length === 0}
              onClick={() => void share()}
            />
          </div>
        </div>
      </PanelGrid>
      {dragging && (
        <div className="pointer-events-none absolute inset-3 z-10 grid place-items-center rounded-md border border-dashed border-accent bg-accent-10">
          <p className="text-nav text-accent-fg">drop .asm files to add them</p>
        </div>
      )}
      <Modal
        open={problems !== null}
        onClose={() => setProblems(null)}
        title={problems?.title ?? ''}
        size="lg"
      >
        <ul className="flex flex-col gap-4">
          {problems?.list.map((problem) => (
            <li key={problem.name} className="flex min-w-0 flex-col gap-2">
              <p className="text-bright">{problem.name}</p>
              {problem.reason === null ? (
                <Diagnostics source={problem.source} diagnostics={problem.diagnostics} />
              ) : (
                <p className="text-data text-danger">{problem.reason}</p>
              )}
            </li>
          ))}
        </ul>
      </Modal>
    </div>
  )
}

function fileProblem(file: BotFile): Problem {
  const diagnostics = file.assembled?.diagnostics.filter((d) => d.severity === 'error') ?? []
  return { name: file.file, source: file.source, reason: file.problem, diagnostics }
}

/** How many times each bot is picked, by ref. */
function pickCounts(picked: readonly BotRef[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const ref of picked) counts.set(formatRef(ref), (counts.get(formatRef(ref)) ?? 0) + 1)
  return counts
}

interface GridProps {
  picked: readonly BotRef[]
  /** The selection is at its cap: no `+`. */
  full: boolean
  onAdd: (bot: CatalogBot) => void
  onErrors: (bot: CatalogBot) => void
}

/** Bot cards, three across on a wide screen. */
function BotGrid({
  bots,
  picked,
  full,
  onAdd,
  onErrors,
  empty,
  coach,
}: GridProps & {
  bots: readonly CatalogBot[]
  /** What shows when no bot matches: an EmptyState. */
  empty: ReactNode
  /** A coach mark to pin to the first card's `+`: the tour's first step. */
  coach?: ReactNode
}) {
  const counts = pickCounts(picked)
  if (bots.length === 0) return empty
  return (
    <ul aria-label="bots to add" className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {bots.map((bot, index) => (
        <BotCard
          key={formatRef(bot.ref)}
          bot={bot}
          count={counts.get(formatRef(bot.ref)) ?? 0}
          full={full}
          onAdd={() => onAdd(bot)}
          onErrors={() => onErrors(bot)}
          coach={index === 0 ? coach : undefined}
        />
      ))}
    </ul>
  )
}

/**
 * A bot in the picker: its identicon, name, author, size, and tier (a roster bot) or `local`, and
 * `+`. A bot already picked shows how often; a bot that does not assemble shows `errors`.
 */
function BotCard({
  bot,
  count,
  full,
  onAdd,
  onErrors,
  coach,
}: {
  bot: CatalogBot
  count: number
  full: boolean
  onAdd: () => void
  onErrors: () => void
  coach?: ReactNode
}) {
  const { bytes } = bot.assembled
  const broken = errorsOf(bot).length > 0
  const blurb = bot.roster?.blurb ?? bot.assembled.strategy
  return (
    <li
      aria-label={bot.name}
      className="flex min-w-0 items-start gap-3 rounded-md border border-border bg-panel-2 p-2 transition-colors duration-120 ease-out hover:border-border-strong"
    >
      <Identicon value={bytes.length > 0 ? bytes : (bot.source ?? '')} size={32} />
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="flex min-w-0 items-center gap-2">
          <span className="truncate text-bright">{bot.name}</span>
          {count > 0 && <Chip variant="accent">×{count}</Chip>}
        </p>
        <p className="truncate text-data text-muted">
          {bot.author || 'anonymous'} · {broken ? '—' : `${bytes.length} B`}
        </p>
        {blurb !== '' && (
          // Two lines: a card is wide enough for most blurbs whole, and the hover holds the rest.
          <p className="line-clamp-2 text-data text-muted" title={blurb}>
            {blurb}
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {broken ? (
          <button
            type="button"
            className="rounded-sm focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-accent"
            onClick={onErrors}
          >
            <Chip variant="danger">errors</Chip>
          </button>
        ) : (
          <span className="relative flex">
            <IconButton
              icon={Plus}
              label={`add ${bot.name}`}
              size="sm"
              tooltip="left"
              disabled={full}
              onClick={onAdd}
            />
            {coach}
          </span>
        )}
        <Chip variant={bot.roster?.tier === 'showcase' ? 'accent' : 'neutral'}>
          {bot.roster?.tier ?? bot.origin}
        </Chip>
      </div>
    </li>
  )
}

/** The local bots as cards, or the one sentence that says there are none. */
function MineGrid({
  bots,
  assemble,
  query,
  write,
  clearSearch,
  ...grid
}: GridProps & {
  bots: readonly LocalBot[] | undefined
  /** Null while the assembler loads. */
  assemble: Assemble | null
  query: string
  /** The empty store's way on: the editor. */
  write: EmptyStateAction
  clearSearch: EmptyStateAction
}) {
  const catalog = useMemo(
    () => (assemble === null ? null : (bots ?? []).map((bot) => localCatalog(bot, assemble))),
    [bots, assemble],
  )
  if (bots === undefined || (catalog === null && bots.length > 0))
    return <p className="px-1 py-6 text-center text-muted">reading my bots…</p>
  if (bots.length === 0) {
    return <EmptyState action={write}>no bots in this browser yet.</EmptyState>
  }
  return (
    <BotGrid
      {...grid}
      bots={(catalog ?? []).filter((bot) => matchesQuery(bot, query))}
      empty={<EmptyState action={clearSearch}>none of my bots matches "{query}".</EmptyState>}
    />
  )
}

/**
 * Raw source, pasted: assembled as it changes, its errors listed under the box, and `add` once it
 * assembles, which saves it to my bots and picks it.
 */
function PasteBox({
  full,
  assemble,
  onAdd,
}: {
  full: boolean
  /** Null while the assembler loads. */
  assemble: Assemble | null
  onAdd: (name: string, source: string) => Promise<void>
}) {
  const [text, setText] = useState('')
  const [adding, setAdding] = useState(false)
  const deferred = useDeferredValue(text)
  const blank = deferred.trim() === ''
  const assembled = blank || assemble === null ? null : assemble(deferred)
  const errors = assembled?.diagnostics.filter((d) => d.severity === 'error') ?? []
  const ok = assembled !== null && errors.length === 0 && deferred === text
  return (
    <div className="flex flex-col gap-2">
      <textarea
        aria-label="bot source"
        placeholder={'%name "my bot"\n\nstart:  jmp start'}
        spellCheck={false}
        rows={14}
        value={text}
        onChange={(event) => setText(event.currentTarget.value)}
        className="w-full resize-y rounded-sm border border-border bg-panel-2 p-2 text-code text-text outline-hidden transition-colors duration-120 ease-out placeholder:text-dim hover:border-border-strong focus:border-accent"
      />
      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1 truncate text-data text-muted">
          {assembled === null
            ? blank
              ? 'paste x16c source: a %name line, then the code.'
              : 'loading the assembler…'
            : errors.length > 0
              ? `${errors.length} ${errors.length === 1 ? 'error' : 'errors'}`
              : `${assembled.name} · ${assembled.bytes.length} B`}
        </p>
        <Button
          variant="primary"
          icon={Plus}
          disabled={!ok || full}
          loading={adding}
          onClick={async () => {
            if (assembled === null) return
            setAdding(true)
            try {
              await onAdd(assembled.name, text)
              setText('')
            } finally {
              setAdding(false)
            }
          }}
        >
          add
        </Button>
      </div>
      {assembled !== null && errors.length > 0 && (
        <Diagnostics source={deferred} diagnostics={errors} />
      )}
    </div>
  )
}

/**
 * The bots picked, in the order they load: each with its hue swatch, its battle name, where it
 * comes from, its size, and `remove`. A shared bot can be saved to my bots.
 */
function Selection({
  selection,
  onRemove,
  onSave,
  onErrors,
  onStart,
}: {
  selection: readonly SetupBot[]
  onRemove: (index: number) => void
  onSave: (index: number) => void
  onErrors: (bot: CatalogBot) => void
  onStart: () => void
}) {
  if (selection.length === 0) {
    return (
      <EmptyState action={{ label: 'try dwarf vs paper', onClick: onStart }}>
        no bots yet: add some from the roster, or
      </EmptyState>
    )
  }
  return (
    <ol aria-label="bots picked" className="flex flex-col">
      {selection.map((entry) => {
        const { index, name, state, bot } = entry
        return (
          <li
            key={`${index}:${formatRef(entry.ref)}`}
            aria-label={name}
            className="flex min-w-0 items-center gap-2 border-b border-border py-1 last:border-b-0"
          >
            <HueSwatch hue={index} />
            <span className="w-5 shrink-0 text-right text-data text-muted">{index + 1}</span>
            <span className="min-w-0 flex-1 truncate text-bright">{name}</span>
            <SelectionState entry={entry} onErrors={onErrors} />
            {state === 'ready' && bot !== null && (
              <span className="text-data text-muted">{bot.assembled.bytes.length} B</span>
            )}
            {bot?.origin === 'shared' && (
              <IconButton
                icon={Save}
                label={`save ${name} to my bots`}
                size="sm"
                tooltip="left"
                onClick={() => onSave(index)}
              />
            )}
            <IconButton
              icon={X}
              label={`remove ${name}`}
              size="sm"
              tooltip="left"
              onClick={() => onRemove(index)}
            />
          </li>
        )
      })}
    </ol>
  )
}

function SelectionState({
  entry: { state, bot, ref },
  onErrors,
}: {
  entry: SetupBot
  onErrors: (bot: CatalogBot) => void
}) {
  switch (state) {
    case 'loading':
      return <Chip>loading</Chip>
    case 'missing':
      return (
        <Chip
          variant="danger"
          title={
            ref.kind === 'local'
              ? 'not in this browser: ask for a share link with its source'
              : 'not in the roster'
          }
        >
          missing
        </Chip>
      )
    case 'broken':
      return (
        <button
          type="button"
          className="rounded-sm focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-accent"
          onClick={() => bot !== null && onErrors(bot)}
        >
          <Chip variant="danger">errors</Chip>
        </button>
      )
    case 'ready':
      return <Chip>{bot?.origin ?? 'roster'}</Chip>
  }
}
