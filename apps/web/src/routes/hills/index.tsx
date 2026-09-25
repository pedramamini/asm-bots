import { createFileRoute } from '@tanstack/react-router'
import { PageHeading } from '../../app/PageHeading'
import { titleHead } from '../../app/title'
import { HillsPage } from '../../features/hills/HillsPage'

export const Route = createFileRoute('/hills/')({
  head: () => titleHead('hills'),
  component: HillsRoute,
})

function HillsRoute() {
  return (
    <>
      <PageHeading>hills</PageHeading>
      <HillsPage />
    </>
  )
}
