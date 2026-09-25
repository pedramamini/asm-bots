/**
 * A server tournament's page (PRODUCT_SPEC §4): the header (name, kind, status, the `server` chip,
 * the entry window with `enter`, the owner's `start`, `share`, and the entrants), the tournament's
 * live room (the `LIVE` chip, the spectators, and `auto-watch`, which runs each match the `Runner`
 * starts here too), and the view of its kind, the local tournaments' own, fed by the API
 * (`fromServer`). Each match the room says has landed reads the tournament again; with the room
 * closed, a running tournament is read again every few seconds.
 */
import {
  entrantNames,
  liveRoomName,
  type Tournament as ServerRecord,
  type TournamentDetail,
} from '@asmbots/protocol'
import { Button, Chip, Identicon, Panel, PanelGrid, useToast } from '@asmbots/ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Cloud, Play, Trophy } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { isNotFound } from '../../api/client'
import { useMe, useTournament } from '../../api/queries'
import { startTournament } from '../../api/writes'
import { TOURNAMENTS_ABOUT } from '../../app/intros/tournaments'
import { LoadFailure } from '../../app/LoadFailure'
import { PageIntro } from '../../app/PageIntro'
import { Placeholder } from '../../app/Placeholder'
import type { ArenaClient } from '../arena/worker/client'
import { plural } from '../hills/links'
import { LivePanel } from '../live/LivePanel'
import type { LiveRoomOptions } from '../live/room'
import { useLiveRoom } from '../live/useLiveRoom'
import { ShareMenu, type ShareTarget } from '../share/ShareMenu'
import { embedTitle, embedUrl } from '../share/share'
import { BracketView } from './BracketView'
import { EnterButton } from './EnterModal'
import { takesEntries, utcTime } from './entry'
import { MeleeView } from './MeleeView'
import { RoundRobinView } from './RoundRobinView'
import { fromServer } from './server'
import { KIND_LABELS, type Tournament } from './store'
import { StatusChip } from './TournamentControls'
import { identiconValue } from './TournamentsPage'

const VIEWS = { bracket: BracketView, 'round-robin': RoundRobinView, melee: MeleeView } as const

const OPEN_LIST = { label: 'all tournaments', to: '/tournaments' } as const

export interface ServerTournamentPageProps {
  id: string
  /** The live room's socket and timers; tests pass stand-ins. Default: the browser's. */
  live?: LiveRoomOptions | undefined
  /** Makes the live arena's client; tests pass one without a Worker. */
  createArenaClient?: (() => ArenaClient) | undefined
}

export function ServerTournamentPage({ id, live, createArenaClient }: ServerTournamentPageProps) {
  const client = useQueryClient()
  // Nothing more happens in a room once its tournament has ended: no socket for it.
  const cached = client.getQueryData<TournamentDetail>(['tournaments', id])
  const over = cached?.tournament.status === 'finished' || cached?.tournament.status === 'cancelled'
  const room = useLiveRoom(
    cached === undefined || over ? null : liveRoomName({ kind: 'tournament', id }),
    live,
  )
  const read = useTournament(id, room.status !== 'live')
  const progress = room.jobs.get(`tournament:${id}`)
  const done = progress?.done
  const status = progress?.status
  useEffect(() => {
    if (done !== undefined) void client.invalidateQueries({ queryKey: ['tournaments', id] })
  }, [client, id, done, status])
  const detail = read.data
  const t = useMemo(() => (detail === undefined ? undefined : fromServer(detail)), [detail])
  if (isNotFound(read.error)) {
    return (
      <Placeholder title="tournaments" status={id} action={OPEN_LIST}>
        there is no tournament by that id, in this browser or on the server.
      </Placeholder>
    )
  }
  if (detail === undefined || t === undefined) {
    return read.error === null ? (
      <Placeholder title="tournaments" status={id} action={OPEN_LIST}>
        reading…
      </Placeholder>
    ) : (
      <PanelGrid className="p-3">
        <Panel className="col-span-12" title="tournaments" status={id}>
          <LoadFailure read={read} />
        </Panel>
      </PanelGrid>
    )
  }
  const View = VIEWS[t.kind]
  const ended = t.status === 'finished' || t.status === 'cancelled'
  return (
    <PanelGrid className="p-3">
      <PageIntro about={TOURNAMENTS_ABOUT} art="bracket" />
      <div className="col-span-12 flex min-w-0 flex-col gap-3 xl:col-span-8">
        <ServerHeader detail={detail} tournament={t} />
      </div>
      <div className="col-span-12 flex min-w-0 flex-col gap-3 xl:col-span-4">
        {ended ? (
          <Panel title="live" status={t.status}>
            <p className="text-data text-muted">
              {t.status === 'finished'
                ? 'every match is played: watch any round below, and check it.'
                : 'it was cancelled: nothing more plays.'}
            </p>
          </Panel>
        ) : (
          <LivePanel live={room} createClient={createArenaClient} />
        )}
      </div>
      <div className="col-span-12 flex min-w-0 flex-col gap-3">
        <View tournament={t} />
      </div>
    </PanelGrid>
  )
}

/** What the header says of the entry: open until when, closed since when, or invited. */
function entryNote(t: ServerRecord): string {
  if (t.entry === 'invite') return 'the bots its owner invited.'
  const closes = t.entryClosesAt === null ? '' : utcTime(t.entryClosesAt)
  if (takesEntries(t)) return `open entry until ${closes}: one bot a player.`
  const start =
    t.startsAt === null
      ? ''
      : `, ${t.status === 'scheduled' ? 'starts' : 'started'} ${utcTime(t.startsAt)}`
  return `entries closed ${closes}${start}.`
}

/**
 * What a server tournament's page shares (PRODUCT_SPEC §10): its link, its card as a PNG (a draft
 * has none), and an embed of the match it finished last, when one has a replay.
 */
export function serverShare(detail: TournamentDetail, origin: string): ShareTarget {
  const record = detail.tournament
  const names = entrantNames(detail.entrants)
  const nameOf = new Map(detail.entrants.map((label, e) => [label.versionId, names[e]]))
  let last: { key: string; at: string; bots: readonly string[] } | null = null
  for (const match of detail.matches) {
    if (match.replayKey === null || match.finishedAt === null) continue
    if (last !== null && match.finishedAt <= last.at) continue
    const bots = match.participants.map((id) => nameOf.get(id) ?? 'a deleted bot')
    last = { key: match.replayKey, at: match.finishedAt, bots }
  }
  return {
    link: `${origin}/tournaments/${record.id}`,
    png:
      record.status === 'draft'
        ? undefined
        : { path: `/tournaments/${record.id}/og.png`, name: `asmbots-${record.slug}.png` },
    embed:
      last === null
        ? undefined
        : { url: embedUrl(`${origin}/arena/${last.key}`), title: embedTitle(last.bots) },
  }
}

function ServerHeader({
  detail,
  tournament: t,
}: {
  detail: TournamentDetail
  tournament: Tournament
}) {
  const record = detail.tournament
  const scheduled = record.status === 'scheduled' || record.status === 'draft'
  const n = t.entrants.length
  const share = <ShareMenu {...serverShare(detail, window.location.origin)} />
  return (
    <Panel title={t.name} status={plural(n, 'bot')} actions={share}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Chip icon={Cloud} variant="info" title="the server runs it">
            server
          </Chip>
          {record.ownerId === null && (
            <Chip icon={Trophy} variant="accent">
              championship
            </Chip>
          )}
          <Chip>{KIND_LABELS[t.kind]}</Chip>
          <StatusChip tournament={t} />
          {scheduled && <ServerControls detail={detail} />}
        </div>
        <p className="text-data text-muted">{entryNote(record)}</p>
        {n === 0 ? (
          <p className="text-data text-muted">no bots have entered yet.</p>
        ) : (
          <ul aria-label="entrants" className="flex flex-wrap gap-1">
            {t.entrants.map((entrant, e) => (
              <li key={entrant.ref}>
                <Chip
                  variant={e === t.champion ? 'accent' : 'neutral'}
                  title={e === t.champion ? 'champion' : detail.entrants[e]?.owner}
                >
                  <Identicon value={identiconValue(entrant)} size={8} />
                  {entrant.name}
                </Chip>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  )
}

/**
 * A tournament not started yet: `enter` while an open one takes entries, and its owner's `start`,
 * enabled once entries have closed and 2 bots are in.
 */
function ServerControls({ detail }: { detail: TournamentDetail }) {
  const { toast } = useToast()
  const me = useMe()
  const client = useQueryClient()
  const record = detail.tournament
  const start = useMutation({
    mutationFn: () => startTournament(record.id),
    onSuccess: () => {
      toast(`${record.name} is running on the server.`, { variant: 'accent' })
      void client.invalidateQueries({ queryKey: ['tournaments'] })
    },
    onError: (error) => toast(`could not start: ${error.message}`, { variant: 'danger' }),
  })
  const owner = me.data != null && record.ownerId === me.data.user.id
  const canStart = owner && !takesEntries(record) && detail.entrants.length >= 2
  return (
    <>
      {record.entry === 'open' && <EnterButton tournament={record} entrants={detail.entrants} />}
      {owner && (
        <Button
          size="sm"
          variant="primary"
          icon={Play}
          disabled={!canStart || start.isPending}
          title={canStart ? undefined : 'it starts once entries close, with 2 bots or more'}
          onClick={() => start.mutate()}
        >
          {start.isPending ? 'starting…' : 'start'}
        </Button>
      )}
    </>
  )
}
