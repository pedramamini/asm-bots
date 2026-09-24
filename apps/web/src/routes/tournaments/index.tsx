import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { titleHead } from '../../app/title'
import { NewTournament } from '../../features/tournaments/NewTournament'
import { TournamentsPage } from '../../features/tournaments/TournamentsPage'

export const Route = createFileRoute('/tournaments/')({
  head: () => titleHead('tournaments'),
  component: TournamentsRoute,
})

function TournamentsRoute() {
  const [creating, setCreating] = useState(false)
  return (
    <>
      <TournamentsPage onNew={() => setCreating(true)} />
      <NewTournament open={creating} onClose={() => setCreating(false)} />
    </>
  )
}
