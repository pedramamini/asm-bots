import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '../../app/Placeholder'
import { titleHead } from '../../app/title'

export const Route = createFileRoute('/tournaments/')({
  head: () => titleHead('tournaments'),
  component: TournamentsPage,
})

function TournamentsPage() {
  return (
    <Placeholder title="tournaments">
      scheduled, running, and finished tournaments list here.
    </Placeholder>
  )
}
