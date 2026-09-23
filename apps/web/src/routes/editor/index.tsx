import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '../../app/Placeholder'
import { titleHead } from '../../app/title'

export const Route = createFileRoute('/editor/')({
  head: () => titleHead('editor'),
  component: EditorPage,
})

function EditorPage() {
  return <Placeholder title="editor">the editor and the debugger arrive together.</Placeholder>
}
