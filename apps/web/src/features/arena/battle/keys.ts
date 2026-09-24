/**
 * The arena's keys (PRODUCT_SPEC §2), in the app's key registry while a battle shows: `space`
 * play and pause, `.` step, `,` step back, `[` and `]` speed, `0` reset the zoom, `1`..`9`
 * isolate a bot, `f` fullscreen, `s` screenshot. `?` lists them.
 */
import { type RefObject, useMemo } from 'react'
import { type KeyCommand, useKeys } from '../../../app/keys'
import type { ArenaCanvasHandle } from '../ArenaCanvas'
import type { ArenaClient } from '../worker/client'
import { faster, slower } from './speed'
import { useArenaView } from './view'

/** The bots `1`..`9` reach. */
const DIGIT_BOTS = 9

/** Roles and inputs that `space` presses when they have the focus. */
const SPACE_CONTROLS =
  'button, a[href], summary, [role="button"], [role="radio"], [role="switch"], [role="checkbox"], [role="menuitem"], [role="tab"], [role="option"], input[type="checkbox"], input[type="radio"]'

/** Whether the focused element takes `space` itself: a button presses, a radio picks. */
function spaceTaken(): boolean {
  const focused = document.activeElement
  return focused instanceof Element && focused.matches(SPACE_CONTROLS)
}

export interface ArenaKeysOptions {
  client: ArenaClient
  canvas: RefObject<ArenaCanvasHandle | null>
  /** The bots in the battle: `1`..`9` go as far as there are bots. */
  bots: number
  onFullscreen: () => void
  onScreenshot: () => void
}

/** Registers the arena's keys while the calling component is mounted. */
export function useArenaKeys({
  client,
  canvas,
  bots,
  onFullscreen,
  onScreenshot,
}: ArenaKeysOptions): void {
  const commands = useMemo<KeyCommand[]>(() => {
    const { store } = client
    const loaded = () => {
      const { status } = store.getState()
      return status === 'paused' || status === 'playing' || status === 'ended'
    }
    return [
      {
        keys: ['space'],
        description: 'play or pause',
        group: 'arena',
        run: () => {
          const { status } = store.getState()
          if (spaceTaken() || (status !== 'playing' && status !== 'paused')) return false
          if (status === 'playing') client.pause()
          else client.play()
        },
      },
      {
        keys: ['.'],
        description: 'step one cycle',
        group: 'arena',
        run: () => {
          const { status } = store.getState()
          if (status !== 'playing' && status !== 'paused') return false
          client.pause()
          client.step(1)
        },
      },
      {
        keys: [','],
        description: 'step back one cycle',
        group: 'arena',
        run: () => {
          const { cycle } = store.getState()
          if (!loaded() || cycle === 0) return false
          client.pause()
          client.seek(cycle - 1)
        },
      },
      {
        keys: ['['],
        description: 'slower',
        group: 'arena',
        run: () => client.speed(slower(store.getState().speed)),
      },
      {
        keys: [']'],
        description: 'faster',
        group: 'arena',
        run: () => client.speed(faster(store.getState().speed)),
      },
      {
        keys: ['0'],
        description: 'reset the zoom',
        group: 'arena',
        run: () => canvas.current?.camera.reset(),
      },
      ...Array.from({ length: Math.min(DIGIT_BOTS, bots) }, (_, bot) => ({
        keys: [String(bot + 1)],
        description: `isolate bot ${bot + 1}`,
        group: 'arena',
        run: () => useArenaView.getState().isolate(bot),
      })),
      { keys: ['f'], description: 'fullscreen', group: 'arena', run: onFullscreen },
      { keys: ['s'], description: 'screenshot', group: 'arena', run: onScreenshot },
    ]
  }, [client, canvas, bots, onFullscreen, onScreenshot])
  useKeys(commands)
}
