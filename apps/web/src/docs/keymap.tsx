/**
 * The docs' keyboard map (`/docs/tools/keys`): every key the app binds, drawn by the key help's
 * own table from the same data the routes register (`app/keymaps.ts`), so the page cannot drift
 * from the keys.
 */
import { type KeyBinding, KeyHelp } from '@asmbots/ui'
import { NAV } from '../app/Frame'
import {
  ARENA_KEYS,
  DEBUG_FUNCTION_KEYS,
  DEBUG_KEYS,
  DIGIT_BOTS,
  EDITOR_KEYS,
  functionKey,
  GLOBAL_KEYS,
  goKey,
  SOURCE_KEYS,
} from '../app/keymaps'

/** Every binding, by group: what the key help shows on each route, all at once. */
export function allBindings(): KeyBinding[] {
  const { fullscreen, screenshot, ...arena } = ARENA_KEYS
  const binding = ({ keys, description, group }: KeyBinding): KeyBinding => ({
    keys,
    description,
    group,
  })
  return [
    ...Object.values(GLOBAL_KEYS),
    ...NAV.map(({ key, label }) => goKey(key, label)),
    ...Object.values(arena),
    { keys: [`1..${DIGIT_BOTS}`], description: 'isolate bot n', group: 'arena' },
    fullscreen,
    screenshot,
    ...Object.values(EDITOR_KEYS),
    ...Object.values(SOURCE_KEYS).map(binding),
    ...DEBUG_FUNCTION_KEYS.map(functionKey),
    ...Object.values(DEBUG_KEYS),
  ]
}

/** `<KeyMap />`: every key of the app, a table per group. */
export function KeyMap() {
  return <KeyHelp bindings={allBindings()} className="my-4" />
}
