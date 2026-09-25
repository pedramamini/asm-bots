import { createFileRoute } from '@tanstack/react-router'
import { PageHeading } from '../app/PageHeading'
import { SettingsPage } from '../app/SettingsPage'
import { titleHead } from '../app/title'

export const Route = createFileRoute('/settings')({
  head: () => titleHead('settings'),
  component: SettingsRoute,
})

function SettingsRoute() {
  return (
    <>
      <PageHeading>settings</PageHeading>
      <SettingsPage />
    </>
  )
}
