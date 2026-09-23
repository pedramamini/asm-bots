import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '../../app/Placeholder'
import { titleHead } from '../../app/title'

export const Route = createFileRoute('/u/$handle')({
  head: ({ params }) => titleHead('profile', params.handle),
  component: ProfileDetail,
})

function ProfileDetail() {
  const { handle } = Route.useParams()
  return (
    <Placeholder title="profile" status={handle}>
      this profile shows here.
    </Placeholder>
  )
}
