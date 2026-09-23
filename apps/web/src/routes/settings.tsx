import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '../app/Placeholder'
import { titleHead } from '../app/title'

export const Route = createFileRoute('/settings')({
  head: () => titleHead('settings'),
  component: SettingsPage,
})

function SettingsPage() {
  return (
    <Placeholder title="settings">
      theme, effects, sound, keys, account, and data settings arrive next.
    </Placeholder>
  )
}
