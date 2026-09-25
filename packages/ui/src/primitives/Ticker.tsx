import {
  type AnchorHTMLAttributes,
  type ComponentProps,
  Fragment,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { hasContent } from '../node'
import { cx, vars } from '../style'

/** Marquee speed, px per second: about 7 characters a second at 11 px. */
const SPEED = 50
/** The gap after each pass of the line, px: the `pr-12` on each copy. */
const GAP = 48

export interface TickerLink extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'children'> {
  href: string
  /** The link's accessible name, as it shows only `→`: "open the main hill". */
  label: string
}

export interface TickerProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** The line, item by item, with a `·` between two items. `<b>` sets a lead item in bold. */
  items: readonly ReactNode[]
  /** The `→` after the line. It stays in view while the line scrolls. */
  link?: TickerLink | undefined
}

/**
 * The one-line news bar over the header (DESIGN_SYSTEM §4): 24 px, `--panel`, hairline bottom,
 * the line centered. A line wider than the bar scrolls as a marquee that pauses under the pointer
 * or keyboard focus; with reduced motion it stays still and ends in an ellipsis. It is a
 * `marquee` region with `aria-live="off"`: assistive tech reads it on request, not on each change.
 */
export function Ticker({ items, link, className, style, ...rest }: TickerProps) {
  const reducedMotion = useReducedMotion()
  const viewport = useRef<HTMLDivElement>(null)
  const line = useRef<HTMLSpanElement>(null)
  /** The line's width, px, while it is wider than the bar; 0 while it fits. */
  const [overflow, setOverflow] = useState(0)

  useLayoutEffect(() => {
    const view = viewport.current
    const text = line.current
    if (view === null || text === null) return
    // scrollWidth is the line's full width even while it is cut off. A pixel of slack absorbs
    // the rounding of the two widths.
    const measure = () =>
      setOverflow(text.scrollWidth > view.clientWidth + 1 ? text.scrollWidth : 0)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(view)
    observer.observe(text)
    return () => observer.disconnect()
  }, [])

  const marquee = overflow > 0 && !reducedMotion
  const content = joined(items)
  return (
    <div
      role="marquee"
      aria-live="off"
      {...rest}
      className={cx(
        'group/ticker relative z-ticker flex h-6 items-center justify-center gap-2 border-b border-border bg-panel px-3 text-ticker text-text',
        className,
      )}
      style={
        marquee
          ? { ...style, ...vars({ '--marquee-duration': `${(overflow + GAP) / SPEED}s` }) }
          : style
      }
    >
      <div ref={viewport} className={cx('min-w-0 overflow-hidden', marquee && 'flex-1')}>
        {/* Marquee: two copies of the line, each with its gap, so -50% is one seamless pass. */}
        <div
          className={cx(
            'flex',
            marquee &&
              'w-max animate-marquee group-focus-within/ticker:[animation-play-state:paused] group-hover/ticker:[animation-play-state:paused]',
          )}
        >
          <span className={marquee ? 'shrink-0 pr-12' : 'min-w-0'}>
            <span ref={line} className="block truncate">
              {content}
            </span>
          </span>
          {marquee && (
            <span aria-hidden="true" inert className="shrink-0 pr-12">
              <span className="block truncate">{content}</span>
            </span>
          )}
        </div>
      </div>
      {link && <Arrow {...link} />}
    </div>
  )
}

function Arrow({ href, label, className, ...rest }: TickerLink) {
  return (
    <a
      href={href}
      aria-label={label}
      {...rest}
      className={cx(
        'shrink-0 text-text transition-colors duration-120 ease-out hover:text-accent-fg focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent',
        className,
      )}
    >
      →
    </a>
  )
}

/** The items with a `·` between each two. The dot is hidden from assistive tech; the spaces are not. */
function joined(items: readonly ReactNode[]): ReactNode {
  return items.filter(hasContent).map((item, index) => (
    // An item has no identity but its place in the line, and the line redraws whole.
    <Fragment key={index}>
      {index > 0 && (
        <>
          {' '}
          <span aria-hidden="true">·</span>{' '}
        </>
      )}
      {item}
    </Fragment>
  ))
}
