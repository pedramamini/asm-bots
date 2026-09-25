import { createFileRoute } from '@tanstack/react-router'
import { titleHead } from '../../../app/title'
import { EmbedReplay } from '../../../features/embed/EmbedArena'

export const Route = createFileRoute('/embed/arena/$replayId')({
  // A replay's embed: `/embed/arena/<replay key>`, or `<match key>#r=…` for one the link carries.
  head: ({ params }) => titleHead('embed', `replay ${params.replayId}`),
  staticData: { frame: false },
  component: EmbedReplayRoute,
})

function EmbedReplayRoute() {
  const { replayId } = Route.useParams()
  return <EmbedReplay replayId={replayId} />
}
