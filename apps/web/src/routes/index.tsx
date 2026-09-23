import { createFileRoute } from '@tanstack/react-router'
import { HomePage } from '../app/HomePage'
import { titleHead } from '../app/title'

export const Route = createFileRoute('/')({
  head: () => titleHead('home'),
  component: HomePage,
})
