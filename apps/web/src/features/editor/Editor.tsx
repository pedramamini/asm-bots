/**
 * The editor's CodeMirror view (PRODUCT_SPEC §3): the x16c mode, the diagnostics gutter, the line
 * numbers, the listing gutter, search, and the page's keys inside the editor. The view is made
 * once per document, so the page keys this component by document, and drives the view it hands
 * out through `onView`.
 */
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentLess, indentMore } from '@codemirror/commands'
import { bracketMatching, indentUnit } from '@codemirror/language'
import { lintGutter, nextDiagnostic } from '@codemirror/lint'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { EditorSelection, EditorState, Prec } from '@codemirror/state'
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  type KeyBinding,
  keymap,
  lineNumbers,
} from '@codemirror/view'
import { useEffect, useRef } from 'react'
import { x16c } from './cm'
import { changesProblems, type Problem, problemsOf } from './cm/diagnostics'
import { listing, setListingVisible } from './cm/listing'

/** The formatter's columns are 8 apart (ARCHITECTURE §4): Tab goes to the next one. */
const TAB_STOP = 8

/** The page's commands, run from keys inside the editor. */
export interface EditorCommands {
  /** Shift-Alt-f. */
  format: () => void
  /** Mod-Enter. */
  assemble: () => void
}

export interface EditorProps {
  /** The text the document starts with; later changes to it are ignored. */
  initial: string
  /** A roster bot: the text cannot change. */
  readOnly: boolean
  /** The listing gutter shows. */
  listing: boolean
  /** The selection to start with, as a position or a range. */
  selection?: { anchor: number; head: number } | undefined
  /** The text after each change. */
  onChange: (source: string) => void
  /** The findings after each change of them (an edit, or a new assemble). */
  onProblems: (problems: Problem[]) => void
  /** The view once made, and null as it goes. */
  onView: (view: EditorView | null) => void
  commands: EditorCommands
  className?: string | undefined
}

/** Tab: spaces up to the next tab stop, or the lines one stop in when text is selected. */
function tabToStop(view: EditorView): boolean {
  const { state } = view
  if (state.readOnly) return false
  if (state.selection.ranges.some((range) => !range.empty)) return indentMore(view)
  view.dispatch(
    state.changeByRange((range) => {
      const line = state.doc.lineAt(range.from)
      const spaces = ' '.repeat(TAB_STOP - ((range.from - line.from) % TAB_STOP))
      return {
        changes: { from: range.from, insert: spaces },
        range: EditorSelection.cursor(range.from + spaces.length),
      }
    }),
    { scrollIntoView: true, userEvent: 'input' },
  )
  return true
}

/** Esc leaves the editor, so the page's keys (`l`, `b`) work; popups and panels close first. */
function leaveEditor(view: EditorView): boolean {
  view.contentDOM.blur()
  return true
}

export function Editor({
  initial,
  readOnly,
  listing: showListing,
  selection,
  onChange,
  onProblems,
  onView,
  commands,
  className,
}: EditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  // The view outlives renders: its keys and listeners call the latest props.
  const latest = useRef({ onChange, onProblems, onView, commands })
  latest.current = { onChange, onProblems, onView, commands }
  // Read once, as the view is made.
  const start = useRef({ initial, readOnly, showListing, selection })

  useEffect(() => {
    const parent = host.current
    if (parent === null) return
    const { initial, readOnly, showListing, selection } = start.current
    const pageKeys: KeyBinding[] = [
      {
        key: 'Shift-Alt-f',
        run: () => {
          latest.current.commands.format()
          return true
        },
      },
      {
        key: 'Mod-Enter',
        run: () => {
          latest.current.commands.assemble()
          return true
        },
      },
      { key: 'F8', run: nextDiagnostic },
      { key: 'Tab', run: tabToStop, shift: indentLess },
    ]
    const made = new EditorView({
      parent,
      state: EditorState.create({
        doc: initial,
        ...(selection !== undefined && {
          selection: EditorSelection.single(
            Math.min(selection.anchor, initial.length),
            Math.min(selection.head, initial.length),
          ),
        }),
        extensions: [
          lintGutter(),
          lineNumbers(),
          listing(showListing),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          history(),
          drawSelection(),
          dropCursor(),
          bracketMatching(),
          closeBrackets(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          indentUnit.of(' '.repeat(TAB_STOP)),
          keymap.of([
            ...pageKeys,
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...searchKeymap,
            ...historyKeymap,
          ]),
          Prec.low(keymap.of([{ key: 'Escape', run: leaveEditor }])),
          x16c(),
          EditorState.readOnly.of(readOnly),
          EditorView.contentAttributes.of({ 'aria-label': 'bot source' }),
          EditorView.theme({ '&': { height: '100%' }, '.cm-scroller': { overflow: 'auto' } }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) latest.current.onChange(update.state.doc.toString())
            if (update.transactions.some(changesProblems)) {
              latest.current.onProblems(problemsOf(update.state))
            }
          }),
        ],
      }),
    })
    if (selection !== undefined) made.dispatch({ scrollIntoView: true })
    view.current = made
    latest.current.onView(made)
    return () => {
      view.current = null
      latest.current.onView(null)
      made.destroy()
    }
  }, [])

  useEffect(() => {
    if (view.current !== null) setListingVisible(view.current, showListing)
  }, [showListing])

  return <div ref={host} className={className} />
}
