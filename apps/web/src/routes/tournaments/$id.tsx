import { PanelGrid } from '@asmbots/ui'
import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '../../app/Placeholder'
import { titleHead } from '../../app/title'
import { BracketView } from '../../features/tournaments/BracketView'
import { useRunnerSync } from '../../features/tournaments/runner'
import { useTournament } from '../../features/tournaments/store'

export const Route = createFileRoute('/tournaments/$id')({
  head: ({ params }) => titleHead('tournaments', params.id),
  component: TournamentsDetail,
})

// TODO(EXEC 2.5 detail route): the header, the round robin and melee views, and sharing.
function TournamentsDetail() {
  const { id } = Route.useParams()
  useRunnerSync()
  const { data: tournament } = useTournament(id)
  if (tournament?.kind === 'bracket') {
    return (
      <PanelGrid className="p-3">
        <div className="col-span-12">
          <BracketView tournament={tournament} />
        </div>
      </PanelGrid>
    )
  }
  return (
    <Placeholder title="tournaments" status={tournament?.name ?? id}>
      {tournament === null
        ? 'this browser has no tournament by that id.'
        : 'the bracket, the matrix, or the melee standings show here.'}
    </Placeholder>
  )
}
