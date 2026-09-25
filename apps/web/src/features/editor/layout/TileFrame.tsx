import { cx, PanelHost, usePanelHost } from '@asmbots/ui'
import type { ReactNode } from 'react'

export interface TileFrameProps {
  /** The region's name. */
  label: string
  /** Left of the title row, in accent. */
  title: ReactNode
  /** Beside the title, muted. */
  status?: ReactNode
  /** Controls at the right end of the title row, before the layout's. */
  actions?: ReactNode
  children: ReactNode
  className?: string | undefined
}

/**
 * A panel whose body runs edge to edge (the source, the arena strip): a `Panel`'s surface and
 * title row, with no padding under it. In the workspace, the layout's controls end the title row.
 */
export function TileFrame({ label, title, status, actions, children, className }: TileFrameProps) {
  const { chrome } = usePanelHost()
  return (
    <section
      aria-label={label}
      className={cx(
        'flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-border bg-panel',
        className,
      )}
    >
      <header className="flex h-8 shrink-0 items-center gap-3 border-b border-border px-2">
        <h2 className="text-panel-title text-accent-fg">{title}</h2>
        {status !== undefined && <span className="text-panel-status text-muted">{status}</span>}
        <div className="ml-auto flex items-center gap-1">
          {actions}
          {chrome}
        </div>
      </header>
      {/* A panel inside (the new bot's templates) is not the layout's. */}
      <div className="relative min-h-0 flex-1">
        <PanelHost>{children}</PanelHost>
      </div>
    </section>
  )
}
