/**
 * `/tournaments/$id` (PRODUCT_SPEC §4): the header (`TournamentHeader`: name, kind, status, the
 * controls, `share`, the entrants) over the view of its kind, each with its match panel. The
 * tournament is this browser's by that id, or else the one a share link carries in its fragment
 * (`#t=`, `share.ts`), read only, or else the server's (`ServerTournament.tsx`). Mounting it picks
 * up the local tournaments a reload left running.
 */
import { PanelGrid } from '@asmbots/ui'
import { useLocation } from '@tanstack/react-router'
import { useMemo } from 'react'
import { TOURNAMENTS_ABOUT } from '../../app/intros/tournaments'
import { PageIntro } from '../../app/PageIntro'
import { Placeholder } from '../../app/Placeholder'
import type { ArenaClient } from '../arena/worker/client'
import type { LiveRoomOptions } from '../live/room'
import { BracketView } from './BracketView'
import { MeleeView } from './MeleeView'
import { RoundRobinView } from './RoundRobinView'
import { type TournamentRunner, tournamentRunner, useRunnerSync } from './runner'
import { ServerTournamentPage } from './ServerTournament'
import { readTournamentFragment } from './share'
import { type Tournament, useTournament } from './store'
import { TournamentHeader } from './TournamentHeader'

const VIEWS = { bracket: BracketView, 'round-robin': RoundRobinView, melee: MeleeView } as const

const OPEN_LIST = { label: 'all tournaments', to: '/tournaments' } as const

export interface TournamentPageProps {
  id: string
  /** The runner whose saves the page shows. Default: the page's. */
  runner?: TournamentRunner | undefined
  /** A server tournament's live room socket and timers; tests pass stand-ins. */
  live?: LiveRoomOptions | undefined
  /** Makes a server tournament's live arena client; tests pass one without a Worker. */
  createArenaClient?: (() => ArenaClient) | undefined
}

export function TournamentPage({
  id,
  runner = tournamentRunner(),
  live,
  createArenaClient,
}: TournamentPageProps) {
  useRunnerSync(runner)
  const { data: tournament } = useTournament(id)
  const hash = useLocation({ select: (location) => location.hash })
  const read = useMemo(
    () => (tournament === null ? readTournamentFragment(hash, id) : null),
    [tournament, hash, id],
  )
  if (tournament === undefined) {
    return (
      <Placeholder title="tournaments" status={id}>
        reading…
      </Placeholder>
    )
  }
  if (tournament !== null) return <TournamentDetail tournament={tournament} />
  if (read?.kind === 'ok') return <TournamentDetail tournament={read.tournament} shared />
  if (read?.kind === 'broken') {
    return (
      <Placeholder title="tournaments" status={id} action={OPEN_LIST}>
        this tournament link is broken: {read.reason}.
      </Placeholder>
    )
  }
  return <ServerTournamentPage id={id} live={live} createArenaClient={createArenaClient} />
}

function TournamentDetail({ tournament, shared }: { tournament: Tournament; shared?: boolean }) {
  const View = VIEWS[tournament.kind]
  return (
    <PanelGrid className="p-3">
      <PageIntro about={TOURNAMENTS_ABOUT} art="bracket" />
      <div className="col-span-12 flex flex-col gap-3">
        <TournamentHeader tournament={tournament} shared={shared} />
        <View tournament={tournament} />
      </div>
    </PanelGrid>
  )
}
