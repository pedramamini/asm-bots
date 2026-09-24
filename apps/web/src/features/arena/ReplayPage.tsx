import { useToast } from '@asmbots/ui'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Placeholder } from '../../app/Placeholder'
import { ArenaBattle } from './ArenaBattle'
import { downloadBlob, replayName } from './battle/files'
import { BattleLog } from './battle/log'
import { bytesProblem, type LocalReplay, readReplayFragment, replayUrl } from './battle/replay'
import { type BytesCheck, checkReplay, NO_RUN, type ReplayRun } from './battle/verify'
import { useArenaView } from './battle/view'
import type { ArenaFight } from './setup/bots'
import { copyLink } from './share'
import { ArenaClient, INITIAL_ARENA_STATE } from './worker/client'
import type { ArenaBot } from './worker/protocol'

export interface ReplayPageProps {
  /** The route's id. A replay link names its replay by the match key. */
  replayId: string
  /** Makes the client that plays the replay. Default: an `ArenaClient` and its Worker. */
  createClient?: (() => ArenaClient) | undefined
}

/** The Worker's client for one replay, and the log that reads it. */
interface Session {
  readonly client: ArenaClient
  readonly log: BattleLog
}

/** The action of a page with no replay to play. */
const OPEN_ARENA = { label: 'open the arena', to: '/arena' } as const

/**
 * `/arena/$replayId` (PRODUCT_SPEC §2): a replay in the arena's battle view. The replay comes in
 * the link's fragment, `#r=` (`battle/replay.ts`); it loads and plays at once. Its check's chip
 * says `verifying` until the rounds end, then `verified` when each round's result hash equals the
 * recorded one, or `mismatch` (`battle/verify.ts`). `share` copies the replay's link, `download
 * replay` saves the replay as it came, and `setup` goes to the arena's setup.
 *
 * TODO(EXEC 3.1): a link with no `#r=` loads the replay `replayId` from `/api/replays/:key`.
 */
export function ReplayPage({ replayId, createClient = () => new ArenaClient() }: ReplayPageProps) {
  const hash = useLocation({ select: (location) => location.hash })
  const read = useMemo(() => readReplayFragment(hash), [hash])
  const replay = read.kind === 'ok' ? read.replay : null
  const bots = read.kind === 'ok' ? read.bots : null
  const navigate = useNavigate()
  const { toast } = useToast()
  const make = useRef(createClient)
  make.current = createClient
  const [session, setSession] = useState<Session | null>(null)
  const [run, setRun] = useState<ReplayRun>(NO_RUN)
  const [bytes, setBytes] = useState<BytesCheck>('pending')

  // One client per replay: its Worker ends with the replay, or the page.
  useEffect(() => {
    if (replay === null || bots === null) return
    const client = make.current()
    const log = new BattleLog()
    log.attach(client)
    setRun(NO_RUN)
    client.on('loaded', ({ match }) => setRun((last) => ({ ...last, key: match.key })))
    client.on('ended', ({ round, hash }) =>
      setRun((last) => ({ ...last, hashes: new Map(last.hashes).set(round, hash) })),
    )
    client.on('error', ({ request, message }) => {
      // A load, a round, or the Worker failed: the replay did not run. Others leave it running.
      if (request === 'load' || request === 'setRound' || request === null) {
        setRun((last) => ({ ...last, error: message }))
      }
    })
    useArenaView.getState().clearIsolation()
    client.load(bots, replay.config, replay.rounds)
    client.play()
    setSession({ client, log })
    return () => {
      client.dispose()
      client.store.setState({ ...INITIAL_ARENA_STATE })
      setSession(null)
    }
  }, [replay, bots])

  useEffect(() => {
    setBytes('pending')
    if (replay === null) return
    let live = true
    void bytesProblem(replay).then((problem) => {
      if (live) setBytes(problem === null ? 'ok' : { problem })
    })
    return () => {
      live = false
    }
  }, [replay])

  const fight = useMemo(
    () => (replay === null || bots === null ? null : replayFight(replay, bots)),
    [replay, bots],
  )

  if (read.kind === 'none') {
    return (
      <Placeholder title="replay" status={replayId} action={OPEN_ARENA}>
        this link carries no replay. at a battle's end, replay link copies one.
      </Placeholder>
    )
  }
  if (read.kind === 'broken') {
    return (
      <Placeholder title="replay" status={replayId} action={OPEN_ARENA}>
        this replay link is broken: {read.reason}.
      </Placeholder>
    )
  }
  if (session === null || fight === null) return null
  const { replay: loaded } = read

  const rematch = () => {
    useArenaView.getState().clearIsolation()
    session.client.load(fight.bots, fight.config, fight.rounds)
    session.client.play()
  }

  const download = () => {
    const blob = new Blob([`${JSON.stringify(loaded, null, 2)}\n`], { type: 'application/json' })
    downloadBlob(
      blob,
      replayName(
        loaded.bots.map((bot) => bot.name),
        loaded.config.seed,
      ),
    )
  }

  return (
    <ArenaBattle
      client={session.client}
      log={session.log}
      fight={fight}
      onExit={() => void navigate({ to: '/arena' })}
      onRematch={rematch}
      replay={{
        check: checkReplay(loaded, run, bytes),
        onShare: () =>
          void copyLink(replayUrl(window.location.origin, loaded), toast, 'replay link copied.'),
        onDownload: download,
      }}
    />
  )
}

/** A replay as the arena fights it. Its bots are bytes, not refs: it has no setup to show. */
function replayFight(replay: LocalReplay, bots: readonly ArenaBot[]): ArenaFight {
  const { maxCycles, maxProcesses, minSpacing, seed } = replay.config
  return {
    bots,
    config: replay.config,
    rounds: replay.rounds,
    spec: {
      bots: [],
      config: { preset: null, rounds: replay.rounds, maxCycles, maxProcesses, minSpacing, seed },
    },
    sources: replay.bots.map((bot) => bot.source ?? ''),
    shared: [],
  }
}
