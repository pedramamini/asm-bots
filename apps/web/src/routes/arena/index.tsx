import { createFileRoute } from '@tanstack/react-router'
import { PageHeading } from '../../app/PageHeading'
import { titleHead } from '../../app/title'
import { ArenaPage } from '../../features/arena/ArenaPage'
import { validateArenaSearch } from '../../features/arena/setup/search'

export const Route = createFileRoute('/arena/')({
  // The setup: `?b=roster:dwarf,roster:paper&seed=42&cycles=100000&rounds=3&procs=64`.
  validateSearch: validateArenaSearch,
  head: () => titleHead('arena'),
  component: ArenaRoute,
})

function ArenaRoute() {
  return (
    <>
      <PageHeading>arena</PageHeading>
      <ArenaPage />
    </>
  )
}
