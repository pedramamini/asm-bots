import { createFileRoute } from '@tanstack/react-router'
import { titleHead } from '../../app/title'
import { TournamentsPage } from '../../features/tournaments/TournamentsPage'

export const Route = createFileRoute('/tournaments/')({
  head: () => titleHead('tournaments'),
  component: TournamentsRoute,
})

function TournamentsRoute() {
  return <TournamentsPage />
}
