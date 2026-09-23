import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '../../app/Placeholder'
import { titleHead } from '../../app/title'

export const Route = createFileRoute('/editor/$botId')({
  head: ({ params }) => titleHead('editor', params.botId),
  component: EditorDetail,
})

function EditorDetail() {
  const { botId } = Route.useParams()
  return (
    <Placeholder title="editor" status={botId}>
      this bot opens here once the editor lands.
    </Placeholder>
  )
}
