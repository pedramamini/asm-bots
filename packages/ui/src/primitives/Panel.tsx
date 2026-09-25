import { type ComponentProps, type ReactNode, useId } from 'react'
import { hasContent } from '../node'
import { cx } from '../style'

export interface PanelProps extends Omit<ComponentProps<'section'>, 'title'> {
  /** Left of the title row, in accent: `TRAFFIC DISTRIBUTION`. It names the panel's region. */
  title?: ReactNode
  /** Right of the title row, muted: `LOADING`, `3 ACTIVE`. */
  status?: ReactNode
  /** Controls at the right end of the title row: a segmented control, a `refresh` button. */
  actions?: ReactNode
  /** Padding 8 instead of 12, for rails and nested panels. */
  dense?: boolean | undefined
}

/**
 * A titled surface (DESIGN_SYSTEM §4): `--panel` fill, 1 px `--border`, radius 4, padding 12. The
 * title row holds the title on the left and the status and actions on the right, over a hairline.
 * A panel with a title is a region, named by the title unless `aria-label` names it.
 */
export function Panel({
  title,
  status,
  actions,
  dense = false,
  className,
  children,
  ...rest
}: PanelProps) {
  const titleId = useId()
  const titled = hasContent(title)
  const right = hasContent(status) || hasContent(actions)
  return (
    <section
      aria-labelledby={titled && rest['aria-label'] === undefined ? titleId : undefined}
      {...rest}
      className={cx(
        'flex min-w-0 flex-col rounded-md border border-border bg-panel text-body text-text',
        dense ? 'p-2' : 'p-3',
        className,
      )}
    >
      {(titled || right) && (
        <header
          className={cx(
            'flex min-h-3.5 items-center gap-3 border-b border-border',
            dense ? 'mb-2 pb-1' : 'mb-3 pb-2',
          )}
        >
          {titled && (
            <h2 id={titleId} className="min-w-0 truncate text-panel-title text-accent-fg">
              {title}
            </h2>
          )}
          {right && (
            <div className="ml-auto flex shrink-0 items-center gap-3">
              {hasContent(status) && <span className="text-panel-status text-muted">{status}</span>}
              {/* Controls overhang the 14 px row, so a panel with actions keeps its hairline level
                  with the panels beside it. */}
              {hasContent(actions) && (
                <div className="-my-1.5 flex items-center gap-1">{actions}</div>
              )}
            </div>
          )}
        </header>
      )}
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  )
}
