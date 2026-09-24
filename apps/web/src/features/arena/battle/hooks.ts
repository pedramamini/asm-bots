/**
 * The battle view's hooks: the rail's throttled redraws, the frame rate, fullscreen, and zoom.
 */
import { type RefObject, useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { useFps } from '../../../app/slots'
import type { Camera } from '../render/camera'
import type { BattleLog } from './log'

/** How often the rail redraws what the log gathered, ms: the log changes every frame. */
export const RAIL_MS = 125

/**
 * The log's version, at most once every `ms`: the rail's tables redraw with it, not with every
 * frame. A change after a quiet spell shows at once.
 */
export function useLogTick(log: BattleLog, ms = RAIL_MS): number {
  const [version, setVersion] = useState(log.version)
  useEffect(() => {
    let last = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    const flush = () => {
      timer = null
      last = performance.now()
      setVersion(log.version)
    }
    const off = log.subscribe(() => {
      if (timer !== null) return
      const wait = last + ms - performance.now()
      if (wait <= 0) flush()
      else timer = setTimeout(flush, wait)
    })
    // A change between the render and the subscription.
    setVersion(log.version)
    return () => {
      off()
      if (timer !== null) clearTimeout(timer)
    }
  }, [log, ms])
  return version
}

/** How long the frame rate averages over, ms. */
const FPS_WINDOW = 500

/**
 * The display's frame rate while `active` (the battle plays), null while not; the status bar's
 * fps chip shows it too (DESIGN_SYSTEM §4).
 */
export function useFrameRate(active: boolean): number | null {
  const [fps, setFps] = useState<number | null>(null)
  useEffect(() => {
    const report = useFps.getState().setFps
    if (!active || typeof requestAnimationFrame !== 'function') {
      setFps(null)
      report(null)
      return
    }
    let frames = 0
    let since = performance.now()
    let id = requestAnimationFrame(function tick(now) {
      frames++
      if (now - since >= FPS_WINDOW) {
        const rate = (frames * 1000) / (now - since)
        setFps(rate)
        report(rate)
        frames = 0
        since = now
      }
      id = requestAnimationFrame(tick)
    })
    return () => {
      cancelAnimationFrame(id)
      report(null)
    }
  }, [active])
  return fps
}

/** Whether `ref`'s element fills the screen, and what turns that on and off (`f`). */
export function useFullscreen(ref: RefObject<HTMLElement | null>): [boolean, () => void] {
  const subscribe = useCallback((changed: () => void) => {
    document.addEventListener('fullscreenchange', changed)
    return () => document.removeEventListener('fullscreenchange', changed)
  }, [])
  const on = useSyncExternalStore(
    subscribe,
    () => ref.current !== null && document.fullscreenElement === ref.current,
    () => false,
  )
  const toggle = useCallback(() => {
    const element = ref.current
    if (element === null) return
    if (document.fullscreenElement === element) void document.exitFullscreen?.()
    else void element.requestFullscreen?.().catch(() => {})
  }, [ref])
  return [on, toggle]
}

/** The camera's zoom, as it changes. */
export function useZoom(camera: Camera): number {
  return useSyncExternalStore(
    (changed) => camera.subscribe(changed),
    () => camera.zoom,
    () => camera.zoom,
  )
}
