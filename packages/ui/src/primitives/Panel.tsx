import { type ComponentProps, createContext, type ReactNode, useContext, useId } from 'react'
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

/** What a layout that holds panels gives each one (`PanelHost`). */
export interface PanelHostValue {
  /** Controls after the panel's own at the end of its title row: the layout's grip and menu. */
  chrome?: ReactNode
  /** The panel fills the host's box, and its content scrolls inside it. */
  fill?: boolean | undefined
}

const NO_HOST: PanelHostValue = {}
const PanelHostContext = createContext<PanelHostValue>(NO_HOST)

/**
 * A layout's hold on the panel inside it: the controls the layout adds to its title row, and
 * whether it fills the box. Only the outermost panel sees it; a panel inside a panel does not.
 */
export function PanelHost({ children, ...value }: PanelHostValue & { children: ReactNode }) {
  return <PanelHostContext value={value}>{children}</PanelHostContext>
}

/** The host of the panel being drawn: for a panel-like surface that draws its own title row. */
export function usePanelHost(): PanelHostValue {
  return useContext(PanelHostContext)
}

/**
 * A titled surface (DESIGN_SYSTEM §4): `--panel` fill, 1 px `--border`, radius 4, padding 12. The
 * title row holds the title on the left and the status and actions on the right, over a hairline.
 * A panel with a title is a region, named by the title unless `aria-label` names it. In a
 * `PanelHost`, the host's controls end the title row.
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
  const { chrome, fill = false } = usePanelHost()
  const titled = hasContent(title)
  const right = hasContent(status) || hasContent(actions) || hasContent(chrome)
  return (
    <section
      aria-labelledby={titled && rest['aria-label'] === undefined ? titleId : undefined}
      {...rest}
      className={cx(
        'flex min-w-0 flex-col rounded-md border border-border bg-panel text-body text-text',
        dense ? 'p-2' : 'p-3',
        fill && 'h-full min-h-0 overflow-hidden',
        className,
      )}
    >
      {(titled || right) && (
        <header
          className={cx(
            'flex min-h-3.5 items-center gap-3 border-b border-border',
            dense ? 'mb-2 pb-1' : 'mb-3 pb-2',
            fill && 'shrink-0',
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
              {(hasContent(actions) || hasContent(chrome)) && (
                <div className="-my-1.5 flex items-center gap-1">
                  {actions}
                  {chrome}
                </div>
              )}
            </div>
          )}
        </header>
      )}
      {/* Filling, the body scrolls over the padding too: the rows reach the edges as before, and a
          focus ring at an edge is not cut off. */}
      <div
        className={cx(
          'min-h-0 flex-1',
          fill && 'overflow-auto',
          fill && (dense ? '-mx-2 -mt-1 -mb-2 px-2 pt-1 pb-2' : '-mx-3 -mt-1 -mb-3 px-3 pt-1 pb-3'),
        )}
      >
        <PanelHostContext value={NO_HOST}>{children}</PanelHostContext>
      </div>
    </section>
  )
}
