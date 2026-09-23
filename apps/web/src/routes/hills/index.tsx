import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '../../app/Placeholder'
import { titleHead } from '../../app/title'

export const Route = createFileRoute('/hills/')({
  head: () => titleHead('hills'),
  component: HillsPage,
})

function HillsPage() {
  return <Placeholder title="hills">the hills and their kings list here.</Placeholder>
}
