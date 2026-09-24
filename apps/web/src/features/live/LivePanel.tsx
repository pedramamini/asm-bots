/**
 * A room's live panel (PRODUCT_SPEC §4, §5): the `LIVE` chip, the spectator count, and
 * `auto-watch`. With auto-watch on, each match a `Runner` starts runs in the arena here
 * (`LiveArena.tsx`), and its chip checks it against the server's result. The arena's code loads
 * with the first match to watch, and stays: the match on screen plays out after its job ends.
 */
import { Button, Panel, Toggle } from '@asmbots/ui'
import { RotateCw } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { useMotionReduced } from '../../store/settings'
import type { ArenaClient } from '../arena/worker/client'
import { count } from '../hills/links'
import { LiveChip, SpectatorCount } from './LiveChip'
import { currentMatch, type LiveMatchEntry, type LiveRoomState, matchLabel, roomBusy } from './room'

const LiveArena = lazy(() => import('./LiveArena').then((m) => ({ default: m.LiveArena })))

/** How long a match rests on screen after its last round, ms: time to read its check. */
export const LIVE_DWELL_MS = 2000
/** How long a round's end stays before the next round, ms. */
export const ROUND_REST_MS = 300

export interface LivePanelProps {
  /** The room, as `useLiveRoom` reads it. */
  live: LiveRoomState
  /** Makes the arena's client. Default: an `ArenaClient` with a store of its own. */
  createClient?: (() => ArenaClient) | undefined
  /** Rest after a match's last round, and between rounds, ms. */
  dwell?: number | undefined
  rest?: number | undefined
  className?: string | undefined
}

export function LivePanel({
  live,
  createClient,
  dwell = LIVE_DWELL_MS,
  rest = ROUND_REST_MS,
  className,
}: LivePanelProps) {
  const reduced = useMotionReduced()
  // Auto-watch runs the arena: under reduced motion it waits to be asked.
  const [autoWatch, setAutoWatch] = useState(!reduced)
  const current = currentMatch(live)
  // The arena comes with the first match to watch, and goes when auto-watch does.
  const [armed, setArmed] = useState(false)
  if (autoWatch && current !== null && !armed) setArmed(true)
  if (!autoWatch && armed) setArmed(false)
  const progress = current === null ? undefined : live.jobs.get(current.job)
  const status =
    progress === undefined
      ? 'quiet'
      : `match ${count(Math.min(progress.done + 1, progress.of))} of ${count(progress.of)}`
  const quiet = <Quiet live={live} current={current} autoWatch={autoWatch} />
  return (
    <Panel
      className={className}
      title="live"
      status={status}
      actions={
        <>
          <LiveChip status={live.status} busy={roomBusy(live)} />
          <SpectatorCount count={live.spectators} />
          <Toggle pressed={autoWatch} onPressedChange={setAutoWatch}>
            auto-watch
          </Toggle>
        </>
      }
    >
      {live.status === 'outdated' ? (
        <div className="flex flex-wrap items-center gap-2 text-data">
          <p className="text-muted">this page is older than the site: reload it to watch.</p>
          <Button size="sm" icon={RotateCw} onClick={() => window.location.reload()}>
            reload
          </Button>
        </div>
      ) : armed ? (
        <Suspense fallback={quiet}>
          <LiveArena
            live={live}
            current={current}
            createClient={createClient}
            dwell={dwell}
            rest={rest}
            fallback={quiet}
          />
        </Suspense>
      ) : (
        quiet
      )}
    </Panel>
  )
}

/** What the panel says with no arena: the match being fought, or that none is. */
function Quiet({
  live,
  current,
  autoWatch,
}: {
  live: LiveRoomState
  current: LiveMatchEntry | null
  autoWatch: boolean
}) {
  if (live.status === 'connecting') {
    return <p className="text-data text-muted">joining the live room…</p>
  }
  if (current === null) {
    return (
      <p className="text-data text-muted">
        quiet: no match is running. the next one to start shows here.
      </p>
    )
  }
  return (
    <p className="text-data">
      fighting: <span className="text-bright">{matchLabel(current.match)}</span>
      {!autoWatch && <span className="text-muted">. turn on auto-watch to run it here.</span>}
    </p>
  )
}
