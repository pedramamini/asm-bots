import { createFileRoute } from '@tanstack/react-router'
import { titleHead } from '../../app/title'
import { HillPage } from '../../features/hills/HillPage'
import { validateHillSearch } from '../../features/hills/search'

export const Route = createFileRoute('/hills/$slug')({
  // `?submission=<id>`: the page follows that submission's job.
  validateSearch: validateHillSearch,
  head: ({ params }) => titleHead('hills', params.slug),
  component: HillsDetail,
})

function HillsDetail() {
  const { slug } = Route.useParams()
  const { submission } = Route.useSearch()
  return <HillPage slug={slug} submission={submission ?? null} />
}
