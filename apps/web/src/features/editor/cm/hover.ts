/**
 * Hover on a mnemonic or a prefix: its reference card (card.ts), above the word.
 */
import type { Text } from '@codemirror/state'
import { hoverTooltip, type Tooltip } from '@codemirror/view'
import { opcodeCard } from './card'
import { opcodeEntry } from './opcodes'
import { scanLine } from './x16c'

/**
 * The card of the mnemonic or prefix at `pos`, or null. `side` is -1 when the pointer is before
 * `pos` (the end of a word) and 1 when after (its start), as `hoverTooltip` passes it.
 */
export function opcodeTooltipAt(doc: Text, pos: number, side: -1 | 1): Tooltip | null {
  const line = doc.lineAt(pos)
  const at = pos - line.from
  const token = scanLine(line.text).find(
    (t) => t.from <= at && at <= t.to && !(t.from === at && side < 0) && !(t.to === at && side > 0),
  )
  if (token === undefined || (token.type !== 'mnemonic' && token.type !== 'prefix')) return null
  const entry = opcodeEntry(line.text.slice(token.from, token.to))
  if (entry === undefined) return null
  return {
    pos: line.from + token.from,
    end: line.from + token.to,
    above: true,
    create: () => ({ dom: opcodeCard(entry) }),
  }
}

export const x16cHover = hoverTooltip((view, pos, side) =>
  opcodeTooltipAt(view.state.doc, pos, side),
)
