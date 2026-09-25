/**
 * The arena in words (DESIGN_SYSTEM §8): a polite live region that says where the battle stands
 * every 2 s while it plays, `cycle 12,480; 3 bots alive; dwarf-v3 leads footprint`. The HUD and
 * the rail show the same to the eye; a paused or finished battle says nothing more (the victory
 * says who won).
 */
import { useEffect, useState } from 'react'
import { useStore } from 'zustand'
import type { ArenaClient, ArenaState } from '../worker/client'
import { STAT_FIELDS, STAT_FOOTPRINT } from '../worker/protocol'

/** How often the live region speaks while the battle plays, ms. */
export const ANNOUNCE_MS = 2000

const count = (n: number) => n.toLocaleString('en-US')

/** Where the battle stands, in one line: the cycle, the bots alive, and who owns the most core. */
export function arenaSummary(
  state: Pick<ArenaState, 'cycle' | 'alive' | 'stats' | 'botMeta'>,
): string {
  const parts = [
    `cycle ${count(state.cycle)}`,
    `${state.alive} ${state.alive === 1 ? 'bot' : 'bots'} alive`,
  ]
  let leader = -1
  let most = 0
  state.botMeta.forEach((_, i) => {
    const footprint = state.stats[i * STAT_FIELDS + STAT_FOOTPRINT] ?? 0
    if (footprint > most) {
      most = footprint
      leader = i
    }
  })
  const name = state.botMeta[leader]?.name
  if (name !== undefined) parts.push(`${name} leads footprint`)
  return parts.join('; ')
}

/** The live region: hidden from sight, it speaks every `every` ms while `client` plays. */
export function Announcer({
  client,
  every = ANNOUNCE_MS,
}: {
  client: ArenaClient
  every?: number | undefined
}) {
  const playing = useStore(client.store, (state) => state.status === 'playing')
  const [line, setLine] = useState('')
  useEffect(() => {
    if (!playing) return
    const timer = setInterval(() => setLine(arenaSummary(client.store.getState())), every)
    return () => clearInterval(timer)
  }, [client, playing, every])
  return (
    <p role="status" className="sr-only">
      {line}
    </p>
  )
}
