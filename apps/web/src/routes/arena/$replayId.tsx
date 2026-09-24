import { createFileRoute } from '@tanstack/react-router'
import { titleHead } from '../../app/title'
import { ReplayPage } from '../../features/arena/ReplayPage'

export const Route = createFileRoute('/arena/$replayId')({
  // A replay link: `/arena/<match key>#r=<base64url of the replay's JSON>`.
  head: ({ params }) => titleHead('arena', `replay ${params.replayId}`),
  component: ReplayRoute,
})

function ReplayRoute() {
  const { replayId } = Route.useParams()
  return <ReplayPage replayId={replayId} />
}
