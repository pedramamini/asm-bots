import { Button, cx } from '@asmbots/ui'
import { Compass, CornerDownLeft } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useMotionReduced } from '../../store/settings'
import { LogoMark } from '../Logo'
import { useBoot } from './boot'
import {
  CoreDump,
  DUMP_BOTS,
  DumpPainter,
  type DumpPalette,
  LOAD_MS,
  RUN_MS,
  ZERO_MS,
} from './core-dump'

/** How long the boot screen takes to fade out, ms. */
const LEAVE_MS = 250

/** The boot log: each line shows once the dump behind it has done that step. */
export const BOOT_LOG: readonly { label: string; value: string; at: number }[] = [
  { label: 'x16c v1 core', value: '65,536 bytes', at: 150 },
  { label: 'zeroing core', value: 'ok', at: ZERO_MS },
  { label: 'loading bots', value: String(DUMP_BOTS.length), at: LOAD_MS },
  { label: 'arena', value: 'live', at: RUN_MS },
]

/**
 * The boot screen: the logo and the boot log on a panel in the middle of a core dump that boots
 * behind it (`core-dump.ts`). A modal dialog, so the page under it is inert until the user goes in.
 * Every load gets `take tour` beside `enter site` (with the focus, so Enter takes it; Escape too).
 */
export function BootScreen() {
  const dialog = useRef<HTMLDialogElement>(null)
  const enterButton = useRef<HTMLButtonElement>(null)
  const reduced = useMotionReduced()
  const openTour = useBoot((state) => state.openTour)
  const skip = useBoot((state) => state.skip)
  const [leaving, setLeaving] = useState(false)
  const lines = useBootLog(reduced)

  useLayoutEffect(() => {
    const node = dialog.current
    if (node === null) return
    if (typeof node.showModal === 'function') node.showModal()
    else node.setAttribute('open', '')
    enterButton.current?.focus()
    return () => {
      if (node.open && typeof node.close === 'function') node.close()
    }
  }, [])

  const leave = (then: () => void) => {
    if (leaving) return
    if (reduced) return then()
    setLeaving(true)
    setTimeout(then, LEAVE_MS)
  }

  return (
    <dialog
      ref={dialog}
      aria-modal="true"
      aria-label="asm bots"
      aria-describedby="boot-line"
      data-boot=""
      onCancel={(event) => {
        event.preventDefault()
        leave(skip)
      }}
      className={cx(
        'fixed inset-0 z-modal m-0 grid size-full max-h-none max-w-none place-items-center overflow-hidden border-0 bg-arena-bg p-3 text-body text-text backdrop:bg-arena-bg',
        'transition-opacity duration-250 ease-out starting:open:opacity-0 motion-reduce:transition-none',
        leaving && 'opacity-0',
      )}
    >
      <CoreDumpCanvas reduced={reduced} />
      {/* The edges fall away to black, so the eye goes to the middle. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_20%,var(--arena-bg)_85%)]"
      />
      <div className="relative flex w-full max-w-110 flex-col gap-5 rounded-lg border border-border-strong bg-panel p-6 transition-[opacity,translate] duration-300 ease-out starting:translate-y-2 starting:opacity-0 motion-reduce:transition-none">
        <div className="flex items-center gap-4">
          <LogoMark size={64} glow />
          <div className="flex flex-col gap-1.5">
            <span className="font-[700] text-[30px] text-bright leading-none tracking-[0.18em]">
              ASM BOTS
            </span>
            <span className="text-panel-title text-accent-fg">{'core war // 8086'}</span>
          </div>
        </div>
        <p id="boot-line" className="text-body text-muted">
          Write a bot in 8086 assembly. Load it into 64 KB of shared memory with other bots. The
          last one running wins.
        </p>
        <ol aria-label="boot log" className="flex flex-col gap-1 text-data">
          {BOOT_LOG.map((line, index) => (
            <li
              key={line.label}
              className={cx(
                'flex items-baseline transition-opacity duration-120 ease-out motion-reduce:transition-none',
                index < lines ? 'opacity-100' : 'opacity-0',
              )}
            >
              <span className="text-muted">{line.label}</span>
              <span
                aria-hidden="true"
                className="mx-2 flex-1 border-b border-dotted border-border-strong"
              />
              <span className="text-accent-fg">{line.value}</span>
            </li>
          ))}
        </ol>
        {/* Two equal halves: the tour and straight in (which has the focus). */}
        <div className="grid grid-cols-2 gap-2">
          <Button icon={Compass} className="justify-center" onClick={() => leave(openTour)}>
            take tour
          </Button>
          <Button
            ref={enterButton}
            variant="primary"
            icon={CornerDownLeft}
            className="justify-center"
            onClick={() => leave(skip)}
          >
            enter site
          </Button>
        </div>
      </div>
    </dialog>
  )
}

/** How many lines of the boot log show: each at its time, all at once under reduced motion. */
function useBootLog(reduced: boolean): number {
  const [lines, setLines] = useState(reduced ? BOOT_LOG.length : 0)
  useEffect(() => {
    if (reduced) {
      setLines(BOOT_LOG.length)
      return
    }
    const timers = BOOT_LOG.map((line, index) => setTimeout(() => setLines(index + 1), line.at))
    return () => timers.forEach(clearTimeout)
  }, [reduced])
  return lines
}

/** The theme's colors for the dump, read from its tokens. */
function readPalette(): DumpPalette {
  const style = getComputedStyle(document.documentElement)
  const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
  return {
    background: token('--arena-bg', '#000000'),
    ruler: token('--arena-ruler', '#3A5A3A'),
    write: token('--arena-write', '#FFFFFF'),
    ip: token('--arena-ip', '#FFFFFF'),
    bots: Array.from({ length: 12 }, (_, i) => token(`--bot-${i}`, '#00FF88')),
  }
}

/**
 * The dump behind the panel, filling the screen. It boots at once and runs until the screen goes;
 * under reduced motion it draws one still of the bots running, and stops.
 */
function CoreDumpCanvas({ reduced }: { reduced: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const node = canvas.current
    if (node === null) return
    let painter: DumpPainter
    try {
      painter = new DumpPainter(
        node,
        readPalette(),
        getComputedStyle(node).fontFamily || 'monospace',
      )
    } catch {
      return // No 2D canvas (a test's DOM): the black stays.
    }
    const seed = Date.now()
    const build = (was?: CoreDump) => {
      const size = painter.layout(window.innerWidth, window.innerHeight, window.devicePixelRatio)
      const next = new CoreDump(size.cols, size.rows, seed)
      if (reduced) next.settle()
      else if (was !== undefined) next.settle(was.time)
      painter.paintAll(next)
      return next
    }
    let dump = build()
    let stopped = false
    const layout = () => {
      if (!stopped) dump = build(dump)
    }
    window.addEventListener('resize', layout)
    // The first paint may set the dump in a fallback face: again once the mono face is in.
    void document.fonts?.ready.then(layout)
    const stop = () => {
      stopped = true
      window.removeEventListener('resize', layout)
    }
    if (reduced) return stop
    let frame = 0
    let last = performance.now()
    const draw = (now: number) => {
      dump.advance(now - last)
      last = now
      painter.paint(dump)
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(frame)
      stop()
    }
  }, [reduced])
  return (
    <canvas ref={canvas} className="pointer-events-none absolute inset-0 size-full font-mono" />
  )
}
