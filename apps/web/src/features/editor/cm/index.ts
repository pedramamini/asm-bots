/**
 * x16c in CodeMirror 6, whole: the language and its colors (x16c.ts), completion (complete.ts),
 * the reference card on hover (hover.ts), and the last good assemble that completion reads
 * (assembled.ts). The editor feeds each assemble in with `setAssembled`.
 */
import { autocompletion } from '@codemirror/autocomplete'
import { LanguageSupport, syntaxHighlighting } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { assembledField } from './assembled'
import { x16cCompletions } from './complete'
import { x16cHover } from './hover'
import { x16cHighlightStyle, x16cLanguage, x16cTheme } from './x16c'

export { assembledField, setAssembled } from './assembled'
export { scan, scanLine, x16cLanguage, x16cTheme } from './x16c'

export function x16c(): LanguageSupport {
  return new LanguageSupport(x16cLanguage, [
    syntaxHighlighting(x16cHighlightStyle),
    x16cTheme,
    x16cLanguage.data.of({ autocomplete: x16cCompletions }),
    autocompletion({ icons: false }),
    x16cHover,
    assembledField,
    // A snippet's linked fields are one selection range each: the fork's two `child` labels.
    EditorState.allowMultipleSelections.of(true),
  ])
}
