/** `verify` on a server tournament's match (ARCHITECTURE §7, verification model). */
import type { MatchResult } from '@asmbots/tourney'
import type { ReactNode } from 'react'
import { VerifyMatch } from '../verify/VerifyMatch'
import { serverMatchId } from './server'
import type { Tournament } from './store'

/**
 * `verify` for `result`, a match of `t` labeled `label` (`Dwarf v Imp · match 3`), when the server
 * played it and it has ended; nothing for a local tournament's match, or one still playing.
 */
export function matchVerify(t: Tournament, result: MatchResult | null, label: string): ReactNode {
  const id = serverMatchId(t, result)
  return id === null ? null : <VerifyMatch key={id} id={id} label={label} />
}
