import { createFileRoute } from '@tanstack/react-router'
import { titleHead } from '../../app/title'
import { TournamentPage } from '../../features/tournaments/TournamentPage'

export const Route = createFileRoute('/tournaments/$id')({
  head: ({ params }) => titleHead('tournaments', params.id),
  component: TournamentsDetail,
})

function TournamentsDetail() {
  const { id } = Route.useParams()
  return <TournamentPage id={id} />
}
