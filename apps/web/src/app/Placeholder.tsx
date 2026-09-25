import { EmptyState, Panel, PanelGrid } from '@asmbots/ui'
import type { ReactNode } from 'react'
import { useLinkAction } from './link-action'

/** Where a placeholder's one action goes, and what it says: `open the arena`. */
export interface PlaceholderAction {
  readonly label: string
  /** An app path. */
  readonly to: string
}

export interface PlaceholderProps {
  /** The panel title, lowercase: `arena`. */
  title: string
  /** The panel status: what the route is showing, such as the id it was given. */
  status?: ReactNode
  /** The one sentence that says what will fill the page. */
  children: ReactNode
  /** The one way on: `go home` unless given. */
  action?: PlaceholderAction | undefined
  /** False inside a page that already pads its content (the docs frame). */
  padded?: boolean | undefined
}

const GO_HOME: PlaceholderAction = { label: 'go home', to: '/' }

/**
 * A route's content until its playbook fills it, or a page with nothing to show: one panel, one
 * sentence, one way on through the router.
 */
export function Placeholder({
  title,
  status,
  children,
  action = GO_HOME,
  padded = true,
}: PlaceholderProps) {
  const link = useLinkAction()
  return (
    <PanelGrid className={padded ? 'p-3' : undefined}>
      <Panel className="col-span-12" title={title} status={status}>
        <EmptyState action={link(action.label, action.to)}>{children}</EmptyState>
      </Panel>
    </PanelGrid>
  )
}
