/**
 * The assembler's findings in CodeMirror (PRODUCT_SPEC §3: squiggle, gutter mark, problems panel).
 * `useAssembler` assembles off the main thread; each result the editor still holds the source of
 * goes in through `showResult`: its errors and lint warnings as `@codemirror/lint` diagnostics
 * (the squiggles, their hover tooltips, and `lintGutter`'s marks), and the assemble itself through
 * `setAssembled` (the listing gutter, label completion). CodeMirror maps the diagnostics through
 * each edit until the next result replaces them. `problemsOf` reads them back for the panel.
 */
import type { Diag } from '@asmbots/asm'
import {
  type Diagnostic,
  forEachDiagnostic,
  setDiagnostics,
  setDiagnosticsEffect,
} from '@codemirror/lint'
import type { EditorState, Text, Transaction } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { AsmResult } from '../asm/protocol'
import { setAssembled } from './assembled'

/** A diagnostic with the assembler's finding it came from. */
export interface X16cDiagnostic extends Diagnostic {
  readonly diag: Diag
}

/** Where `d` points in `doc`: its line, from its column over `len` columns, held to the line. */
export function diagRange(d: Diag, doc: Text): { from: number; to: number } {
  const line = doc.line(Math.min(Math.max(d.line, 1), doc.lines))
  const from = line.from + Math.min(Math.max(d.col - 1, 0), line.length)
  return { from, to: Math.min(from + Math.max(d.len, 0), line.to) }
}

/** `d` as a CodeMirror diagnostic in `doc`; its tooltip adds the fix under the message. */
export function toDiagnostic(d: Diag, doc: Text): X16cDiagnostic {
  const { from, to } = diagRange(d, doc)
  return {
    from,
    to,
    severity: d.severity,
    message: d.message,
    source: d.code,
    diag: d,
    renderMessage: () => {
      const box = document.createElement('span')
      box.className = 'cm-x16c-diagnostic'
      const message = document.createElement('span')
      message.textContent = d.message
      box.append(message)
      if (d.fix !== undefined) {
        const fix = document.createElement('span')
        fix.className = 'cm-x16c-fix'
        fix.textContent = d.fix
        box.append(fix)
      }
      return box
    },
  }
}

/** The findings of `result` for `doc`: the errors, and the lint warnings when `lint` is on. */
export function resultDiagnostics(result: AsmResult, doc: Text, lint: boolean): X16cDiagnostic[] {
  const diags = lint
    ? [...result.assembled.diagnostics, ...result.warnings]
    : result.assembled.diagnostics
  return diags.map((d) => toDiagnostic(d, doc))
}

/**
 * Shows `result` in `view`: its diagnostics and its assemble. A result for other text than the
 * view holds is stale (the source changed on the way), and shows nothing; returns whether it
 * showed.
 */
export function showResult(view: EditorView, result: AsmResult, lint: boolean): boolean {
  const { state } = view
  if (state.doc.toString() !== result.source) return false
  view.dispatch(setDiagnostics(state, resultDiagnostics(result, state.doc, lint)), {
    effects: setAssembled.of(result.assembled),
  })
  return true
}

/** A finding as the problems panel lists it, where the editor has it now. */
export interface Problem {
  /** The position in the document, mapped through the edits since the assemble. */
  readonly from: number
  readonly line: number
  /** 1-based. */
  readonly col: number
  readonly severity: 'error' | 'warning'
  readonly message: string
  readonly code: string
  readonly fix: string | undefined
}

/** The editor's findings in document order, errors before warnings at one place. */
export function problemsOf(state: EditorState): Problem[] {
  const problems: Problem[] = []
  forEachDiagnostic(state, (d, from) => {
    const line = state.doc.lineAt(from)
    const diag = (d as Partial<X16cDiagnostic>).diag
    problems.push({
      from,
      line: line.number,
      col: from - line.from + 1,
      severity: d.severity === 'error' ? 'error' : 'warning',
      message: d.message,
      code: d.source ?? '',
      fix: diag?.fix,
    })
  })
  return problems.sort(
    (a, b) => a.from - b.from || (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1),
  )
}

/** Whether a transaction changed what the problems panel lists: an edit, or new findings. */
export function changesProblems(tr: Transaction): boolean {
  return tr.docChanged || tr.effects.some((effect) => effect.is(setDiagnosticsEffect))
}
