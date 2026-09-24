/**
 * What the debugger's panels share: the state before the last change, so a panel can mark the
 * values the last move changed, and a field that edits a hex word in place.
 */
import { useRef } from 'react'
import type { DebugState } from './session'

/**
 * The state the panel showed before `state`: the last different one. A new state of the same
 * cycle and process (a breakpoint set, an edit) keeps the one before, so a mark stays until the
 * next move.
 */
export function usePreviousState(state: DebugState | null): DebugState | null {
  const shown = useRef<{ current: DebugState | null; previous: DebugState | null }>({
    current: state,
    previous: null,
  })
  const kept = shown.current
  if (state !== kept.current) {
    const moved =
      state === null ||
      kept.current === null ||
      state.cycle !== kept.current.cycle ||
      state.stop !== kept.current.stop
    shown.current = { current: state, previous: moved ? kept.current : kept.previous }
  }
  return shown.current.previous
}

/** Whether `a` and `b` follow the same process. */
export function sameProcess(a: DebugState | null, b: DebugState | null): boolean {
  return (
    a !== null &&
    b !== null &&
    a.selectedProc.bot === b.selectedProc.bot &&
    a.selectedProc.row === b.selectedProc.row
  )
}

/** A word as a register field shows it: 4 uppercase hex digits. */
export const word = (v: number) => (v & 0xffff).toString(16).toUpperCase().padStart(4, '0')

/** A field's text as a word: hex digits, `0x` before them or not. Null for anything else. */
export function parseWord(text: string): number | null {
  const digits = text.trim().replace(/^0x/i, '')
  if (!/^[0-9a-f]{1,4}$/i.test(digits)) return null
  return Number.parseInt(digits, 16)
}
