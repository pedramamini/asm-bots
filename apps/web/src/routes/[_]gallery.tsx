import { createFileRoute, notFound } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'
import { titleHead } from '../app/title'

/**
 * The kit's gallery (`@asmbots/ui/gallery`), in development only: the production build replaces
 * `import.meta.env.DEV` with false, drops the import, and answers 404 here.
 */
const Gallery = import.meta.env.DEV
  ? lazy(() => import('@asmbots/ui/gallery').then(({ Gallery }) => ({ default: Gallery })))
  : null

export const Route = createFileRoute('/_gallery')({
  beforeLoad: () => {
    if (Gallery === null) throw notFound()
  },
  head: () => titleHead('gallery'),
  // The gallery lays out its own reference frames.
  staticData: { frame: false },
  component: GalleryPage,
})

function GalleryPage() {
  if (Gallery === null) return null
  return (
    <Suspense>
      <Gallery />
    </Suspense>
  )
}
