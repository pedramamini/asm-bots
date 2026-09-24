import { createFileRoute } from '@tanstack/react-router'
import { titleHead } from '../../app/title'
import { BotPage } from '../../features/bots/BotPage'

export const Route = createFileRoute('/bots/$id')({
  head: ({ params }) => titleHead('bots', params.id),
  component: BotsDetail,
})

function BotsDetail() {
  const { id } = Route.useParams()
  return <BotPage id={id} />
}
