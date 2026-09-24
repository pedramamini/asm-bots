/**
 * `/tournaments` (PRODUCT_SPEC §4): this browser's tournaments as cards (name, kind, entrants,
 * status, and the champion once there is one), filtered by kind and status and searched by name
 * and entrant. Mounting it picks up the tournaments a reload left running.
 */
import {
  Button,
  Chip,
  type ChipVariant,
  EmptyState,
  Identicon,
  Input,
  Panel,
  PanelGrid,
  Segmented,
} from '@asmbots/ui'
import { Link } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { assembleCached, rosterCatalog } from '../arena/setup/bots'
import { type TournamentRunner, tournamentRunner, useRunnerSync } from './runner'
import {
  KIND_LABELS,
  TOURNAMENT_KINDS,
  type Tournament,
  type TournamentEntrant,
  type TournamentKind,
  type TournamentStatus,
  useTournaments,
} from './store'

/** The status filter: `running` takes paused ones too, `finished` cancelled and failed ones. */
export type StatusFilter = 'all' | 'scheduled' | 'running' | 'finished'
export type KindFilter = 'all' | TournamentKind

const STATUS_FILTERS: readonly StatusFilter[] = ['all', 'scheduled', 'running', 'finished']

const FILTER_OF: Readonly<Record<TournamentStatus, StatusFilter>> = {
  scheduled: 'scheduled',
  running: 'running',
  paused: 'running',
  finished: 'finished',
  cancelled: 'finished',
  failed: 'finished',
}

export const STATUS_VARIANT: Readonly<Record<TournamentStatus, ChipVariant>> = {
  scheduled: 'info',
  running: 'accent',
  paused: 'warn',
  finished: 'neutral',
  cancelled: 'neutral',
  failed: 'danger',
}

export interface TournamentFilter {
  readonly kind: KindFilter
  readonly status: StatusFilter
  readonly query: string
}

/** The tournaments `filter` lets through: every word of the query in the name or an entrant's. */
export function filterTournaments(
  tournaments: readonly Tournament[],
  { kind, status, query }: TournamentFilter,
): Tournament[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return tournaments.filter((t) => {
    if (kind !== 'all' && t.kind !== kind) return false
    if (status !== 'all' && FILTER_OF[t.status] !== status) return false
    const text = [t.name, ...t.entrants.map((e) => e.name)].join(' ').toLowerCase()
    return words.every((word) => text.includes(word))
  })
}

/** What a card's status chip says: `running · 12 / 66` while it runs. */
export function statusLabel(t: Tournament): string {
  const { done, of } = t.progress
  return t.status === 'running' || t.status === 'paused'
    ? `${t.status} · ${done} / ${of}`
    : t.status
}

/** The bytes an entrant's identicon draws: its machine code, or its name when it has none. */
export function identiconValue(entrant: TournamentEntrant): Uint8Array | string {
  if (entrant.code === undefined && entrant.bytes !== undefined && entrant.bytes.length > 0) {
    return entrant.bytes
  }
  const assembled =
    entrant.source === 'roster'
      ? rosterCatalog().find((b) => b.ref.kind === 'roster' && b.ref.slug === entrant.ref)
          ?.assembled
      : entrant.code === undefined
        ? undefined
        : assembleCached(entrant.code)
  return assembled !== undefined && assembled.bytes.length > 0 ? assembled.bytes : entrant.name
}

export interface TournamentsPageProps {
  /** Opens the new tournament form. */
  onNew?: (() => void) | undefined
  /** The runner whose saves the list shows. Default: the page's. */
  runner?: TournamentRunner | undefined
}

export function TournamentsPage({ onNew, runner = tournamentRunner() }: TournamentsPageProps) {
  useRunnerSync(runner)
  const { data: tournaments } = useTournaments()
  const [kind, setKind] = useState<KindFilter>('all')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [query, setQuery] = useState('')
  const shown = filterTournaments(tournaments ?? [], { kind, status, query })
  const newButton = (
    <Button variant="primary" size="sm" icon={Plus} disabled={onNew === undefined} onClick={onNew}>
      new tournament
    </Button>
  )
  return (
    <PanelGrid className="p-3">
      <Panel
        className="col-span-12"
        title="tournaments"
        status={tournaments === undefined ? 'reading' : `${shown.length} of ${tournaments.length}`}
        actions={newButton}
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <Input
              type="search"
              aria-label="search tournaments"
              placeholder="search name or bot"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              className="w-56"
            />
            <Segmented<KindFilter>
              label="kind"
              options={[
                { value: 'all', label: 'all kinds' },
                ...TOURNAMENT_KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] })),
              ]}
              value={kind}
              onValueChange={setKind}
            />
            <Segmented<StatusFilter>
              label="status"
              options={STATUS_FILTERS.map((s) => ({
                value: s,
                label: s === 'all' ? 'any status' : s,
              }))}
              value={status}
              onValueChange={setStatus}
            />
          </div>
          {tournaments === undefined ? (
            <p className="text-data text-muted">reading…</p>
          ) : tournaments.length === 0 ? (
            <EmptyState action={{ label: 'new tournament', onClick: () => onNew?.() }}>
              no tournaments yet: pick some bots and run one here, in this browser.
            </EmptyState>
          ) : shown.length === 0 ? (
            <p className="text-data text-muted">no tournament matches.</p>
          ) : (
            <ul
              aria-label="tournament list"
              className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3"
            >
              {shown.map((t) => (
                <TournamentCard key={t.id} tournament={t} />
              ))}
            </ul>
          )}
        </div>
      </Panel>
    </PanelGrid>
  )
}

function TournamentCard({ tournament: t }: { tournament: Tournament }) {
  const winner = t.champion === null ? undefined : t.entrants[t.champion]
  return (
    <li aria-label={t.name}>
      <Link
        to="/tournaments/$id"
        params={{ id: t.id }}
        className="flex min-w-0 flex-col gap-2 rounded-md border border-border bg-panel-2 p-2 transition-colors duration-120 ease-out hover:border-border-strong focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-accent"
      >
        <p className="flex min-w-0 items-center gap-2">
          <span className="truncate text-bright">{t.name}</span>
        </p>
        <p className="flex flex-wrap items-center gap-2">
          <Chip>{KIND_LABELS[t.kind]}</Chip>
          <Chip variant={STATUS_VARIANT[t.status]}>{statusLabel(t)}</Chip>
          <span className="text-data text-muted">
            {t.entrants.length} {t.entrants.length === 1 ? 'bot' : 'bots'}
          </span>
        </p>
        {winner !== undefined && (
          <p className="flex min-w-0 items-center gap-2 text-data">
            <Identicon value={identiconValue(winner)} size={20} />
            <span className="text-muted">champion</span>
            <span className="truncate text-accent">{winner.name}</span>
          </p>
        )}
      </Link>
    </li>
  )
}
