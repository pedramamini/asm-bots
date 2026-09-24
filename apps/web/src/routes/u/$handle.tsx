import { createFileRoute } from '@tanstack/react-router'
import { titleHead } from '../../app/title'
import { ProfilePage } from '../../features/profile/ProfilePage'

export const Route = createFileRoute('/u/$handle')({
  head: ({ params }) => titleHead('profile', params.handle),
  component: ProfileDetail,
})

function ProfileDetail() {
  const { handle } = Route.useParams()
  return <ProfilePage handle={handle} />
}
