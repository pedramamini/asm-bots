import { createFileRoute, Link } from '@tanstack/react-router'
import { DocsArticle } from '../../app/DocsFrame'
import { PageHeading } from '../../app/PageHeading'
import { DOCS } from '../../docs'

export const Route = createFileRoute('/docs/')({
  component: DocsContents,
})

/** `/docs`: every page, by section, with its one sentence. */
function DocsContents() {
  return (
    <>
      {/* Before the panel's title, so the headings run h1, h2, h3. */}
      <PageHeading>docs</PageHeading>
      <DocsArticle title="contents">
        {DOCS.map(({ title, pages }) => (
          <section key={title} aria-label={title} className="mb-4">
            <h3 className="mb-2 text-panel-status text-muted">{title}</h3>
            <ul className="flex flex-col gap-1">
              {pages.map((page) => (
                <li key={page.slug} className="text-body">
                  <Link
                    to="/docs/$"
                    params={{ _splat: page.slug }}
                    className="text-accent-fg underline decoration-accent-45 underline-offset-2 hover:decoration-accent"
                  >
                    {page.title}
                  </Link>
                  <span className="text-muted"> · {page.blurb}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </DocsArticle>
    </>
  )
}
