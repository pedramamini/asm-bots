/**
 * The live panel's arena (PRODUCT_SPEC §4): each match a `Runner` starts, built from the inputs
 * the room sent and played here at max speed, its rounds one after another: the battle the server
 * is running. When the server's row comes, the chip checks each round's result hash against this
 * page's run (`check.ts`). A match that starts while one is on screen waits; once the one on screen
 * has played and rested, the arena takes the room's latest. `LivePanel` loads this module with the
 * first match to watch, so a quiet room loads no arena.
 */
import { bytesProblem, type LiveMatch, replayBots } from '@asmbots/protocol'
import { HueSwatch } from '@asmbots/ui'
import { Link } from '@tanstack/react-router'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { ArenaCanvas } from '../arena/ArenaCanvas'
import { ReplayChip } from '../arena/battle/ReplayChip'
import { type BytesCheck, NO_RUN, type ReplayRun } from '../arena/battle/verify'
import { ArenaClient, createArenaStore } from '../arena/worker/client'
import { CELL_LINK, count } from '../hills/links'
import { liveCheck } from './check'
import { type LiveMatchEntry, type LiveRoomState, matchLabel } from './room'

const newClient = () => new ArenaClient({ store: createArenaStore() })

export interface LiveArenaProps {
  live: LiveRoomState
  /** The match to watch: `currentMatch(live)`. */
  current: LiveMatchEntry | null
  /** Makes the arena's client. Default: an `ArenaClient` with a store of its own. */
  createClient?: (() => ArenaClient) | undefined
  /** Rest after a match's last round, and between rounds, ms. */
  dwell: number
  rest: number
  /** Shown until the first match is on screen. */
  fallback: ReactNode
}

/** Its Worker starts with the first match, and ends with the arena. */
export function LiveArena({
  live,
  current,
  createClient = newClient,
  dwell,
  rest,
  fallback,
}: LiveArenaProps) {
  const make = useRef(createClient)
  make.current = createClient
  const made = useRef<ArenaClient | null>(null)
  const [client, setClient] = useState<ArenaClient | null>(null)
  const [shown, setShown] = useState<LiveMatch | null>(null)
  /** The match on screen has played and rested: the next may come. */
  const [free, setFree] = useState(true)
  const [run, setRun] = useState<ReplayRun>(NO_RUN)
  const [bytes, setBytes] = useState<BytesCheck>('pending')

  useEffect(
    () => () => {
      made.current?.dispose()
      made.current = null
    },
    [],
  )

  useEffect(() => {
    if (current === null || !free || current.match.id === shown?.id) return
    setShown(current.match)
  }, [current, free, shown])

  useEffect(() => {
    if (shown === null) return
    let arena = made.current
    if (arena === null) {
      arena = make.current()
      arena.speed('max')
      made.current = arena
    }
    const c = arena
    setClient(c)
    setFree(false)
    setRun(NO_RUN)
    let timer: ReturnType<typeof setTimeout> | undefined
    const later = (ms: number, then: () => void) => {
      timer = setTimeout(then, ms)
    }
    const offs = [
      c.on('loaded', ({ match }) => setRun((last) => ({ ...last, key: match.key }))),
      c.on('ended', ({ round, hash }) => {
        setRun((last) => ({ ...last, hashes: new Map(last.hashes).set(round, hash) }))
        if (round + 1 < shown.rounds) {
          later(rest, () => {
            c.setRound(round + 1)
            c.play()
          })
        } else {
          later(dwell, () => setFree(true))
        }
      }),
      c.on('error', ({ request, message }) => {
        // A load, a round, or the Worker failed: the match did not run. Others leave it running.
        if (request !== 'load' && request !== 'setRound' && request !== null) return
        setRun((last) => ({ ...last, error: message }))
        later(dwell, () => setFree(true))
      }),
    ]
    c.load(replayBots(shown), { ...shown.config, seed: shown.seed }, shown.rounds)
    c.play()
    return () => {
      for (const off of offs) off()
      clearTimeout(timer)
    }
  }, [shown, dwell, rest])

  useEffect(() => {
    setBytes('pending')
    if (shown === null) return
    let on = true
    void bytesProblem(shown).then((problem) => {
      if (on) setBytes(problem === null ? 'ok' : { problem })
    })
    return () => {
      on = false
    }
  }, [shown])

  if (shown === null || client === null) return fallback
  const result = live.matches.find((m) => m.match.id === shown.id)?.result ?? null
  return (
    <div className="flex flex-col gap-2" data-live-match={shown.id}>
      <div className="relative aspect-square w-full overflow-hidden rounded-md bg-black">
        <ArenaCanvas
          client={client}
          minimap={false}
          interactive={false}
          label={`live arena: ${matchLabel(shown)}`}
          className="size-full"
        />
      </div>
      <LiveBar client={client} match={shown}>
        <ReplayChip check={liveCheck(shown, result, run, bytes)} />
        {result !== null && result.replayKey !== null && (
          <Link to="/arena/$replayId" params={{ replayId: result.replayKey }} className={CELL_LINK}>
            watch
          </Link>
        )}
      </LiveBar>
    </div>
  )
}

/** Under the arena: the bots in their hues, the round, the cycle, then the check. */
function LiveBar({
  client,
  match,
  children,
}: {
  client: ArenaClient
  match: LiveMatch
  children: ReactNode
}) {
  const round = useStore(client.store, (state) => state.round)
  const cycle = useStore(client.store, (state) => state.cycle)
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-data">
      <ul aria-label="bots" className="flex min-w-0 flex-wrap items-center gap-3">
        {match.bots.map((bot, i) => (
          <li key={`${i}-${bot.name}`} className="flex min-w-0 items-center gap-1">
            <HueSwatch hue={i} size={10} />
            <span className="truncate">{bot.name}</span>
          </li>
        ))}
      </ul>
      <span className="text-muted tabular-nums">
        round {round + 1}/{match.rounds} · cycle {count(cycle)}
      </span>
      <span className="ml-auto flex items-center gap-2">{children}</span>
    </div>
  )
}
