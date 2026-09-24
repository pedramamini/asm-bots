/**
 * The last assemble without errors, in the editor's state: what reads the bot's symbols reads it
 * here (the label completions). `setAssembled` hands each result in; one with an error leaves the
 * last good one in place, so completions do not blink out while a line is half typed.
 */
import type { Assembled } from '@asmbots/asm'
import { StateEffect, StateField } from '@codemirror/state'

export const setAssembled = StateEffect.define<Assembled>()

export const assembledField = StateField.define<Assembled | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (
        effect.is(setAssembled) &&
        !effect.value.diagnostics.some((d) => d.severity === 'error')
      ) {
        value = effect.value
      }
    }
    return value
  },
})
