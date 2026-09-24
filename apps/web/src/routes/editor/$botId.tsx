import { createFileRoute } from '@tanstack/react-router'
import { titleHead } from '../../app/title'
import { EditorBotRoute } from '../../features/editor/EditorRoutes'

export const Route = createFileRoute('/editor/$botId')({
  // A bot of this browser by id, or a roster bot, read-only: `/editor/roster-dwarf`.
  head: ({ params }) => titleHead('editor', params.botId),
  component: EditorDetail,
})

function EditorDetail() {
  return <EditorBotRoute />
}
