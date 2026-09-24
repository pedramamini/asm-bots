import { PanelGrid } from '@asmbots/ui'
import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '../../app/Placeholder'
import { titleHead } from '../../app/title'
import { BracketView } from '../../features/tournaments/BracketView'
import { MeleeView } from '../../features/tournaments/MeleeView'
import { RoundRobinView } from '../../features/tournaments/RoundRobinView'
import { useRunnerSync } from '../../features/tournaments/runner'
import { type Tournament, useTournament } from '../../features/tournaments/store'
import { TournamentControls } from '../../features/tournaments/TournamentControls'

export const Route = createFileRoute('/tournaments/$id')({
  head: ({ params }) => titleHead('tournaments', params.id),
  component: TournamentsDetail,
})

const VIEWS = { bracket: BracketView, 'round-robin': RoundRobinView, melee: MeleeView } as const

// TODO(EXEC 2.5 detail route): the header (name, kind, entrants), and sharing.
function TournamentsDetail() {
  const { id } = Route.useParams()
  useRunnerSync()
  const { data: tournament } = useTournament(id)
  if (tournament == null) {
    return (
      <Placeholder title="tournaments" status={id}>
        {tournament === null ? 'this browser has no tournament by that id.' : 'reading…'}
      </Placeholder>
    )
  }
  return <TournamentDetail tournament={tournament} />
}

function TournamentDetail({ tournament }: { tournament: Tournament }) {
  const View = VIEWS[tournament.kind]
  return (
    <PanelGrid className="p-3">
      <div className="col-span-12 flex flex-col gap-3">
        <TournamentControls tournament={tournament} />
        <View tournament={tournament} />
      </div>
    </PanelGrid>
  )
}
