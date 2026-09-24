/**
 * A round of a tournament's match, replayed in the arena in a modal (PRODUCT_SPEC §4): the round's
 * bots in fighting order with the round's seed (`watch.ts`), playing from the start. Play and
 * pause, `restart` (the round loaded again), the cycle, a legend of the bots, and the check:
 * `verified` once the battle's result hash equals the recorded one, `mismatch` when it does not,
 * `ended` for a live round, which has no recorded hash yet.
 */
import { parseReplay } from '@asmbots/protocol'
import type { MatchResult, MatchRound } from '@asmbots/tourney'
import { Button, Chip, HueSwatch, IconButton, Modal, useToast } from '@asmbots/ui'
import { Pause, Play, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { apiGet } from '../../api/client'
import { ArenaCanvas } from '../arena/ArenaCanvas'
import { ArenaClient, createArenaStore } from '../arena/worker/client'
import type { Speed } from '../arena/worker/protocol'
import type { Tournament } from './store'
import { replayWatchTarget, type WatchTarget, watchTarget } from './watch'

export interface WatchModalProps {
  /** The round to show; null closes the modal. */
  target: WatchTarget | null
  onClose: () => void
  /** The speed it plays at. Default: the arena's. */
  speed?: Speed | undefined
  /** Makes the client. Default: an `ArenaClient` with a store of its own. */
  createClient?: (() => ArenaClient) | undefined
  /** The round shown has ended. */
  onEnded?: (() => void) | undefined
}

/**
 * `pending` until the round ends, then whether its hash is the recorded one; `ended` when there
 * is none to check.
 */
export type WatchCheck = 'pending' | 'verified' | 'mismatch' | 'ended'

const newClient = () => new ArenaClient({ store: createArenaStore() })

/**
 * The round a view's `WatchModal` shows: `watch` opens a round of a played match (`watchTarget`),
 * or toasts why it cannot (a bot gone or broken); `close` closes it. A server tournament's round
 * opens once its match's replay has loaded (`replayWatchTarget`).
 */
export function useRoundWatch() {
  const { toast } = useToast()
  const [target, setTarget] = useState<WatchTarget | null>(null)
  // The last round asked for: a replay that loads after another ask, or a close, is dropped.
  const asked = useRef(0)
  const watch = useCallback(
    (t: Tournament, entrants: readonly number[], result: MatchResult, round: MatchRound) => {
      const ask = ++asked.current
      const refuse = (error: unknown) => {
        const why = error instanceof Error ? error.message : String(error)
        toast(`cannot watch: ${why}.`, { variant: 'danger' })
      }
      if (t.replays === undefined) {
        try {
          setTarget(watchTarget(t, entrants, result, round))
        } catch (error) {
          refuse(error)
        }
        return
      }
      const key = t.replays[result.key]
      if (key === undefined) {
        refuse('the server has not stored this match')
        return
      }
      apiGet(`/replays/${encodeURIComponent(key)}`, parseReplay).then((replay) => {
        if (ask === asked.current) setTarget(replayWatchTarget(replay, result, round))
      }, refuse)
    },
    [toast],
  )
  const close = useCallback(() => {
    asked.current++
    setTarget(null)
  }, [])
  return { target, watch, close }
}

const count = (n: number) => n.toLocaleString('en-US')

export function WatchModal({
  target,
  onClose,
  speed,
  createClient = newClient,
  onEnded,
}: WatchModalProps) {
  return (
    <Modal open={target !== null} onClose={onClose} title={target?.label ?? 'watch'} size="lg">
      {target !== null && (
        <Watch target={target} speed={speed} createClient={createClient} onEnded={onEnded} />
      )}
    </Modal>
  )
}

function Watch({
  target,
  speed,
  createClient,
  onEnded,
}: {
  target: WatchTarget
  speed: Speed | undefined
  createClient: () => ArenaClient
  onEnded: (() => void) | undefined
}) {
  const make = useRef(createClient)
  const ended = useRef(onEnded)
  ended.current = onEnded
  const [client, setClient] = useState<ArenaClient | null>(null)
  const [check, setCheck] = useState<WatchCheck>('pending')

  useEffect(() => {
    const made = make.current()
    setCheck('pending')
    made.on('ended', ({ hash }) => {
      const expected = target.resultHash
      setCheck(expected === undefined ? 'ended' : hash === expected ? 'verified' : 'mismatch')
      ended.current?.()
    })
    if (speed !== undefined) made.speed(speed)
    made.load(target.bots, target.config, 1)
    made.play()
    setClient(made)
    return () => {
      made.dispose()
      setClient(null)
    }
  }, [target, speed])

  if (client === null) return null
  return (
    <div className="flex flex-col gap-2">
      <div className="relative aspect-square w-full overflow-hidden rounded-md bg-black">
        <ArenaCanvas
          client={client}
          minimap={false}
          label={`arena: ${target.label}`}
          className="size-full"
        />
      </div>
      <WatchBar
        client={client}
        target={target}
        check={check}
        onRestart={() => {
          setCheck('pending')
          client.load(target.bots, target.config, 1)
          client.play()
        }}
      />
    </div>
  )
}

function WatchBar({
  client,
  target,
  check,
  onRestart,
}: {
  client: ArenaClient
  target: WatchTarget
  check: WatchCheck
  onRestart: () => void
}) {
  const status = useStore(client.store, (state) => state.status)
  const cycle = useStore(client.store, (state) => state.cycle)
  const playing = status === 'playing'
  return (
    <div className="flex flex-wrap items-center gap-2 text-data">
      <IconButton
        icon={playing ? Pause : Play}
        label={playing ? 'pause' : 'play'}
        disabled={status !== 'playing' && status !== 'paused'}
        onClick={() => (playing ? client.pause() : client.play())}
      />
      <Button
        variant="ghost"
        size="sm"
        icon={RotateCcw}
        disabled={status === 'loading' || status === 'idle'}
        onClick={onRestart}
      >
        restart
      </Button>
      <span className="text-muted tabular-nums">cycle {count(cycle)}</span>
      <ul aria-label="bots" className="flex flex-wrap items-center gap-3">
        {target.bots.map((bot, i) => (
          <li key={`${i}-${bot.name}`} className="flex items-center gap-1">
            <HueSwatch hue={i} size={10} />
            <span>{bot.name}</span>
          </li>
        ))}
      </ul>
      <span className="ml-auto">
        {check === 'pending' ? (
          <Chip>{status === 'error' ? 'did not load' : 'playing'}</Chip>
        ) : check === 'verified' ? (
          <Chip variant="accent">verified</Chip>
        ) : check === 'ended' ? (
          <Chip>ended</Chip>
        ) : (
          <Chip variant="danger">mismatch</Chip>
        )}
      </span>
    </div>
  )
}
