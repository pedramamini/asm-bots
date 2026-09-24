import { createFileRoute } from '@tanstack/react-router'
import { titleHead } from '../../app/title'
import { HillPage } from '../../features/hills/HillPage'

export const Route = createFileRoute('/hills/$slug')({
  head: ({ params }) => titleHead('hills', params.slug),
  component: HillsDetail,
})

function HillsDetail() {
  const { slug } = Route.useParams()
  return <HillPage slug={slug} />
}
