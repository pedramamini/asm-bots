/**
 * A tournament's live controls (PRODUCT_SPEC §4): its status chip (`running · 12 / 66`, pulsing
 * while it runs), `start`, `pause`, `resume`, and `cancel` as its status allows, and the
 * `auto-watch` toggle. With auto-watch on, each match the runner starts opens in the arena at max
 * speed, rebuilt from its inputs (`liveWatchTarget`), while the runner plays it headless; a match
 * that starts while one is still on screen is skipped. Closing the arena turns auto-watch off.
 */
import { Button, Chip, cx, Toggle } from '@asmbots/ui'
import { Pause, Play, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useMotionReduced } from '../../store/settings'
import { type TournamentRunner, tournamentRunner } from './runner'
import type { Tournament } from './store'
import { STATUS_VARIANT, statusLabel } from './TournamentsPage'
import { WatchModal } from './WatchModal'
import { liveWatchTarget, type WatchTarget } from './watch'

export interface TournamentControlsProps {
  tournament: Tournament
  /** The runner the controls drive. Default: the page's. */
  runner?: TournamentRunner | undefined
  /** Makes the auto-watch arena client; tests pass a stand-in. */
  createClient?: Parameters<typeof WatchModal>[0]['createClient']
}

/** The status chip: `running · 12 / 66`, pulsing while it runs unless motion is reduced. */
export function StatusChip({ tournament: t }: { tournament: Tournament }) {
  const reduced = useMotionReduced()
  const running = t.status === 'running'
  return (
    <Chip
      variant={STATUS_VARIANT[t.status]}
      data-live={running ? 'true' : undefined}
      className={cx(running && !reduced && 'animate-skeleton')}
    >
      {statusLabel(t)}
    </Chip>
  )
}

export function TournamentControls({
  tournament: t,
  runner = tournamentRunner(),
  createClient,
}: TournamentControlsProps) {
  const [autoWatch, setAutoWatch] = useState(false)
  const [watching, setWatching] = useState<{ target: WatchTarget; ended: boolean } | null>(null)
  // The subscription reads the record and the watch as they are when a match starts.
  const current = useRef({ t, watching })
  current.current = { t, watching }

  useEffect(() => {
    if (!autoWatch) return
    return runner.subscribe((event) => {
      const { t: now, watching: shown } = current.current
      if (event.type !== 'match' || event.id !== now.id) return
      if (shown !== null && !shown.ended) return
      try {
        setWatching({ target: liveWatchTarget(now, event.entrants, event.round), ended: false })
      } catch {
        // A bot the runner could load but this page cannot: the runner reports it when it fails.
      }
    })
  }, [autoWatch, runner])

  const { id, status } = t
  const running = status === 'running'
  const canCancel = running || status === 'scheduled' || status === 'paused' || status === 'failed'
  const start = () => {
    void runner.start(id)
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusChip tournament={t} />
      {status === 'scheduled' && (
        <Button size="sm" variant="primary" icon={Play} onClick={start}>
          start
        </Button>
      )}
      {running && (
        <Button size="sm" icon={Pause} onClick={() => void runner.pause(id)}>
          pause
        </Button>
      )}
      {(status === 'paused' || status === 'failed') && (
        <Button size="sm" icon={Play} onClick={start}>
          resume
        </Button>
      )}
      {canCancel && (
        <Button size="sm" variant="ghost" icon={Square} onClick={() => void runner.cancel(id)}>
          cancel
        </Button>
      )}
      {status === 'failed' && t.error !== undefined && (
        <span className="text-data text-danger">{t.error}</span>
      )}
      <Toggle
        pressed={autoWatch}
        onPressedChange={setAutoWatch}
        disabled={status === 'finished' || status === 'cancelled'}
      >
        auto-watch
      </Toggle>
      <WatchModal
        target={watching?.target ?? null}
        speed="max"
        createClient={createClient}
        onEnded={() => setWatching((w) => (w === null ? null : { ...w, ended: true }))}
        onClose={() => {
          setWatching(null)
          setAutoWatch(false)
        }}
      />
    </div>
  )
}
