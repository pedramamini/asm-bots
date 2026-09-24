/**
 * The listing gutter (PRODUCT_SPEC §3): each line's address and bytes, `0x000D  C7 05 00 00`,
 * from the last assemble without errors. The markers are made when such an assemble comes in and
 * mapped through every edit after it, so they stay on their lines while the source changes; a line
 * typed since has none until the next assemble. The field keeps the markers whether the gutter
 * shows or not; `setListingVisible` shows and hides it (the `l` key).
 */
import type { Assembled, ListingLine } from '@asmbots/asm'
import { hexAddress } from '@asmbots/ui'
import { Compartment, type EditorState, MapMode, RangeSet, StateField } from '@codemirror/state'
import { type EditorView, GutterMarker, gutter } from '@codemirror/view'
import { setAssembled } from './assembled'

/** The most bytes a line shows; a longer line ends in `…`, and its tooltip has the rest. */
export const LISTING_BYTES = 4

/** The most bytes a line's tooltip lists: a `times 600 nop` line need not list them all. */
const TITLE_BYTES = 32

/** A line's gutter text: its address and first bytes. Null for a line with no bytes. */
export function listingText(line: ListingLine): string | null {
  if (line.bytes.length === 0) return null
  const shown = line.bytesHex.split(' ').slice(0, LISTING_BYTES).join(' ')
  const more = line.bytes.length > LISTING_BYTES ? '…' : ''
  return `${hexAddress(line.address)}  ${shown}${more}`
}

/** The text that sets the gutter's width: an address and a full row of bytes. */
const SPACER = `${hexAddress(0)}  ${Array(LISTING_BYTES).fill('00').join(' ')}…`

class ListingMarker extends GutterMarker {
  readonly text: string
  readonly title: string

  constructor(text: string, title: string) {
    super()
    this.text = text
    this.title = title
  }

  override eq(other: GutterMarker): boolean {
    return other instanceof ListingMarker && other.text === this.text && other.title === this.title
  }

  override toDOM(): Node {
    const span = document.createElement('span')
    span.textContent = this.text
    if (this.title !== '') span.title = this.title
    return span
  }
}

// Dropped with its line: a marker goes when the text after it goes, so deleting a line takes its
// marker, and the next line's marker, which lands at the same place, is the one that stays.
ListingMarker.prototype.mapMode = MapMode.TrackAfter

/** The markers of `bot`'s listing, at the start of each line of `state` that has bytes. */
function markersOf(bot: Assembled, state: EditorState): RangeSet<GutterMarker> {
  const ranges = []
  for (const line of bot.listing) {
    const text = listingText(line)
    if (text === null || line.lineNo > state.doc.lines) continue
    const long = line.bytes.length > LISTING_BYTES
    const title = long
      ? `${line.bytes.length} bytes: ${line.bytesHex.split(' ').slice(0, TITLE_BYTES).join(' ')}${
          line.bytes.length > TITLE_BYTES ? ' …' : ''
        }`
      : ''
    ranges.push(new ListingMarker(text, title).range(state.doc.line(line.lineNo).from))
  }
  return RangeSet.of(ranges)
}

/** The listing's markers: rebuilt by each assemble without errors, mapped through each edit. */
export const listingField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(markers, tr) {
    let next = tr.docChanged ? markers.map(tr.changes) : markers
    for (const effect of tr.effects) {
      if (
        effect.is(setAssembled) &&
        !effect.value.diagnostics.some((d) => d.severity === 'error')
      ) {
        next = markersOf(effect.value, tr.state)
      }
    }
    return next
  },
})

/** The marker at the very start of the line at `from`, if any: one per line. */
function markerAt(state: EditorState, from: number): GutterMarker | null {
  let found: GutterMarker | null = null
  state.field(listingField).between(from, from, (at, _to, marker) => {
    if (at !== from) return
    found = marker
    return false
  })
  return found
}

const listingGutter = gutter({
  class: 'cm-listing-gutter',
  lineMarker: (view, line) => markerAt(view.state, line.from),
  lineMarkerChange: (update) =>
    update.startState.field(listingField) !== update.state.field(listingField),
  initialSpacer: () => new ListingMarker(SPACER, ''),
})

const listingCompartment = new Compartment()

/** The listing: its field, and its gutter when `visible`. */
export function listing(visible: boolean) {
  return [listingField, listingCompartment.of(visible ? listingGutter : [])]
}

/** Shows or hides the listing gutter of `view`; the markers stay current either way. */
export function setListingVisible(view: EditorView, visible: boolean): void {
  view.dispatch({ effects: listingCompartment.reconfigure(visible ? listingGutter : []) })
}

/** The gutter texts of `state`'s lines, by line number: what the listing gutter shows. */
export function listingTexts(state: EditorState): Map<number, string> {
  const texts = new Map<number, string>()
  for (let n = 1; n <= state.doc.lines; n++) {
    const marker = markerAt(state, state.doc.line(n).from)
    if (marker instanceof ListingMarker) texts.set(n, marker.text)
  }
  return texts
}
