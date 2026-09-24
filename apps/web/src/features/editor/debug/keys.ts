/**
 * The debugger's keys (PRODUCT_SPEC §3): F5 run, F6 pause, F9 breakpoint on the cursor's line,
 * F10 step over, F11 step, Shift+F11 step out; and the arena's (PRODUCT_SPEC §2): `space` run
 * and pause, `.` step, `,` step back, `[` and `]` speed, `0` the strip's zoom back to the whole
 * core. The function keys work wherever the focus is, the editor and the panels' fields
 * included, and never reach the browser (F5 would reload the page); the others belong to a text
 * field while it has the focus, as every key of the app's keymap does.
 */
import { type RefObject, useEffect, useMemo } from 'react'
import { DEBUG_FUNCTION_KEYS, DEBUG_KEYS, functionKey } from '../../../app/keymaps'
import { type KeyCommand, useKeys } from '../../../app/keys'
import type { ArenaCanvasHandle } from '../../arena/ArenaCanvas'
import { spaceTaken } from '../../arena/battle/keys'
import { faster, slower } from '../../arena/battle/speed'
import type { DebugController } from './controller'

export interface DebugKeysOptions {
  readonly controller: DebugController
  /** The address of the editor cursor's line, or why there is none. */
  readonly cursorAddress: () => number | string
  /** The arena strip's canvas, while it shows. */
  readonly strip: RefObject<ArenaCanvasHandle | null>
  /** Tells the user why a key did nothing. */
  readonly notify: (message: string) => void
}

/** The debugger's commands, by what they do. */
export interface DebugCommands {
  run: () => void
  pause: () => void
  toggleBreakpoint: () => void
  step: () => void
  stepOver: () => void
  stepOut: () => void
  stepBack: () => void
}

/** The debugger's commands over `controller`. */
export function debugCommands(
  controller: DebugController,
  cursorAddress: () => number | string,
  notify: (message: string) => void,
): DebugCommands {
  return {
    run: () => controller.run(),
    pause: () => controller.pause(),
    toggleBreakpoint: () => {
      const at = cursorAddress()
      if (typeof at === 'string') notify(at)
      else controller.toggleBreakpoint(at)
    },
    step: () => controller.step(),
    stepOver: () => controller.stepOver(),
    stepOut: () => controller.stepOut(),
    stepBack: () => {
      if (!controller.stepBack()) notify('nothing to step back to.')
    },
  }
}

/** Registers the debugger's keys while the calling component is mounted. */
export function useDebugKeys({ controller, cursorAddress, strip, notify }: DebugKeysOptions): void {
  const commands = useMemo(
    () => debugCommands(controller, cursorAddress, notify),
    [controller, cursorAddress, notify],
  )

  // The function keys, anywhere: a window listener, since the keymap leaves text fields alone.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
      const key = DEBUG_FUNCTION_KEYS.find(
        ({ key, shift }) => key === event.key && shift === event.shiftKey,
      )
      if (key === undefined) return
      event.preventDefault()
      commands[key.command]()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [commands])

  const keys = useMemo<KeyCommand[]>(
    () => [
      // Listed for the key help; the listener above runs them.
      ...DEBUG_FUNCTION_KEYS.map((key) => ({ ...functionKey(key), run: () => false })),
      {
        ...DEBUG_KEYS.run,
        run: () => {
          if (spaceTaken() || controller.snapshot.session === null) return false
          if (controller.snapshot.running !== null) controller.pause()
          else controller.run()
        },
      },
      {
        ...DEBUG_KEYS.step,
        run: () => {
          if (controller.snapshot.session === null) return false
          commands.step()
        },
      },
      {
        ...DEBUG_KEYS.back,
        run: () => {
          if (controller.snapshot.session === null) return false
          commands.stepBack()
        },
      },
      { ...DEBUG_KEYS.slower, run: () => controller.setSpeed(slower(controller.snapshot.speed)) },
      { ...DEBUG_KEYS.faster, run: () => controller.setSpeed(faster(controller.snapshot.speed)) },
      {
        ...DEBUG_KEYS.zoom,
        run: () => {
          const canvas = strip.current
          if (canvas === null) return false
          canvas.camera.reset()
        },
      },
    ],
    [controller, commands, strip],
  )
  useKeys(keys)
}
