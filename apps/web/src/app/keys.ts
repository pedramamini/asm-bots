import type { KeyBinding } from '@asmbots/ui'
import { useEffect, useSyncExternalStore } from 'react'

/** How long the second key of a chord (`g a`) may follow the first, ms. */
export const CHORD_WINDOW = 600

/** The attribute that marks a route's search input: the `/` key focuses it. */
export const ROUTE_SEARCH = 'data-route-search'

export interface KeyCommand extends KeyBinding {
  /** Does the command. Return false when it did nothing, so the key keeps its default. */
  run: () => unknown
}

export interface Keymap {
  /** Adds a layer of commands; the returned function takes it off. A later layer wins a key. */
  register(commands: readonly KeyCommand[]): () => void
  /** Every live binding, the earliest layer first, each key sequence once (the winning one). */
  bindings(): readonly KeyBinding[]
  subscribe(listener: () => void): () => void
  /** Runs the command of a keydown. Returns whether the key was taken (its default prevented). */
  handle(event: KeyboardEvent): boolean
}

export interface KeymapOptions {
  chordWindow?: number
  /** The clock, ms. */
  now?: () => number
}

/**
 * A key registry: the app registers the global keys, a route adds its own while it is mounted,
 * and the key help lists whatever is live. A binding is one key (`t`) or a chord (`g a`) whose
 * keys come within `chordWindow` ms of each other. When one sequence is both a command and the
 * start of a longer one, the command runs at once. Keys typed into a text field, and keys with
 * Ctrl, Alt, or Meta, belong to the field and the browser, except a bound `mod+` key (`mod+k`):
 * Cmd or Ctrl with the key, which works in a field too.
 */
export function createKeymap({
  chordWindow = CHORD_WINDOW,
  now = () => performance.now(),
}: KeymapOptions = {}): Keymap {
  let layers: (readonly KeyCommand[])[] = []
  let snapshot: readonly KeyBinding[] = []
  const listeners = new Set<() => void>()
  /** The keys of a chord so far, and when the last came. */
  let pending: string[] = []
  let pendingAt = 0

  /** The live commands, the latest layer first: the first that matches wins. */
  const commands = () => [...layers].reverse().flat()

  const changed = () => {
    const winners = new Map<string, KeyCommand>()
    for (const command of commands()) {
      const id = command.keys.join(' ')
      if (!winners.has(id)) winners.set(id, command)
    }
    snapshot = layers
      .flat()
      .filter((command) => winners.get(command.keys.join(' ')) === command)
      .map(({ keys, description, group }) => ({ keys, description, group }))
    for (const listener of listeners) listener()
  }

  /** Runs `command` for `event`, and takes the key unless the command did nothing. */
  const take = (event: KeyboardEvent, command: KeyCommand | undefined): boolean => {
    if (command === undefined || command.run() === false) return false
    event.preventDefault()
    return true
  }

  return {
    register(list) {
      layers = [...layers, list]
      changed()
      return () => {
        layers = layers.filter((layer) => layer !== list)
        changed()
      }
    },
    bindings: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    handle(event) {
      if (event.defaultPrevented || event.isComposing) return false
      if (event.ctrlKey || event.metaKey) {
        pending = []
        if (event.altKey || event.shiftKey) return false
        const mod = [`mod+${event.key.toLowerCase()}`]
        return take(
          event,
          commands().find((c) => same(c.keys, mod)),
        )
      }
      if (event.altKey || isEditable(event.target)) {
        pending = []
        return false
      }
      const key = keyName(event.key)
      if (pending.length > 0 && now() - pendingAt > chordWindow) pending = []
      const tries = pending.length > 0 ? [[...pending, key], [key]] : [[key]]
      pending = []
      const live = commands()
      for (const sequence of tries) {
        const command = live.find((c) => same(c.keys, sequence))
        if (command !== undefined) return take(event, command)
        if (live.some((c) => c.keys.length > sequence.length && startsWith(c.keys, sequence))) {
          pending = sequence
          pendingAt = now()
          event.preventDefault()
          return true
        }
      }
      return false
    },
  }
}

/** The app's keymap. */
export const keymap = createKeymap()

/**
 * Registers `commands` on the app's keymap while the component is mounted. Memoize the list:
 * a new list registers again.
 */
export function useKeys(commands: readonly KeyCommand[]): void {
  useEffect(() => keymap.register(commands), [commands])
}

/** The live bindings, for the key help. */
export function useKeyBindings(): readonly KeyBinding[] {
  return useSyncExternalStore(keymap.subscribe, keymap.bindings, keymap.bindings)
}

/** Sends the window's keydowns to the app's keymap while the component is mounted. */
export function useKeymapListener(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      keymap.handle(event)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}

/** Focuses the route's search input (`ROUTE_SEARCH`). False when the route has none. */
export function focusRouteSearch(): boolean {
  const input = document.querySelector<HTMLElement>(`[${ROUTE_SEARCH}]`)
  if (input === null) return false
  input.focus()
  if (input instanceof HTMLInputElement) input.select()
  return true
}

/** A key as a binding names it: `space`, `esc`, else the key's own text (`t`, `?`, `ArrowUp`). */
function keyName(key: string): string {
  if (key === ' ') return 'space'
  if (key === 'Escape') return 'esc'
  return key
}

/** A control that takes typed text: its keys are the user's words, not commands. */
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target.closest('[contenteditable]:not([contenteditable=false])') !== null) return true
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true
  return (
    target instanceof HTMLInputElement &&
    !['button', 'checkbox', 'radio', 'reset', 'submit', 'range', 'color'].includes(target.type)
  )
}

function same(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && startsWith(a, b)
}

function startsWith(keys: readonly string[], prefix: readonly string[]): boolean {
  return prefix.every((key, index) => keys[index] === key)
}
