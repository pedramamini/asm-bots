import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '../../app/Placeholder'
import { titleHead } from '../../app/title'
import { validateArenaSearch } from '../../features/arena/setup/search'

export const Route = createFileRoute('/editor/')({
  // What the arena's `open in debugger` hands over, in the arena's own query:
  // `?b=roster:dwarf,roster:imp&seed=1&cycles=100000&procs=64&spacing=1024`.
  validateSearch: validateArenaSearch,
  head: () => titleHead('editor'),
  component: EditorPage,
})

function EditorPage() {
  const { b, seed } = Route.useSearch()
  const bots = b === undefined ? 0 : b.split(',').length
  return (
    <Placeholder
      title="editor"
      status={bots > 0 ? `${bots} bots · seed ${seed ?? 'random'}` : undefined}
    >
      the editor and the debugger arrive together.
    </Placeholder>
  )
}
