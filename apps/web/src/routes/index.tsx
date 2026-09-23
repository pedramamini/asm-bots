import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '../app/Placeholder'
import { titleHead } from '../app/title'

export const Route = createFileRoute('/')({
  head: () => titleHead('home'),
  component: HomePage,
})

function HomePage() {
  return (
    <Placeholder title="home">
      the live demo battle and the hill, match, and championship panels arrive next.
    </Placeholder>
  )
}
