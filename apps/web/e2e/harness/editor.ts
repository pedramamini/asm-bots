/**
 * The x16c editor mode alone on a page, for `e2e/editor-mode.spec.ts`: a CodeMirror editor with
 * `x16c()` and the everyday editing extensions, on the dwarf, assembled, and `window.editorHarness`
 * to reach in. Only the dev server serves it (`/e2e/harness/editor.html`); no build includes it.
 */
import '../../src/styles.css'
import { assemble } from '@asmbots/asm'
import { applyTheme, initTheme, type Theme } from '@asmbots/ui'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { EditorState } from '@codemirror/state'
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view'
import dwarf from '../../../../packages/bots/roster/dwarf.asm'
import { setAssembled, x16c } from '../../src/features/editor/cm'

initTheme()

const view = new EditorView({
  state: EditorState.create({
    doc: dwarf,
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      drawSelection(),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      x16c(),
      EditorView.theme({ '&': { flex: '1' } }),
    ],
  }),
  parent: document.getElementById('root') as HTMLElement,
})
view.dispatch({ effects: setAssembled.of(assemble(dwarf)) })

const editorHarness = {
  view,
  /** Switches the page's theme, as the settings do: the editor is not touched. */
  setTheme(theme: Theme) {
    applyTheme(theme, { persist: false })
  },
}

export type EditorHarness = typeof editorHarness

declare global {
  interface Window {
    editorHarness: EditorHarness
  }
}

window.editorHarness = editorHarness
