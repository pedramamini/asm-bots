import { EmptyState, Panel, PanelGrid } from '@asmbots/ui'
import { useRouter } from '@tanstack/react-router'
import type { ReactNode } from 'react'

export interface PlaceholderProps {
  /** The panel title, lowercase: `arena`. */
  title: string
  /** The panel status: what the route is showing, such as the id it was given. */
  status?: ReactNode
  /** The one sentence that says what will fill the page. */
  children: ReactNode
}

/** A route's content until its playbook fills it: one panel, one sentence, one way home. */
export function Placeholder({ title, status, children }: PlaceholderProps) {
  const router = useRouter()
  return (
    <PanelGrid className="p-3">
      <Panel className="col-span-12" title={title} status={status}>
        <EmptyState
          action={{
            label: 'go home',
            href: '/',
            onClick: (event) => {
              event.preventDefault()
              void router.navigate({ to: '/' })
            },
          }}
        >
          {children}
        </EmptyState>
      </Panel>
    </PanelGrid>
  )
}
