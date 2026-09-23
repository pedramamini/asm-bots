import { X } from 'lucide-react'
import {
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { tabbables } from '../focus'
import { hasContent } from '../node'
import { mergeRefs } from '../refs'
import { cx } from '../style'
import { IconButton } from './IconButton'

/** The panel's widest, by size: 360, 480, and 640 px. */
const WIDTH = { sm: 'max-w-90', md: 'max-w-120', lg: 'max-w-160' } as const

export interface ModalProps
  extends Omit<ComponentProps<'dialog'>, 'open' | 'title' | 'onClose' | 'onCancel'> {
  /** Shows the modal. It mounts its content when it opens and drops it when it closes. */
  open: boolean
  /** Escape, a press on the overlay, and the close button ask for this: set `open` false. */
  onClose: () => void
  /** The title, in the modal title type: `submit to hill`. It names the dialog. */
  title: ReactNode
  /** The buttons at the foot, right-aligned: `cancel`, then the primary action. */
  actions?: ReactNode
  /** The panel's widest: `sm` 360, `md` 480, `lg` 640 px. */
  size?: 'sm' | 'md' | 'lg' | undefined
}

/**
 * A modal dialog (DESIGN_SYSTEM §4): a `--panel` box with a `--border-strong` hairline and radius
 * 6, centered over a `rgba(0,0,0,0.7)` overlay, in the browser's top layer (`showModal()`), which
 * makes the page behind it inert. Escape, a press on the overlay, and the close button call
 * `onClose`. Tab and Shift+Tab cycle through the dialog's controls and never leave it. It opens
 * on the control the content marks `autoFocus`, else on its first control, else on the close
 * button, and gives the focus back to what had it when it closes. `className` goes on the panel;
 * every other prop, the ref included, goes to the `<dialog>`.
 */
export function Modal({ open, ...props }: ModalProps) {
  return open ? <OpenModal {...props} /> : null
}

function OpenModal({
  onClose,
  title,
  actions,
  size = 'md',
  className,
  children,
  onKeyDown,
  onPointerDown,
  onClick,
  ref,
  ...rest
}: Omit<ModalProps, 'open'>) {
  const titleId = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  // The caller's ref and the modal's own: the open and close steps need the element too.
  const dialogRef = useMemo(() => mergeRefs(dialog, ref), [ref])
  const content = useRef<HTMLDivElement>(null)
  const closer = useRef<HTMLButtonElement>(null)
  /** Whether the press that ends in a click began on the overlay (not a drag out of the panel). */
  const pressedOverlay = useRef(false)
  // Read while rendering, before React commits the content and its autoFocus takes the focus.
  const [opener] = useState(() =>
    typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null),
  )

  useLayoutEffect(() => {
    const node = dialog.current
    if (node === null) return
    // React has focused an `autoFocus` control by now; showModal() would move the focus again.
    const chosen = node.contains(document.activeElement) ? document.activeElement : null
    if (typeof node.showModal === 'function') node.showModal()
    else node.setAttribute('open', '')
    const target =
      (chosen as HTMLElement | null) ??
      (content.current && tabbables(content.current)[0]) ??
      closer.current
    target?.focus()
    return () => {
      if (node.open && typeof node.close === 'function') node.close()
      if (opener?.isConnected) opener.focus()
    }
  }, [opener])

  const onDialogKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    onKeyDown?.(event)
    if (event.defaultPrevented) return
    if (event.key === 'Escape') {
      // Handled here, so the browser raises no `cancel` as well.
      event.preventDefault()
      event.stopPropagation()
      onClose()
    } else if (event.key === 'Tab') {
      trapTab(event)
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-modal="true"
      aria-labelledby={titleId}
      {...rest}
      onKeyDown={onDialogKeyDown}
      onCancel={(event) => {
        // A close request other than Escape: the caller closes it, so the state stays theirs.
        event.preventDefault()
        onClose()
      }}
      onPointerDown={(event) => {
        onPointerDown?.(event)
        pressedOverlay.current = event.target === event.currentTarget
      }}
      onClick={(event) => {
        onClick?.(event)
        const overlay = pressedOverlay.current && event.target === event.currentTarget
        pressedOverlay.current = false
        if (overlay && !event.defaultPrevented) onClose()
      }}
      className="fixed inset-0 z-modal m-0 size-full max-h-none max-w-none overflow-auto overscroll-contain border-0 bg-[rgba(0,0,0,0.7)] p-3 text-body text-text transition-opacity duration-120 ease-out backdrop:bg-transparent open:flex starting:open:opacity-0 motion-reduce:transition-none"
    >
      <div
        className={cx(
          'm-auto flex max-h-full min-h-0 w-full flex-col rounded-lg border border-border-strong bg-panel p-4',
          WIDTH[size],
          className,
        )}
      >
        <header className="mb-3 flex shrink-0 items-center gap-3 border-b border-border pb-3">
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-modal-title text-bright">
            {title}
          </h2>
          <IconButton
            ref={closer}
            icon={X}
            label="close"
            shortcut="esc"
            size="sm"
            onClick={onClose}
          />
        </header>
        <div ref={content} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-auto">{children}</div>
          {hasContent(actions) && (
            <footer className="mt-4 flex shrink-0 items-center justify-end gap-2 border-t border-border pt-3">
              {actions}
            </footer>
          )}
        </div>
      </div>
    </dialog>
  )
}

/** Keeps Tab and Shift+Tab inside the dialog: past the last control is the first, and back. */
function trapTab(event: KeyboardEvent<HTMLDialogElement>): void {
  const stops = tabbables(event.currentTarget)
  const at = stops.indexOf(document.activeElement as HTMLElement)
  const last = stops.length - 1
  // Off the ends, or from no stop at all (the focus on the panel): wrap. Else the browser moves on.
  const wrap = event.shiftKey ? at <= 0 && stops[last] : (at < 0 || at === last) && stops[0]
  if (stops.length > 0 && !wrap) return
  event.preventDefault()
  if (wrap) wrap.focus()
}
