import { createFileRoute } from '@tanstack/react-router'
import { titleHead } from '../../../app/title'
import { validateArenaSearch } from '../../../features/arena/setup/search'
import { EmbedSetup } from '../../../features/embed/EmbedArena'

export const Route = createFileRoute('/embed/arena/')({
  // An arena link's query and fragment: `?b=roster:dwarf,roster:imp&seed=42#src=…`.
  validateSearch: validateArenaSearch,
  head: () => titleHead('embed'),
  // Another site's `<iframe>`: the arena alone, no header, ticker, or status bar.
  staticData: { frame: false },
  component: EmbedSetupRoute,
})

function EmbedSetupRoute() {
  return <EmbedSetup />
}
