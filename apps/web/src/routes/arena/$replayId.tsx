import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '../../app/Placeholder'
import { titleHead } from '../../app/title'

export const Route = createFileRoute('/arena/$replayId')({
  head: ({ params }) => titleHead('arena', params.replayId),
  component: ArenaDetail,
})

function ArenaDetail() {
  const { replayId } = Route.useParams()
  return (
    <Placeholder title="arena" status={replayId}>
      the replay plays here once the arena lands.
    </Placeholder>
  )
}
