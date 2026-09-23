import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '../../app/Placeholder'
import { titleHead } from '../../app/title'

export const Route = createFileRoute('/bots/$id')({
  head: ({ params }) => titleHead('bots', params.id),
  component: BotsDetail,
})

function BotsDetail() {
  const { id } = Route.useParams()
  return (
    <Placeholder title="bots" status={id}>
      this bot's page shows here.
    </Placeholder>
  )
}
