import { afterAll, afterEach, beforeAll } from 'bun:test'
import { cleanup, prettyDOM } from '@testing-library/react'
import { installDom, removeDom, window } from './window'

export { window }

type ActGlobal = typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

/**
 * Gives the calling test file the DOM while it runs: the jsdom window on the global object, React
 * in act() mode, and a clean document and localStorage after each test. Call it at the top level.
 */
export function useDom(): void {
  const act = globalThis as ActGlobal
  let previous: boolean | undefined
  beforeAll(() => {
    installDom()
    previous = act.IS_REACT_ACT_ENVIRONMENT
    act.IS_REACT_ACT_ENVIRONMENT = true
  })
  afterEach(async () => {
    cleanup()
    window.localStorage.clear()
    // jsdom queues some events (selectionchange after a focus) as tasks. Let them fire now, while
    // the DOM is still on the global object: React's handler for them reads `window`.
    await new Promise((resolve) => setImmediate(resolve))
  })
  afterAll(() => {
    removeDom()
    act.IS_REACT_ACT_ENVIRONMENT = previous
  })
}

/**
 * The element's markup, indented, for a snapshot. React's generated ids (`useId`) depend on how
 * many components rendered before, so each becomes `id-1`, `id-2`, … in order of appearance.
 */
export function html(element: Element): string {
  const ids = new Map<string, string>()
  const markup = prettyDOM(element, Number.POSITIVE_INFINITY, { highlight: false }) || ''
  return markup.replace(/_r_[0-9a-z]+_|«r[0-9a-z]+»|:r[0-9a-z]+:/g, (id) => {
    if (!ids.has(id)) ids.set(id, `id-${ids.size + 1}`)
    return ids.get(id) as string
  })
}

/**
 * Gives every element the layout property `name` (jsdom lays nothing out) until the returned
 * function runs. `value` gets the element, so a test can size one element differently.
 */
export function stubLayout(
  name: 'clientWidth' | 'scrollWidth' | 'offsetHeight',
  value: (element: HTMLElement) => number,
): () => void {
  const proto = window.HTMLElement.prototype
  // offsetHeight is HTMLElement's own; the others come from Element. Put back what was there.
  const own = Object.getOwnPropertyDescriptor(proto, name)
  Object.defineProperty(proto, name, {
    configurable: true,
    get(this: HTMLElement) {
      return value(this)
    },
  })
  return () => {
    if (own === undefined) delete (proto as unknown as Record<string, unknown>)[name]
    else Object.defineProperty(proto, name, own)
  }
}
