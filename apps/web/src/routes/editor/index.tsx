import { createFileRoute } from '@tanstack/react-router'
import { PageHeading } from '../../app/PageHeading'
import { titleHead } from '../../app/title'
import { EditorIndexRoute } from '../../features/editor/EditorRoutes'
import { validateEditorSearch } from '../../features/editor/search'

export const Route = createFileRoute('/editor/')({
  // A new bot, or what a link hands over: the arena's `open in debugger` setup
  // (`?b=roster:dwarf,roster:imp&seed=1&…`), a share link's `#src=`, a template's `?t=dwarf`.
  validateSearch: validateEditorSearch,
  head: () => titleHead('editor'),
  component: EditorIndex,
})

function EditorIndex() {
  return (
    <>
      <PageHeading>editor</PageHeading>
      <EditorIndexRoute />
    </>
  )
}
