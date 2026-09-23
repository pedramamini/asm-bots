import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '../../app/Placeholder'
import { titleHead } from '../../app/title'

export const Route = createFileRoute('/docs/')({
  head: () => titleHead('docs'),
  component: DocsPage,
})

function DocsPage() {
  return <Placeholder title="docs">the docs arrive with their sidebar and search.</Placeholder>
}
