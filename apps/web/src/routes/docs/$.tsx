import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '../../app/Placeholder'
import { titleHead } from '../../app/title'

export const Route = createFileRoute('/docs/$')({
  head: ({ params }) => titleHead('docs', params._splat),
  component: DocsDetail,
})

function DocsDetail() {
  const { _splat } = Route.useParams()
  return (
    <Placeholder title="docs" status={_splat}>
      this page of the docs arrives with the rest.
    </Placeholder>
  )
}
