import type { MouseEvent, ReactNode } from 'react'
import { Panel } from '../primitives/Panel'
import { cx } from '../style'

/*
 * The gallery's sheet parts. A state that needs the pointer or the focus (hover, a focus ring) is
 * marked `data-force="hover"` or `data-force="focus focus-visible"`, and `data-force-target` names
 * a descendant when the marked element is not the one to force. The Playwright spec
 * (apps/web/e2e/gallery.spec.ts) forces those pseudo-classes through the DevTools protocol before
 * each screenshot; in a live browser, point at the control or tab to it.
 */

export interface SpecimenProps {
  /** The component, as code names it: `IconButton`. It names the panel's region. */
  name: string
  status?: ReactNode
  className?: string | undefined
  children: ReactNode
}

/**
 * One primitive's sheet: a panel titled with the component's name, its states inside. It carries
 * `data-specimen`, so a test can tell the sheets from the panels they show.
 */
export function Specimen({ name, status, className, children }: SpecimenProps) {
  return (
    <Panel
      data-specimen={name}
      title={<span className="normal-case">{name}</span>}
      status={status}
      className={className}
    >
      {children}
    </Panel>
  )
}

/** A two-column list of states: the state's name, muted, then the primitive in that state. */
export function States({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cx(
        'grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5',
        className,
      )}
    >
      {children}
    </div>
  )
}

export interface StateProps {
  label: ReactNode
  /** Puts the label at the top of a tall row. */
  top?: boolean | undefined
  className?: string | undefined
  children: ReactNode
}

/** One row of `States`. */
export function State({ label, top = false, className, children }: StateProps) {
  return (
    <>
      <span className={cx('truncate text-panel-status text-muted', top && 'self-start pt-1')}>
        {label}
      </span>
      <div className={cx('flex min-w-0 flex-wrap items-center gap-2', className)}>{children}</div>
    </>
  )
}

/** A link's click in the gallery: it stays on the page. */
export function stay(event: MouseEvent): void {
  event.preventDefault()
}
