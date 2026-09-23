import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '../../app/Placeholder'
import { titleHead } from '../../app/title'

export const Route = createFileRoute('/hills/$slug')({
  head: ({ params }) => titleHead('hills', params.slug),
  component: HillsDetail,
})

function HillsDetail() {
  const { slug } = Route.useParams()
  return (
    <Placeholder title="hills" status={slug}>
      this hill's standings and submissions show here.
    </Placeholder>
  )
}
