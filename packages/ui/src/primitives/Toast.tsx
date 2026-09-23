import { X } from 'lucide-react'
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { cx } from '../style'
import { Button } from './Button'
import type { ChipVariant } from './Chip'
import { IconButton } from './IconButton'

/** How long a toast stays, ms (DESIGN_SYSTEM §4: 5 s). */
export const TOAST_DURATION = 5000
/** The most toasts shown at once; a new one pushes out the oldest. */
const MAX_TOASTS = 5

/** A toast's meaning, as the color of its stripe: the chip variants. */
export type ToastVariant = ChipVariant

const STRIPE: Readonly<Record<ToastVariant, string>> = {
  neutral: 'border-l-border-strong',
  accent: 'border-l-accent',
  warn: 'border-l-warn',
  danger: 'border-l-danger',
  info: 'border-l-info',
}

export interface ToastAction {
  /** Lowercase: `undo`, `open`. */
  label: string
  /** What it does; the toast closes after. */
  onClick: () => void
}

export interface ToastProps extends ComponentProps<'div'> {
  variant?: ToastVariant | undefined
  /** One button beside the message. */
  action?: ToastAction | undefined
  /** Draws the close button. */
  onDismiss?: (() => void) | undefined
}

/**
 * One notice (DESIGN_SYSTEM §4): the message on `--panel` with a `--border-strong` hairline and
 * a 2 px stripe down the left in the variant's color, an optional action, and a close button.
 * `useToast()` shows them; this draws one.
 */
export function Toast({
  variant = 'neutral',
  action,
  onDismiss,
  className,
  children,
  ...rest
}: ToastProps) {
  return (
    <div
      {...rest}
      className={cx(
        'flex w-80 max-w-full items-center gap-2 rounded-md border border-l-2 border-border-strong bg-panel py-1.5 pr-1.5 pl-3 text-body text-text',
        STRIPE[variant],
        className,
      )}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {action && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            action.onClick()
            onDismiss?.()
          }}
        >
          {action.label}
        </Button>
      )}
      {onDismiss && <IconButton icon={X} label="dismiss" size="sm" onClick={onDismiss} />}
    </div>
  )
}

export interface ToastOptions {
  variant?: ToastVariant | undefined
  /** ms; `Infinity` keeps it until it is dismissed. */
  duration?: number | undefined
  action?: ToastAction | undefined
}

export interface ToastApi {
  /** Shows `message` and returns its id. */
  toast: (message: ReactNode, options?: ToastOptions) => number
  /** Closes the toast with `id`, if it still shows. */
  dismiss: (id: number) => void
}

const ToastContext = createContext<ToastApi | null>(null)

/** The toast functions of the nearest `ToastProvider`. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext)
  if (api === null) throw new Error('useToast needs a <ToastProvider> above it')
  return api
}

interface Shown extends ToastOptions {
  id: number
  message: ReactNode
}

export interface ToastProviderProps {
  children?: ReactNode
  /** How long a toast stays unless its options say otherwise, ms. */
  duration?: number | undefined
}

/**
 * Holds the toasts of everything under it and draws them in a stack at the bottom right, above the
 * status bar, newest at the bottom. Each closes after its duration; the pointer on the stack, or
 * the focus in it, stops the clocks until it leaves. The stack is a polite live region, so
 * assistive tech reads each toast as it arrives. Put one at the root of the app.
 */
export function ToastProvider({ children, duration = TOAST_DURATION }: ToastProviderProps) {
  const [shown, setShown] = useState<readonly Shown[]>([])
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const next = useRef(1)

  const dismiss = useCallback((id: number) => {
    setShown((list) => list.filter((toast) => toast.id !== id))
  }, [])
  const toast = useCallback((message: ReactNode, options: ToastOptions = {}) => {
    const id = next.current++
    setShown((list) => [...list, { ...options, id, message }].slice(-MAX_TOASTS))
    return id
  }, [])
  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <section
        aria-label="notifications"
        aria-live="polite"
        aria-relevant="additions"
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false)
        }}
        className="pointer-events-none fixed right-3 bottom-8 z-toast"
      >
        <ol className="flex flex-col items-end gap-2">
          {shown.map((item) => (
            <li key={item.id} className="pointer-events-auto max-w-[calc(100vw-24px)]">
              <Timer
                ms={item.duration ?? duration}
                paused={hovered || focused}
                onDone={() => dismiss(item.id)}
              />
              <Toast
                variant={item.variant}
                action={item.action}
                onDismiss={() => dismiss(item.id)}
                className="transition-[opacity,translate] duration-120 ease-out starting:translate-y-1 starting:opacity-0 motion-reduce:transition-none"
              >
                {item.message}
              </Toast>
            </li>
          ))}
        </ol>
      </section>
    </ToastContext.Provider>
  )
}

interface TimerProps {
  ms: number
  paused: boolean
  onDone: () => void
}

/**
 * Calls `onDone` after `ms` of running time: a pause stops the clock, and it runs on after. A new
 * `onDone` restarts the wait with the time that is left.
 */
function Timer({ ms, paused, onDone }: TimerProps) {
  const left = useRef(ms)
  useEffect(() => {
    if (paused || !Number.isFinite(left.current)) return
    const started = Date.now()
    const timer = setTimeout(onDone, Math.max(0, left.current))
    return () => {
      clearTimeout(timer)
      left.current -= Date.now() - started
    }
  }, [paused, onDone])
  return null
}
