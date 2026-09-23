import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '../../app/Placeholder'
import { titleHead } from '../../app/title'

export const Route = createFileRoute('/tournaments/$id')({
  head: ({ params }) => titleHead('tournaments', params.id),
  component: TournamentsDetail,
})

function TournamentsDetail() {
  const { id } = Route.useParams()
  return (
    <Placeholder title="tournaments" status={id}>
      the bracket, the matrix, or the melee standings show here.
    </Placeholder>
  )
}
