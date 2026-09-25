import { createFileRoute } from '@tanstack/react-router'
import { PageHeading } from '../../app/PageHeading'
import { titleHead } from '../../app/title'
import { TournamentPage } from '../../features/tournaments/TournamentPage'

export const Route = createFileRoute('/tournaments/$id')({
  head: ({ params }) => titleHead('tournaments', params.id),
  component: TournamentsDetail,
})

function TournamentsDetail() {
  const { id } = Route.useParams()
  return (
    <>
      <PageHeading>tournament</PageHeading>
      <TournamentPage id={id} />
    </>
  )
}
