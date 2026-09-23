import { createFileRoute } from '@tanstack/react-router'
import { SettingsPage } from '../app/SettingsPage'
import { titleHead } from '../app/title'

export const Route = createFileRoute('/settings')({
  head: () => titleHead('settings'),
  component: SettingsPage,
})
