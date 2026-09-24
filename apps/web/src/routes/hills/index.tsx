import { createFileRoute } from '@tanstack/react-router'
import { titleHead } from '../../app/title'
import { HillsPage } from '../../features/hills/HillsPage'

export const Route = createFileRoute('/hills/')({
  head: () => titleHead('hills'),
  component: HillsPage,
})
