/**
 * The welcome tour (PRODUCT_SPEC §9): the boot screen's `take tour`, or the home page's `take the
 * tour`. It walks the whole site (`tour-steps.tsx`). Each step goes to its page, dims all of it,
 * cuts a hole around one part, and puts a card beside the hole that says what the part is for; the
 * hole slides from one part to the next. The header's nav stays out of the dim the whole way, its
 * current page ringed, so the user always sees where the tour stands. Enter or `next` goes on, the arrows and `back` walk the
 * steps, Escape and `skip the tour` leave. The last step leaves the whole page in view, or starts
 * the arena's guided first battle.
 */
import { Button, cx } from '@asmbots/ui'
import { useRouter } from '@tanstack/react-router'
import { ArrowLeft, ArrowRight, CirclePlay } from 'lucide-react'
import {
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { ARENA_TOUR, useMotionReduced, useSettings } from '../../store/settings'
import { NAV } from '../Frame'
import { useBoot } from './boot'
import {
  type Box,
  holeFor,
  inView,
  middleOf,
  mixBox,
  placeCard,
  type Size,
  sameBox,
} from './spotlight'
import { TOUR_STEPS, type TourStep } from './tour-steps'

/** How long a step looks for its target before its card goes to the middle, ms. */
const FIND_MS = 4000

/** How often a step presses its `open` button while its target is missing, ms. */
const OPEN_EVERY_MS = 300

/** How long the hole slides from one part to the next, ms; after that it follows its part. */
const SLIDE_MS = 300

/** The dim over everything but the holes. */
const DIM = 'rgb(0 0 0 / 0.72)'

/** The header's nav: never dimmed while the tour runs. */
const NAV_SELECTOR = 'header nav[aria-label="primary"]'

/** Room between a nav link and its ring, px. */
const CURRENT_PAD = 3

/** Where a step stands: which step, its hole (none: the middle), and whether it has looked. */
interface Spot {
  readonly id: string
  readonly hole: Box | null
}

const viewSize = (): Size => ({ width: window.innerWidth, height: window.innerHeight })

/**
 * The hole for `step`, every frame: it goes to the step's page, finds the target (pressing the
 * step's `open` button while it is missing), scrolls it into view, and follows it as it moves.
 * A target that does not show within `FIND_MS`, or has no size, gets no hole. Null until the step
 * has looked, so its card waits out of sight.
 */
function useSpot(step: TourStep, reduced: boolean): Spot | null {
  const router = useRouter()
  const [spot, setSpot] = useState<Spot | null>(null)
  useEffect(() => {
    const show = (hole: Box | null) =>
      setSpot((was) =>
        was?.id === step.id && sameBox(was.hole, hole) ? was : { id: step.id, hole },
      )
    if (router.state.location.pathname !== step.path) {
      const { path: to, search } = step
      void router.navigate(search === undefined ? { to } : { to, search })
    }
    const { target: selector } = step
    if (selector === null) {
      show(null)
      return
    }
    const started = performance.now()
    let pressed = Number.NEGATIVE_INFINITY
    let target: Element | null = null
    let frame = 0
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick)
      const view = viewSize()
      const here = router.state.location.pathname === step.path
      if (target === null || !target.isConnected) {
        target = here ? document.querySelector(selector) : null
        if (target === null) {
          const open =
            step.open === undefined ? null : document.querySelector<HTMLElement>(step.open)
          if (here && open !== null && now - pressed > OPEN_EVERY_MS) {
            open.click()
            pressed = now
          }
          if (now - started > FIND_MS) {
            cancelAnimationFrame(frame)
            show(null)
          }
          return
        }
        const rect = target.getBoundingClientRect()
        if (rect.width > 0 && !inView(rect, view)) {
          target.scrollIntoView({
            block: rect.height > view.height ? 'start' : 'center',
            inline: 'nearest',
            behavior: reduced ? 'instant' : 'smooth',
          })
        }
      }
      show(holeFor(target.getBoundingClientRect(), view))
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [step, router, reduced])
  return spot?.id === step.id ? spot : null
}

/** The box of `node`, with `pad` px around it; null with no node, or none of it shown. */
function boxOf(node: Element | null | undefined, pad: number): Box | null {
  const rect = node?.getBoundingClientRect()
  if (rect === undefined || rect.width <= 0) return null
  return {
    x: rect.x - pad,
    y: rect.y - pad,
    width: rect.width + 2 * pad,
    height: rect.height + 2 * pad,
  }
}

/** The header's nav, and its link to the page the tour stands on. */
interface NavBoxes {
  readonly nav: Box | null
  readonly current: Box | null
}

/**
 * The nav's box and its current link's, read in one loop a frame (a new state only when one
 * moves): they follow the page as it lays out, and the current link as the tour goes on.
 */
function useNavBoxes(): NavBoxes {
  const [boxes, setBoxes] = useState<NavBoxes>({ nav: null, current: null })
  useEffect(() => {
    let frame = 0
    const tick = () => {
      frame = requestAnimationFrame(tick)
      const node = document.querySelector(NAV_SELECTOR)
      const nav = boxOf(node, 0)
      const current = boxOf(node?.querySelector('[aria-current="page"]'), CURRENT_PAD)
      setBoxes((was) =>
        sameBox(was.nav, nav) && sameBox(was.current, current) ? was : { nav, current },
      )
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])
  return boxes
}

/**
 * `to`, eased in from where it was over `SLIDE_MS` while `slide` holds; else `to` at once, so a
 * hole that has found its part follows it with no lag.
 */
function useEased(to: Box, slide: boolean): Box {
  const [box, setBox] = useState(to)
  const at = useRef(to)
  useEffect(() => {
    if (!slide) {
      at.current = to
      setBox(to)
      return
    }
    const from = at.current
    const start = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / SLIDE_MS)
      at.current = mixBox(from, to, 1 - (1 - t) ** 3)
      setBox(at.current)
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [to, slide])
  return box
}

/**
 * Whether the hole is sliding to a step's part: while the step looks for it, and for `SLIDE_MS`
 * after it finds it. Then the hole follows the part as it scrolls or resizes, with no lag.
 */
function useSliding(id: string | null): boolean {
  const [settled, setSettled] = useState<string | null>(null)
  useEffect(() => {
    if (id === null) return
    const timer = setTimeout(() => setSettled(id), SLIDE_MS)
    return () => clearTimeout(timer)
  }, [id])
  return id !== settled
}

/** The size of the window, kept as it resizes. */
function useViewSize(): Size {
  const [view, setView] = useState(viewSize)
  useEffect(() => {
    const onResize = () => setView(viewSize())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return view
}

/** The size of the card at `ref`, kept as its step's words change it. */
function useCardSize(ref: RefObject<HTMLElement | null>): Size {
  const [size, setSize] = useState<Size>({ width: 360, height: 200 })
  useLayoutEffect(() => {
    const node = ref.current
    if (node === null) return
    const measure = () =>
      setSize((was) =>
        was.width === node.offsetWidth && was.height === node.offsetHeight
          ? was
          : { width: node.offsetWidth, height: node.offsetHeight },
      )
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [ref])
  return size
}

/** The tour: a modal layer over the page, the dim with its hole, and the step's card. */
export function WelcomeTour() {
  const dialog = useRef<HTMLDialogElement>(null)
  const card = useRef<HTMLElement>(null)
  const next = useRef<HTMLButtonElement>(null)
  const [index, setIndex] = useState(0)
  const close = useBoot((state) => state.closeTour)
  const markCoachSeen = useSettings((state) => state.markCoachSeen)
  const router = useRouter()
  const reduced = useMotionReduced()
  const last = TOUR_STEPS.length - 1
  const step = TOUR_STEPS[index] ?? (TOUR_STEPS[0] as TourStep)
  const spot = useSpot(step, reduced)
  const view = useViewSize()
  const size = useCardSize(card)
  // While a step looks for its part, the hole stays on the last one, so it slides from there.
  const held = useRef<Box | null>(null)
  if (spot !== null) held.current = spot.hole
  const hole = held.current
  const place = placeCard(hole, size, view)
  const sliding = useSliding(spot?.id ?? null)
  const middle = useMemo(() => middleOf(view), [view])
  const shown = useEased(hole ?? middle, sliding && !reduced)
  const { nav, current } = useNavBoxes()
  const mask = useId()
  const page = NAV.find(({ to }) => to === step.path)

  useLayoutEffect(() => {
    const node = dialog.current
    if (node === null) return
    if (typeof node.showModal === 'function') node.showModal()
    else node.setAttribute('open', '')
    return () => {
      if (node.open && typeof node.close === 'function') node.close()
    }
  }, [])

  // Each step's `next` (or the last step's `watch the first battle`) takes the focus: Enter goes on.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new step moves the focus.
  useEffect(() => {
    next.current?.focus()
  }, [index])

  /** Walks `by` steps, back or on, and stops at either end. */
  const walk = (by: number) => setIndex((at) => Math.min(last, Math.max(0, at + by)))
  /** Done: the whole tour seen, so the arena's own first-visit marks have nothing left to say. */
  const finish = () => {
    markCoachSeen(ARENA_TOUR)
    close()
  }
  const battle = () => {
    finish()
    void router.navigate({ to: '/arena', search: { intro: true } })
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === 'Escape') close()
    else if (event.key === 'ArrowRight') walk(1)
    else if (event.key === 'ArrowLeft') walk(-1)
    // Enter on a button presses it; anywhere else in the tour it goes on.
    else if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) walk(1)
    else return
    event.preventDefault()
  }

  return (
    <dialog
      ref={dialog}
      aria-label="the tour"
      aria-modal="true"
      aria-describedby="tour-body"
      data-tour-step={step.id}
      data-tour-target={step.target ?? undefined}
      onCancel={(event) => {
        event.preventDefault()
        close()
      }}
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-modal m-0 size-full max-h-none max-w-none overflow-hidden border-0 bg-transparent p-0 text-body text-text backdrop:bg-transparent"
    >
      {/* The dim, with two holes: the step's part, which slides from one part to the next (with
          no part it closes to a point in the middle), and the header's nav, which never dims. The
          step's part gets the accent ring; the nav's current page, a ring of its own. */}
      <svg aria-hidden="true" className="pointer-events-none fixed inset-0 size-full">
        <defs>
          <mask id={mask}>
            <rect width="100%" height="100%" fill="white" />
            {nav !== null && (
              <rect x={nav.x} y={nav.y} width={nav.width} height={nav.height} rx={6} />
            )}
            <rect x={shown.x} y={shown.y} width={shown.width} height={shown.height} rx={6} />
          </mask>
        </defs>
        <rect width="100%" height="100%" fill={DIM} mask={`url(#${mask})`} />
        {hole !== null && (
          <rect
            data-tour-hole=""
            data-to={`${hole.x} ${hole.y} ${hole.width} ${hole.height}`}
            x={shown.x}
            y={shown.y}
            width={shown.width}
            height={shown.height}
            rx={6}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={2}
          />
        )}
        {current !== null && (
          <rect
            data-tour-page=""
            x={current.x}
            y={current.y}
            width={current.width}
            height={current.height}
            rx={4}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={2}
          />
        )}
      </svg>
      <section
        ref={card}
        aria-labelledby="tour-title"
        className={cx(
          'fixed flex w-90 max-w-[calc(100vw-16px)] flex-col gap-3 rounded-lg border border-accent bg-panel p-4 shadow-[0_8px_32px_rgb(0_0_0/0.5)]',
          !reduced && 'transition-opacity duration-200 ease-out',
          spot === null ? 'opacity-0' : 'opacity-100',
        )}
        style={{ left: place.x, top: place.y }}
      >
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline gap-3">
            <p id="tour-title" aria-live="polite" className="text-panel-title text-accent-fg">
              {index + 1} / {TOUR_STEPS.length} · {step.title}
            </p>
            {page !== undefined && (
              <p
                data-tour-page-label=""
                className="ml-auto flex shrink-0 items-center gap-1 text-panel-status text-muted"
              >
                <page.icon
                  aria-hidden="true"
                  size={12}
                  strokeWidth={1.75}
                  className="text-accent"
                />
                <span className="sr-only">on the page: </span>
                {page.label}
              </p>
            )}
          </div>
          <div aria-hidden="true" className="h-0.5 overflow-hidden rounded-full bg-border-strong">
            <div
              className={cx('h-full bg-accent', !reduced && 'transition-[width] duration-300')}
              style={{ width: `${((index + 1) / TOUR_STEPS.length) * 100}%` }}
            />
          </div>
        </div>
        <div id="tour-body" className="flex flex-col gap-2 text-body">
          {step.body}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {index < last && (
            <Button variant="ghost" className="mr-auto" onClick={close}>
              skip the tour
            </Button>
          )}
          {index < last ? (
            <>
              <Button icon={ArrowLeft} disabled={index === 0} onClick={() => walk(-1)}>
                back
              </Button>
              <Button ref={next} variant="primary" icon={ArrowRight} onClick={() => walk(1)}>
                next
              </Button>
            </>
          ) : (
            <>
              <Button onClick={finish}>look around</Button>
              <Button ref={next} variant="primary" icon={CirclePlay} onClick={battle}>
                watch the first battle
              </Button>
            </>
          )}
        </div>
      </section>
    </dialog>
  )
}
