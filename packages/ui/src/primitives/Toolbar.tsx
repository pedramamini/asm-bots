import type { ComponentProps, KeyboardEvent } from 'react'
import { cx } from '../style'

export type ToolbarProps = ComponentProps<'div'>

/** Controls whose arrow keys move a caret or a value: the toolbar leaves those keys alone. */
const OWN_ARROWS =
  'input:not([type=button],[type=checkbox],[type=radio],[type=reset],[type=submit]),select,textarea,[contenteditable]:not([contenteditable=false])'
/** The controls the arrow keys move between. */
const CONTROLS =
  'a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])'

/**
 * The route's filter row under the header (DESIGN_SYSTEM §4): 36 px, hairline bottom, controls
 * left to right with 8 px between. Left and Right move focus between the controls and wrap, Home
 * and End go to the first and last; a text field, a select, or a control that handles an arrow key
 * itself (and prevents its default) keeps it. Every control stays in the Tab order.
 */
export function Toolbar({ className, onKeyDown, ...rest }: ToolbarProps) {
  return (
    <div
      role="toolbar"
      aria-orientation="horizontal"
      {...rest}
      className={cx(
        'flex h-9 items-center gap-2 border-b border-border bg-bg px-3 text-body text-text',
        className,
      )}
      onKeyDown={(event) => {
        onKeyDown?.(event)
        if (!event.defaultPrevented) moveFocus(event)
      }}
    />
  )
}

function moveFocus(event: KeyboardEvent<HTMLDivElement>): void {
  const target = event.target as HTMLElement
  if (event.altKey || event.ctrlKey || event.metaKey || target.matches(OWN_ARROWS)) return
  const controls = [...event.currentTarget.querySelectorAll<HTMLElement>(CONTROLS)]
  const from = controls.indexOf(target)
  if (from < 0) return
  const moves: Readonly<Record<string, number>> = {
    ArrowLeft: from - 1,
    ArrowRight: from + 1,
    Home: 0,
    End: controls.length - 1,
  }
  const to = moves[event.key]
  if (to === undefined) return
  event.preventDefault()
  controls[(to + controls.length) % controls.length]?.focus()
}
