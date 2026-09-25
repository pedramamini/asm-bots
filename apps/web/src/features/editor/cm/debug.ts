/**
 * The debugger in the editor (PRODUCT_SPEC §3): the line the followed process stands on, bright,
 * with an arrow in the gutter, and a dot for each breakpoint in a gutter left of the line numbers;
 * a press on that gutter sets or clears the line's breakpoint.
 *
 * Each line knows its address from the listing of the bot the debugger loaded (`setDebugLines`):
 * a marker at the line's start holds the address and length of its bytes. The markers map through
 * every edit, as the listing gutter's do, so a line keeps its address while the text around it
 * changes, a deleted line takes its marker along, and a line typed since the load has none. The
 * debugger hands over where the process stands and its breakpoints with `setDebugMarks`.
 */
import {
  type EditorState,
  type Extension,
  MapMode,
  type Range,
  RangeSet,
  RangeValue,
  StateEffect,
  StateField,
} from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, GutterMarker, gutter } from '@codemirror/view'
import type { LineBytes } from '../debug/image'

/** A line's bytes: the address of the first, and how many. */
class LineAddress extends RangeValue {
  readonly addr: number
  readonly length: number

  constructor(addr: number, length: number) {
    super()
    this.addr = addr
    this.length = length
  }

  override eq(other: RangeValue): boolean {
    return other instanceof LineAddress && other.addr === this.addr && other.length === this.length
  }

  /** Whether `addr` is one of the line's bytes, wrapping at 64 KB. */
  holds(addr: number): boolean {
    return ((addr - this.addr) & 0xffff) < this.length
  }
}

// Dropped with its line, as the listing's markers are (`listing.ts`).
LineAddress.prototype.mapMode = MapMode.TrackAfter

/** What the debugger shows in the editor. */
export interface DebugMarks {
  /** The address the followed process stands on; null for none. */
  readonly ip: number | null
  /** The breakpoints: address to whether it is enabled. */
  readonly breakpoints: ReadonlyMap<number, boolean>
}

interface DebugLines extends DebugMarks {
  readonly lines: RangeSet<LineAddress>
}

const NO_MARKS: DebugLines = { lines: RangeSet.empty, ip: null, breakpoints: new Map() }

/** The lines of the bot the debugger loaded, with bytes; null forgets them. */
export const setDebugLines = StateEffect.define<readonly LineBytes[] | null>()

/** Where the followed process stands, and the breakpoints. */
export const setDebugMarks = StateEffect.define<DebugMarks>()

function linesOf(lines: readonly LineBytes[], state: EditorState): RangeSet<LineAddress> {
  const ranges: Range<LineAddress>[] = []
  for (const line of lines) {
    if (line.lineNo > state.doc.lines) continue
    ranges.push(new LineAddress(line.addr, line.length).range(state.doc.line(line.lineNo).from))
  }
  return RangeSet.of(ranges, true)
}

export const debugLinesField = StateField.define<DebugLines>({
  create: () => NO_MARKS,
  update(value, tr) {
    let next = tr.docChanged ? { ...value, lines: value.lines.map(tr.changes) } : value
    for (const effect of tr.effects) {
      if (effect.is(setDebugLines)) {
        next = {
          ...next,
          lines: effect.value === null ? RangeSet.empty : linesOf(effect.value, tr.state),
        }
      } else if (effect.is(setDebugMarks)) {
        next = { ...next, ip: effect.value.ip, breakpoints: effect.value.breakpoints }
      }
    }
    return next
  },
})

/** The marker at the very start of the line at `from`, if any: one per line. */
function markerAt(state: EditorState, from: number): LineAddress | null {
  let found: LineAddress | null = null
  state.field(debugLinesField).lines.between(from, from, (at, _to, marker) => {
    if (at !== from) return
    found = marker
    return false
  })
  return found
}

/** The address and length of line `lineNo`'s bytes, as loaded; null for a line with none. */
export function lineBytes(
  state: EditorState,
  lineNo: number,
): { readonly addr: number; readonly length: number } | null {
  if (!state.field(debugLinesField, false) || lineNo < 1 || lineNo > state.doc.lines) return null
  const marker = markerAt(state, state.doc.line(lineNo).from)
  return marker === null ? null : { addr: marker.addr, length: marker.length }
}

/** The line whose bytes hold `addr`, and `addr`'s place in them; null when no line has it. */
export function lineOfAddress(
  state: EditorState,
  addr: number,
): { readonly lineNo: number; readonly offset: number } | null {
  const lines = state.field(debugLinesField, false)?.lines
  if (lines === undefined) return null
  for (const cursor = lines.iter(); cursor.value !== null; cursor.next()) {
    if (cursor.value.holds(addr)) {
      return {
        lineNo: state.doc.lineAt(cursor.from).number,
        offset: (addr - cursor.value.addr) & 0xffff,
      }
    }
  }
  return null
}

/** The line the followed process stands on, as the editor shows it; null for none. */
export function ipLine(state: EditorState): number | null {
  const ip = state.field(debugLinesField, false)?.ip ?? null
  return ip === null ? null : (lineOfAddress(state, ip)?.lineNo ?? null)
}

const ipLineDecoration = Decoration.line({ class: 'cm-debug-ip' })

const ipDecorations = EditorView.decorations.compute([debugLinesField], (state): DecorationSet => {
  const line = ipLine(state)
  if (line === null) return Decoration.none
  return Decoration.set([ipLineDecoration.range(state.doc.line(line).from)])
})

/** A breakpoint's dot (filled when enabled), the IP's arrow, or both. */
class DebugMarker extends GutterMarker {
  readonly breakpoint: 'on' | 'off' | null
  readonly ip: boolean

  constructor(breakpoint: 'on' | 'off' | null, ip: boolean) {
    super()
    this.breakpoint = breakpoint
    this.ip = ip
  }

  override eq(other: GutterMarker): boolean {
    return (
      other instanceof DebugMarker && other.breakpoint === this.breakpoint && other.ip === this.ip
    )
  }

  override toDOM(): Node {
    const span = document.createElement('span')
    span.className = 'cm-debug-mark'
    if (this.breakpoint !== null) {
      span.dataset.breakpoint = this.breakpoint
      span.title = this.breakpoint === 'on' ? 'breakpoint' : 'breakpoint, off'
    }
    if (this.ip) span.dataset.ip = 'true'
    return span
  }
}

const MARKERS = {
  on: new DebugMarker('on', false),
  off: new DebugMarker('off', false),
  onIp: new DebugMarker('on', true),
  offIp: new DebugMarker('off', true),
  ip: new DebugMarker(null, true),
  /** A line with bytes and nothing on it: an element for the pointer's hint. */
  blank: new DebugMarker(null, false),
}

/**
 * The marker of the line at `from`: its breakpoint, and whether the process stands on it. A line
 * with no bytes has none: no breakpoint can go there.
 */
function markerOfLine(state: EditorState, from: number): DebugMarker | null {
  const line = markerAt(state, from)
  if (line === null) return null
  const { ip, breakpoints } = state.field(debugLinesField)
  let breakpoint: 'on' | 'off' | null = null
  for (const [addr, enabled] of breakpoints) {
    if (!line.holds(addr)) continue
    breakpoint = enabled ? 'on' : breakpoint === null ? 'off' : breakpoint
    if (enabled) break
  }
  const here = ip !== null && line.holds(ip)
  if (breakpoint === null) return here ? MARKERS.ip : MARKERS.blank
  if (breakpoint === 'on') return here ? MARKERS.onIp : MARKERS.on
  return here ? MARKERS.offIp : MARKERS.off
}

/** Where the gutter's width comes from. */
const SPACER = new DebugMarker(null, false)

const debugTheme = EditorView.theme({
  '.cm-debug-gutter .cm-gutterElement': {
    width: '14px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  '.cm-debug-mark': {
    position: 'relative',
    display: 'block',
    width: '8px',
    height: '8px',
  },
  // A faint dot under the pointer, on a line with bytes: the gutter takes a press.
  '.cm-debug-gutter .cm-gutterElement:hover .cm-debug-mark:not([data-breakpoint])::before': {
    content: '""',
    position: 'absolute',
    inset: '0',
    borderRadius: '50%',
    backgroundColor: 'var(--danger)',
    opacity: '0.35',
  },
  '.cm-debug-mark[data-breakpoint]::before': {
    content: '""',
    position: 'absolute',
    inset: '0',
    borderRadius: '50%',
    border: '1px solid var(--danger)',
  },
  '.cm-debug-mark[data-breakpoint="on"]::before': { backgroundColor: 'var(--danger)' },
  // The IP's arrow, over the dot when both are there.
  '.cm-debug-mark[data-ip]::after': {
    content: '""',
    position: 'absolute',
    top: '0',
    left: '1px',
    borderTop: '4px solid transparent',
    borderBottom: '4px solid transparent',
    borderLeft: '7px solid var(--text-bright)',
  },
  '.cm-line.cm-debug-ip': {
    backgroundColor: 'var(--accent-25)',
    boxShadow: 'inset 2px 0 0 var(--text-bright)',
  },
  // White is now (DESIGN_SYSTEM §1): the IP line's code is `--text-bright`, the one color that
  // holds its contrast on the accent fill in every theme (DESIGN_SYSTEM §8).
  '.cm-line.cm-debug-ip, .cm-line.cm-debug-ip *': { color: 'var(--text-bright)' },
})

/**
 * The debugger's part of the editor: the lines' addresses, the IP line, and the breakpoint gutter.
 * `onToggle` gets the line number of a press on the gutter.
 */
export function debugLines(onToggle: (lineNo: number) => void): Extension {
  return [
    debugLinesField,
    ipDecorations,
    gutter({
      class: 'cm-debug-gutter',
      lineMarker: (view, line) => markerOfLine(view.state, line.from),
      lineMarkerChange: (update) =>
        update.startState.field(debugLinesField) !== update.state.field(debugLinesField),
      initialSpacer: () => SPACER,
      domEventHandlers: {
        mousedown(view, line, event) {
          if ((event as MouseEvent).button !== 0) return false
          onToggle(view.state.doc.lineAt(line.from).number)
          return true
        },
      },
    }),
    debugTheme,
  ]
}
