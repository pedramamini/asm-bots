import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '../../app/Placeholder'
import { titleHead } from '../../app/title'

export const Route = createFileRoute('/arena/')({
  head: () => titleHead('arena'),
  component: ArenaPage,
})

function ArenaPage() {
  return (
    <Placeholder title="arena">
      the arena arrives with its renderer: roster, config, and fight.
    </Placeholder>
  )
}
