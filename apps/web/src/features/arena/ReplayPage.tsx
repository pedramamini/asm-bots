import { bytesProblem, replayConfig, SHA256 } from '@asmbots/protocol'
import { Panel, PanelGrid, RadarLoader, useToast } from '@asmbots/ui'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { isNotFound } from '../../api/client'
import { useReplay } from '../../api/queries'
import { storeReplay } from '../../api/writes'
import { LoadFailure } from '../../app/LoadFailure'
import { Placeholder } from '../../app/Placeholder'
import { embedUrl } from '../share/share'
import { ArenaBattle } from './ArenaBattle'
import { downloadBlob, replayName } from './battle/files'
import { BattleLog } from './battle/log'
import {
  type ReplayRead,
  readReplayFragment,
  readReplayValue,
  replayFight,
  replayUrl,
} from './battle/replay'
import { type BytesCheck, checkReplay, NO_RUN, type ReplayRun } from './battle/verify'
import { useArenaView } from './battle/view'
import { copyLink } from './share'
import { ArenaClient, INITIAL_ARENA_STATE } from './worker/client'

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
 * the link's fragment, `#r=` (`battle/replay.ts`), or, for a link with none whose id is a replay
 * key (a SHA-256), from the server's store (`GET /api/replays/:key`); it loads and plays at once. Its check's chip
 * says `verifying` until the rounds end, then `verified` when each round's result hash equals the
 * recorded one, or `mismatch` (`battle/verify.ts`). `share` copies the replay's link: a stored
 * replay's is its page alone; a linked one is stored first (`POST /api/replays`) for the same short
 * link, or keeps its `#r=` link when the server does not take it. `download replay` saves the
 * replay as it came, and `setup` goes to the arena's setup.
 */
export function ReplayPage({ replayId, createClient = () => new ArenaClient() }: ReplayPageProps) {
  const hash = useLocation({ select: (location) => location.hash })
  const linked = useMemo(() => readReplayFragment(hash), [hash])
  // No replay in the link: a replay key names one the server stores.
  const stored = linked.kind === 'none' && SHA256.test(replayId) ? replayId : null
  const fetched = useReplay(stored)
  const read = useMemo(
    (): ReplayRead =>
      stored === null || fetched.data === undefined ? linked : readReplayValue(fetched.data),
    [linked, stored, fetched.data],
  )
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
    client.load(bots, replayConfig(replay), replay.rounds)
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

  if (read.kind === 'none' && stored !== null) {
    if (isNotFound(fetched.error)) {
      return (
        <Placeholder title="replay" status={replayId} action={OPEN_ARENA}>
          the server has no replay with this key.
        </Placeholder>
      )
    }
    if (fetched.error !== null) {
      return (
        <PanelGrid className="p-3">
          <Panel className="col-span-12" title="replay" status={replayId}>
            <LoadFailure read={fetched} what="this replay" />
          </Panel>
        </PanelGrid>
      )
    }
    return (
      <PanelGrid className="p-3">
        <Panel className="col-span-12" title="replay" status={replayId}>
          <div className="grid h-80 place-items-center">
            <RadarLoader label="loading the replay" />
          </div>
        </Panel>
      </PanelGrid>
    )
  }
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

  const share = async () => {
    const origin = window.location.origin
    const key =
      stored ??
      (await storeReplay(loaded).then(
        (answer) => answer.key,
        () => null,
      ))
    const url = key === null ? replayUrl(origin, loaded) : `${origin}/arena/${key}`
    await copyLink(url, toast, 'replay link copied.')
  }

  const download = () => {
    const blob = new Blob([`${JSON.stringify(loaded, null, 2)}\n`], { type: 'application/json' })
    downloadBlob(
      blob,
      replayName(
        loaded.bots.map((bot) => bot.name),
        loaded.seed,
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
        onShare: () => void share(),
        // A stored replay's embed loads it from the server; a linked one carries it along.
        embed: embedUrl(
          stored === null
            ? replayUrl(window.location.origin, loaded)
            : `${window.location.origin}/arena/${stored}`,
        ),
        onDownload: download,
      }}
    />
  )
}
