import { createFileRoute } from '@tanstack/react-router'
import { DocsHome } from '../../app/DocsHome'

export const Route = createFileRoute('/docs/')({
  component: () => <DocsHome />,
})
