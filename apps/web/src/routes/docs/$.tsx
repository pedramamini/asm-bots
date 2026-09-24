import { createFileRoute, notFound } from '@tanstack/react-router'
import { DocsArticle } from '../../app/DocsFrame'
import { titleHead } from '../../app/title'
import { findDoc } from '../../docs'
import { MDX_COMPONENTS } from '../../docs/components'

export const Route = createFileRoute('/docs/$')({
  // The page's MDX loads before the route shows, and on intent from a sidebar link.
  loader: async ({ params }) => {
    const page = findDoc(params._splat)
    if (page === undefined) throw notFound()
    const { default: Content } = await page.load()
    return { slug: page.slug, title: page.title, Content }
  },
  head: ({ params }) => titleHead('docs', findDoc(params._splat)?.title ?? params._splat),
  component: DocsPage,
})

function DocsPage() {
  const { slug, title, Content } = Route.useLoaderData()
  return (
    <DocsArticle title={title} slug={slug}>
      <Content components={MDX_COMPONENTS} />
    </DocsArticle>
  )
}
