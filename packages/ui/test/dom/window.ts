import { JSDOM } from 'jsdom'

/**
 * jsdom hides every popover: its default style hides `[popover]:not(:popover-open)`, and with no
 * Popover API nothing matches `:popover-open`. The kit renders a tooltip or a menu only while it is
 * open, so the test document shows every popover.
 */
const SHOW_POPOVERS = '<style>[popover] { display: block !important; }</style>'

/**
 * The one jsdom window of a test run. Bun runs every test file in one process, with one module
 * cache and one global object, so every component test renders into this window's document.
 */
export const window = new JSDOM(
  `<!doctype html><html><head>${SHOW_POPOVERS}</head><body></body></html>`,
  { url: 'http://localhost/', pretendToBeVisual: true },
).window

// jsdom has no pointer capture. Capture changes nothing a test can see, so it does nothing here.
Object.assign(window.Element.prototype, {
  setPointerCapture() {},
  releasePointerCapture() {},
  hasPointerCapture: () => false,
})

/** The window's globals that Bun lacks: document, HTMLElement, localStorage, and the rest. */
const KEYS = Object.getOwnPropertyNames(window).filter(
  (key) => !key.startsWith('_') && !(key in globalThis),
)

/** Puts the window's globals on the global object. Bun's own (fetch, Event, navigator) stay. */
export function installDom(): void {
  const source = window as unknown as Record<string, unknown>
  for (const key of KEYS) {
    Object.defineProperty(globalThis, key, {
      value: source[key],
      configurable: true,
      writable: true,
    })
  }
}

/** Takes the window's globals off the global object again. */
export function removeDom(): void {
  for (const key of KEYS) delete (globalThis as Record<string, unknown>)[key]
}
