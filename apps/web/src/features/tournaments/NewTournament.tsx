/**
 * The new tournament form (PRODUCT_SPEC §4), in a modal: a name, the kind, the bots (roster bots
 * and my bots, checked in a list, and `.asm` files dropped on the form), the battle config with
 * its rounds per match and presets, a bracket's seeding and third-place match, and `start now`.
 * Under the bots, what the tournament plays and how long it may take, or why it cannot start.
 */
import {
  Button,
  Chip,
  IconButton,
  Identicon,
  Input,
  Modal,
  Segmented,
  Toggle,
  useToast,
} from '@asmbots/ui'
import { FileUp, X } from 'lucide-react'
import { type DragEvent, useId, useMemo, useRef, useState } from 'react'
import { useLocalBots } from '../../store/local-bots'
import type { ArenaConfig } from '../../store/settings'
import {
  type CatalogBot,
  carriesFiles,
  errorsOf,
  fileAssembles,
  localCatalog,
  matchesQuery,
  readBotFiles,
  rosterCatalog,
} from '../arena/setup/bots'
import { ConfigForm } from '../arena/setup/ConfigForm'
import {
  DEFAULT_ARENA_CONFIG,
  type PresetName,
  presetOf,
  withConfig,
  withPreset,
} from '../arena/setup/config'
import { checkPlan, defaultName, type PickedEntrant, tournamentInput, uniqueNames } from './create'
import { type TournamentRunner, tournamentRunner } from './runner'
import {
  KIND_LABELS,
  TOURNAMENT_KINDS,
  type Tournament,
  type TournamentKind,
  useTournamentActions,
} from './store'

/** Where the picker's bots come from. */
type Source = 'roster' | 'mine'

const SOURCES = [
  { value: 'roster', label: 'roster' },
  { value: 'mine', label: 'my bots' },
] as const satisfies readonly { value: Source; label: string }[]

/** A picked bot's key: its source and ref. */
const keyOf = (e: Pick<PickedEntrant, 'source' | 'ref'>) => `${e.source}:${e.ref}`

/** The entrant a picker bot makes: a roster bot by slug, a local one with its source. */
function entrantOf(bot: CatalogBot): PickedEntrant {
  const size = bot.assembled.bytes.length
  return bot.ref.kind === 'roster'
    ? { source: 'roster', ref: bot.ref.slug, name: bot.name, size }
    : { source: 'local', ref: bot.ref.id, name: bot.name, code: bot.source, size }
}

/** The preset a kind starts from, while the config is a preset: a crowd gets a melee's. */
function presetFor(kind: TournamentKind, entrants: number): PresetName {
  if (kind !== 'melee') return 'duel'
  return entrants > 8 ? 'melee 16' : 'melee 8'
}

export interface NewTournamentProps {
  open: boolean
  onClose: () => void
  /** The tournament made, after it is stored (and started, with `start now`). */
  onCreated?: ((tournament: Tournament) => void) | undefined
  /** What `start now` starts it on. Default: the page's. */
  runner?: TournamentRunner | undefined
}

export function NewTournament({ open, onClose, ...rest }: NewTournamentProps) {
  // Mounted while open, so each opening starts from a blank form.
  return (
    <Modal open={open} onClose={onClose} title="new tournament" size="lg">
      <NewTournamentForm onClose={onClose} {...rest} />
    </Modal>
  )
}

function NewTournamentForm({
  onClose,
  onCreated,
  runner = tournamentRunner(),
}: Omit<NewTournamentProps, 'open'>) {
  const { toast } = useToast()
  const { create } = useTournamentActions()
  const localBots = useLocalBots()
  const nameId = useId()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<TournamentKind>('round-robin')
  const [source, setSource] = useState<Source>('roster')
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<readonly PickedEntrant[]>([])
  const [config, setConfig] = useState<ArenaConfig>(DEFAULT_ARENA_CONFIG)
  const [thirdPlace, setThirdPlace] = useState(true)
  const [seeding, setSeeding] = useState<'given' | 'random'>('given')
  const [startNow, setStartNow] = useState(true)
  const [dragDepth, setDragDepth] = useState(0)
  const picker = useRef<HTMLInputElement>(null)

  const mine = useMemo(() => (localBots.data ?? []).map(localCatalog), [localBots.data])
  const pickedKeys = new Set(picked.map(keyOf))
  const names = uniqueNames(picked.map((e) => e.name))
  const plan = {
    kind,
    entrants: picked.length,
    rounds: config.rounds,
    maxCycles: config.maxCycles,
    thirdPlace,
  }
  const check = checkPlan(plan)

  /** Appends the bots not picked yet, in order. */
  const add = (list: readonly PickedEntrant[]) =>
    setPicked((now) => {
      const keys = new Set(now.map(keyOf))
      return [...now, ...list.filter((e) => !keys.has(keyOf(e)))]
    })
  const remove = (key: string) => setPicked((now) => now.filter((e) => keyOf(e) !== key))
  const toggle = (bot: CatalogBot) => {
    const entrant = entrantOf(bot)
    if (pickedKeys.has(keyOf(entrant))) remove(keyOf(entrant))
    else add([entrant])
  }

  const changeKind = (next: TournamentKind) => {
    setKind(next)
    // A preset follows the kind into and out of a melee; a hand-made config stays.
    if ((next === 'melee') !== (kind === 'melee') && presetOf(config) !== null) {
      setConfig((c) => withPreset(c, presetFor(next, picked.length)))
    }
  }

  const addFiles = async (files: readonly File[]) => {
    if (files.length === 0) return
    const read = await readBotFiles(files)
    add(
      read.filter(fileAssembles).map((file) => ({
        source: 'local',
        ref: file.file,
        name: file.assembled.name || file.file.replace(/\.asm$/i, ''),
        code: file.source,
        size: file.assembled.bytes.length,
      })),
    )
    const bad = read.filter((file) => !fileAssembles(file))
    if (bad.length > 0) {
      const what = bad.length === 1 ? (bad[0]?.file ?? 'a file') : `${bad.length} files`
      toast(`${what} did not assemble: fix it in the editor.`, { variant: 'danger' })
    }
  }

  const submit = async () => {
    const input = tournamentInput({ name, kind, entrants: picked, config, thirdPlace, seeding })
    if (input === null) {
      toast('the bots do not fit in the core: lower the spacing.', { variant: 'danger' })
      return
    }
    try {
      const made = await create.mutateAsync(input)
      if (startNow) void runner.start(made.id)
      onCreated?.(made)
      onClose()
    } catch {
      toast('could not save the tournament in this browser.', { variant: 'danger' })
    }
  }

  const onDragEnter = (event: DragEvent<HTMLFormElement>) => {
    if (!carriesFiles(event)) return
    event.preventDefault()
    setDragDepth((depth) => depth + 1)
  }
  const onDragOver = (event: DragEvent<HTMLFormElement>) => {
    if (!carriesFiles(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }
  const onDragLeave = (event: DragEvent<HTMLFormElement>) => {
    if (carriesFiles(event)) setDragDepth((depth) => Math.max(0, depth - 1))
  }
  const onDrop = (event: DragEvent<HTMLFormElement>) => {
    if (!carriesFiles(event)) return
    event.preventDefault()
    setDragDepth(0)
    void addFiles(Array.from(event.dataTransfer.files))
  }

  const list = source === 'roster' ? rosterCatalog() : mine
  const shown = list.filter((bot) => matchesQuery(bot, query))
  const showcase = rosterCatalog().filter((bot) => bot.roster?.tier === 'showcase')

  return (
    <form
      className="relative flex flex-col gap-4"
      data-dragging={dragDepth > 0 || undefined}
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor={nameId} className="text-panel-status text-muted">
          name
        </label>
        <Input
          id={nameId}
          autoFocus
          autoComplete="off"
          className="min-w-0 flex-1"
          placeholder={defaultName(kind, picked.length)}
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
        />
        <Segmented<TournamentKind>
          label="kind"
          options={TOURNAMENT_KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] }))}
          value={kind}
          onValueChange={changeKind}
        />
      </div>

      <section aria-label="bots" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented<Source>
            label="bot source"
            options={SOURCES}
            value={source}
            onValueChange={setSource}
          />
          <Input
            type="search"
            aria-label="search bots"
            placeholder="search bots"
            className="w-40"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          {source === 'roster' && (
            <Button size="sm" onClick={() => add(showcase.map(entrantOf))}>
              select all showcase
            </Button>
          )}
        </div>
        {source === 'mine' && localBots.data === undefined && !localBots.isError ? (
          <p className="px-1 py-3 text-data text-muted">reading my bots…</p>
        ) : shown.length === 0 ? (
          <p className="px-1 py-3 text-data text-muted">
            {list.length === 0 ? 'no bots in this browser yet.' : `no bot matches "${query}".`}
          </p>
        ) : (
          <ul
            aria-label="bots to pick"
            className="grid max-h-48 grid-cols-1 overflow-auto rounded-sm border border-border sm:grid-cols-2"
          >
            {shown.map((bot) => (
              <PickRow
                key={keyOf(entrantOf(bot))}
                bot={bot}
                checked={pickedKeys.has(keyOf(entrantOf(bot)))}
                onToggle={() => toggle(bot)}
              />
            ))}
          </ul>
        )}
        <div className="flex items-center justify-between gap-3 rounded-sm border border-dashed border-border px-3 py-2 text-data text-muted">
          <span>drop .asm files here to enter them.</span>
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
        {picked.length > 0 && (
          <ol aria-label="entrants" className="flex flex-wrap gap-1">
            {picked.map((entrant, i) => (
              <li
                key={keyOf(entrant)}
                aria-label={names[i]}
                className="flex items-center gap-1 rounded-sm border border-border bg-panel-2 py-0.5 pr-0.5 pl-2 text-data"
              >
                <span className="text-muted">{i + 1}</span>
                <span className="text-bright">{names[i]}</span>
                <IconButton
                  icon={X}
                  size="sm"
                  label={`remove ${names[i]}`}
                  onClick={() => remove(keyOf(entrant))}
                />
              </li>
            ))}
          </ol>
        )}
        <p aria-live="polite" className="text-data">
          {check.error !== null ? (
            <span className="text-danger">{check.error}</span>
          ) : (
            <span className="text-muted">{check.summary}</span>
          )}
          {check.warning !== null && <span className="block text-warn">{check.warning}</span>}
        </p>
      </section>

      <section aria-label="config" className="flex flex-col gap-3">
        <ConfigForm
          config={config}
          onChange={(change) => setConfig((c) => withConfig(c, change))}
          onPreset={(preset) => setConfig((c) => withPreset(c, preset))}
        />
        {kind === 'bracket' && (
          <div className="flex flex-wrap items-center gap-3">
            <Segmented<'given' | 'random'>
              label="seeding"
              options={[
                { value: 'given', label: 'seeds as picked' },
                { value: 'random', label: 'shuffle seeds' },
              ]}
              value={seeding}
              onValueChange={setSeeding}
            />
            <Toggle pressed={thirdPlace} onPressedChange={setThirdPlace}>
              third-place match
            </Toggle>
          </div>
        )}
      </section>

      <footer className="flex items-center justify-end gap-2 border-t border-border pt-3">
        <Toggle pressed={startNow} onPressedChange={setStartNow} className="mr-auto">
          start now
        </Toggle>
        <Button onClick={onClose}>cancel</Button>
        <Button
          type="submit"
          name="create"
          variant="primary"
          disabled={check.error !== null}
          loading={create.isPending}
        >
          {startNow ? 'start' : 'create'}
        </Button>
      </footer>

      {dragDepth > 0 && (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-md border border-dashed border-accent bg-accent-10">
          <p className="text-nav text-accent-fg">drop .asm files to enter them</p>
        </div>
      )}
    </form>
  )
}

/** A bot in the picker: a checkbox, its identicon, name, size, and tier or `errors`. */
function PickRow({
  bot,
  checked,
  onToggle,
}: {
  bot: CatalogBot
  checked: boolean
  onToggle: () => void
}) {
  const { bytes } = bot.assembled
  const broken = errorsOf(bot).length > 0
  return (
    <li className="min-w-0 border-b border-border last:border-b-0">
      <label className="flex min-w-0 cursor-pointer items-center gap-2 px-2 py-1 hover:bg-panel-2 has-disabled:cursor-not-allowed">
        <input
          type="checkbox"
          aria-label={bot.name}
          checked={checked}
          disabled={broken && !checked}
          onChange={onToggle}
          className="size-3 shrink-0 accent-(--accent)"
        />
        <Identicon value={bytes.length > 0 ? bytes : bot.source} size={16} />
        <span className="min-w-0 flex-1 truncate text-bright">{bot.name}</span>
        <span className="shrink-0 text-data text-muted">{broken ? '—' : `${bytes.length} B`}</span>
        {broken ? (
          <Chip variant="danger">errors</Chip>
        ) : (
          bot.roster !== undefined && (
            <Chip variant={bot.roster.tier === 'showcase' ? 'accent' : 'neutral'}>
              {bot.roster.tier}
            </Chip>
          )
        )}
      </label>
    </li>
  )
}
