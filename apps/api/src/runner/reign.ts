/**
 * The king's reign (PRODUCT_SPEC §5, the hill's king card): the challenges the entry at rank 1
 * has held it through. The Runner writes it with each board (`hill.ts`), and the launch seed with
 * its boards (`db/seed.ts`).
 */
import type { HillResult } from '@asmbots/tourney'

/** The king before a challenge: its entry's id, and its reign (null read as 0). */
export interface King {
  readonly id: string
  readonly reign: number | null
}

/**
 * The reign of the king on `result`'s board after `challengerId`'s challenge of a board whose
 * king was `before`: the old king still on top, or the challenger that replaced it (the same
 * bytes, a new version), reigns one challenge longer; a new king starts at 0, as does the first
 * king of an empty hill. null when the board is empty.
 */
export function kingReign(
  before: King | null,
  result: Pick<HillResult, 'state' | 'replaced'>,
  challengerId: string,
): number | null {
  const king = result.state.entries[0]
  if (king === undefined) return null
  if (before === null) return 0
  const stays =
    king.id === before.id || (king.id === challengerId && result.replaced?.id === before.id)
  return stays ? (before.reign ?? 0) + 1 : 0
}
