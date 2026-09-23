/**
 * Test preload (bunfig.toml). React DOM and Testing Library look for the DOM once, when they load
 * (Testing Library binds `screen` to document.body), and Bun loads a CommonJS package before the
 * module that imports it, so a test file cannot set up the DOM first. They load here instead, with
 * the jsdom window on the global object. Then the window comes off: a test file that does not
 * render sees no DOM, and one that does calls `useDom()`.
 */
import { installDom, removeDom } from './window'

installDom()
await import('@testing-library/react')
removeDom()
