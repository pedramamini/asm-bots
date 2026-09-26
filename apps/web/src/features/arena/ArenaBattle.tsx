import type { MatchResult } from '@asmbots/tourney'
import { Button, Panel, PanelGrid, useMediaQuery, useToast, WIDE } from '@asmbots/ui'
import { useNavigate } from '@tanstack/react-router'
import { Settings2, Trophy } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { SITE_HOST } from '../../app/site'
import { useRouteStat } from '../../app/slots'
import { ShareMenu, type ShareTarget } from '../share/ShareMenu'
import { embedTitle, embedUrl } from '../share/share'
import { useArenaSound } from '../sound/arena'
import { ArenaCanvas, type ArenaCanvasHandle } from './ArenaCanvas'
import { Announcer } from './battle/Announcer'
import { BotsPanel } from './battle/BotsPanel'
import { EventsPanel } from './battle/EventsPanel'
import { downloadBlob, replayName, screenshotName, videoName } from './battle/files'
import { HUD_BAND, HUD_BAND_NARROW, Hud } from './battle/Hud'
import { useFrameRate, useFullscreen } from './battle/hooks'
import { useArenaKeys } from './battle/keys'
import type { BattleLog } from './battle/log'
import { roundOutcome } from './battle/outcome'
import { ReplayChip } from './battle/ReplayChip'
import { buildReplay, replayUrl } from './battle/replay'
import { StandingsPanel } from './battle/StandingsPanel'
import { captureArena, footerStamp, type ScreenshotText } from './battle/screenshot'
import { speedLabel } from './battle/speed'
import { Transport } from './battle/Transport'
import { RoundOver, Victory } from './battle/Victory'
import type { ReplayCheck } from './battle/verify'
import { canRecordVideo, useArenaVideo } from './battle/video'
import { ROUND_PAUSE_MS, useArenaView } from './battle/view'
import { type IntroRun, useIntroGuide } from './intro'
import { type ArenaFight, replaySources } from './setup/bots'
import { searchFromSetup, sharedFragment, shareUrl } from './setup/url'
import { copyLink, copyShareLink } from './share'
import type { ArenaClient } from './worker/client'
import { STAT_FIELDS, STAT_PROCS } from './worker/protocol'

/** A replay in the arena (`/arena/$replayId`): its check, and its own `share` and download. */
export interface ReplayView {
  /** How the check stands: the chip in the arena's header and beside the victory's hash. */
  readonly check: ReplayCheck
  /** Copies the replay's link. */
  readonly onShare: () => void
  /** The replay's embed (`/embed/arena/…`), for `share ▾`'s `copy embed`. */
  readonly embed: string
  /** Saves the replay file as it came. */
  readonly onDownload: () => void
}

export interface ArenaBattleProps {
  /** The client the fight was loaded into. */
  client: ArenaClient
  /** The log that reads the client's messages. */
  log: BattleLog
  fight: ArenaFight
  /** Back to the setup. */
  onExit: () => void
  /** The same fight again: the same bots and seed. */
  onRematch: () => void
  /** The same bots with a new random seed. None on a replay, whose seeds are its own. */
  onNewSeed?: (() => void) | undefined
  /**
   * The battle is a replay: its check shows, `share` and `download replay` are the replay's, and
   * there is no `open in debugger` or `replay link`.
   */
  replay?: ReplayView | undefined
  /** How long autoplay rests between rounds, ms. */
  roundPause?: number | undefined
  /** The battle is the intro's: its guide's marks take the transport and the events log. */
  intro?: IntroRun | undefined
  /** How long the intro holds the placement before it plays, ms. */
  introHold?: number | undefined
  /** A coach mark to pin under the events log's title: the tour's last step. */
  coach?: ReactNode
  /** How often the arena's live region speaks while it plays, ms. */
  announceEvery?: number | undefined
}

const count = (n: number) => n.toLocaleString('en-US')

/**
 * The arena in battle (PRODUCT_SPEC §2): the canvas with its HUD and the transport under it at 8
 * of 12 columns; the rail at 4: the bots, the events log, and, for a match of more rounds, the
 * standings. When the match is over, the victory overlay; between rounds, the round's end and
 * `next round`. The arena's keys (`space . , [ ] 0 1-9 f s m`) live in the app's registry while it
 * shows, and its sound cues play while it shows (`sound/arena.ts`). A replay (`replay`) shows its
 * check beside the arena's title. The intro's guide (`intro.tsx`) or the tour's last step
 * (`tour.tsx`) pins its coach marks to the transport and the events log.
 */
export function ArenaBattle({
  client,
  log,
  fight,
  onExit,
  onRematch,
  onNewSeed,
  replay,
  roundPause = ROUND_PAUSE_MS,
  intro,
  introHold,
  coach,
  announceEvery,
}: ArenaBattleProps) {
  const navigate = useNavigate()
  const { toast } = useToast()
  const canvas = useRef<ArenaCanvasHandle>(null)
  const panel = useRef<HTMLElement>(null)
  const status = useStore(client.store, (state) => state.status)
  const error = useStore(client.store, (state) => state.error)
  const round = useStore(client.store, (state) => state.round)
  const rounds = useStore(client.store, (state) => state.rounds)
  const match = useStore(client.store, (state) => state.match)
  const result = useStore(client.store, (state) => state.result)
  const hash = useStore(client.store, (state) => state.resultHash)
  const order = useStore(client.store, (state) => state.order)
  const meta = useStore(client.store, (state) => state.botMeta)
  const maxCycles = useStore(client.store, (state) => state.config?.maxCycles ?? 0)
  const roundSeed = useStore(client.store, (state) => state.config?.seed ?? 0)
  const { isolated, minimap, autoplay, events } = useArenaView()
  const view = useArenaView.getState()
  const fps = useFrameRate(status === 'playing')
  const [fullscreen, toggleFullscreen] = useFullscreen(panel)
  const wide = useMediaQuery(WIDE)
  const [hidden, setHidden] = useState(false)

  const names = useMemo(() => meta.map((bot) => bot.name), [meta])
  const seed = fight.config.seed ?? 0
  const played = match?.rounds.length ?? 0
  const over = status === 'ended' && match !== null && result !== null && hash !== null
  const between = over && played < match.of

  // A battle that plays on again shows its end again.
  useEffect(() => {
    if (status !== 'ended') setHidden(false)
  }, [status])

  const nextRound = useCallback(() => {
    client.setRound(played)
    client.play()
  }, [client, played])

  useEffect(() => {
    if (!between || !autoplay) return
    const timer = setTimeout(nextRound, roundPause)
    return () => clearTimeout(timer)
  }, [between, autoplay, nextRound, roundPause])

  /** The words on a screenshot or a video's frame: the battle as it stands now. */
  const shotText = useCallback((): ScreenshotText => {
    const state = client.store.getState()
    const roundSeed = state.config?.seed ?? seed
    const title = `asm bots · seed ${roundSeed}${
      state.rounds > 1 ? ` · round ${state.round + 1}/${state.rounds}` : ''
    }`
    return {
      chips: [
        `cycle ${count(state.cycle)} / ${count(state.config?.maxCycles ?? 0)}`,
        speedLabel(state.speed),
      ],
      title,
      bots: names,
      stamp: footerStamp(names, roundSeed, state.cycle),
      site: SITE_HOST,
    }
  }, [client, names, seed])

  const screenshot = useCallback(async () => {
    const handle = canvas.current
    if (handle === null) return
    const cycle = client.store.getState().cycle
    const blob = await captureArena(handle, shotText())
    if (blob === null) {
      toast('could not take the screenshot.', { variant: 'danger' })
      return
    }
    downloadBlob(blob, screenshotName(names, seed, cycle))
  }, [client, names, seed, toast, shotText])

  const [recordable] = useState(canRecordVideo)
  const video = useArenaVideo({
    client,
    canvas,
    text: shotText,
    fileName: (extension) => videoName(names, seed, extension),
    onFail: (message) => toast(message, { variant: 'danger' }),
  })

  /** The setup of this fight with its seed written in: the same battle anywhere. */
  const fixed = useMemo(
    () => ({ ...fight.spec, config: { ...fight.spec.config, seed } }),
    [fight.spec, seed],
  )

  const share = () => void copyShareLink(fixed, fight.shared, toast)

  /** `share ▾`, in the arena's title row and at the battle's end. */
  const shareTarget: ShareTarget = {
    link: replay?.onShare ?? share,
    embed: {
      url: replay?.embed ?? embedUrl(shareUrl(window.location.origin, fixed, fight.shared)),
      title: embedTitle(names),
    },
    png: () => void screenshot(),
    video: recordable ? video.exportRound : undefined,
  }

  const debug = () => {
    void navigate({
      to: '/editor',
      search: searchFromSetup(fixed),
      hash: sharedFragment(fight.shared),
    })
  }

  const download = async () => {
    if (match === null) return
    const sources = await replaySources(fight)
    const file = await buildReplay(fight.bots, sources, fight.config, fight.rounds, match)
    const blob = new Blob([`${JSON.stringify(file, null, 2)}\n`], { type: 'application/json' })
    downloadBlob(blob, replayName(names, seed))
  }

  /** The match's replay link, made as the match ends, so that a click copies it at once. */
  const link = useRef<string | null>(null)
  const finished = over && !between && replay === undefined ? match : null
  useEffect(() => {
    link.current = null
    if (finished === null) return
    let live = true
    void replayLinkOf(fight, finished).then((url) => {
      if (live) link.current = url
    })
    return () => {
      live = false
    }
  }, [finished, fight])

  const copyReplayLink = () => {
    const copied = 'replay link copied.'
    // Made already, as a rule: Safari takes the clipboard only within the click itself.
    if (link.current !== null) void copyLink(link.current, toast, copied)
    else if (finished !== null) {
      void replayLinkOf(fight, finished).then((url) => copyLink(url, toast, copied))
    }
  }

  useArenaKeys({
    client,
    canvas,
    bots: meta.length,
    onFullscreen: toggleFullscreen,
    onScreenshot: () => void screenshot(),
    onRecord: recordable ? video.toggle : undefined,
  })
  useArenaSound(client)
  const guide = useIntroGuide(client, log, intro, introHold)

  const roundStatus =
    rounds > 1 ? `round ${round + 1}/${rounds} · seed ${roundSeed}` : `seed ${seed}`
  return (
    <PanelGrid className="p-3 lg:h-full lg:grid-rows-[auto_minmax(0,1fr)_auto]">
      <BattleStat client={client} />
      <Panel
        ref={panel}
        className="col-span-12 lg:col-span-8 lg:row-span-3"
        title="arena"
        data-tour="arena-core"
        status={status === 'error' ? 'failed' : roundStatus}
        actions={
          <>
            {replay !== undefined && <ReplayChip check={replay.check} live />}
            {over && hidden && (
              <Button icon={Trophy} size="sm" onClick={() => setHidden(false)}>
                result
              </Button>
            )}
            <ShareMenu {...shareTarget} />
            <Button icon={Settings2} size="sm" onClick={onExit} data-tour="arena-exit">
              setup
            </Button>
          </>
        }
      >
        {status === 'error' ? (
          <p className="py-6 text-center text-danger">{error}</p>
        ) : (
          <div className="@container flex h-full flex-col gap-2">
            {/* Under `lg` the box is the map: as tall as the core is wide (the width less the
                44 px row ruler), plus the HUD's band. */}
            <div
              className={
                fullscreen
                  ? 'relative min-h-0 flex-1'
                  : 'relative h-[min(100cqw_-_8px,70vh,48rem)] min-h-80 max-md:h-[min(100cqw_+_18px,70vh)] lg:h-auto lg:min-h-0 lg:flex-1'
              }
            >
              <ArenaCanvas
                ref={canvas}
                client={client}
                minimap={minimap}
                isolated={isolated}
                insetTop={wide ? HUD_BAND : HUD_BAND_NARROW}
                className="size-full"
              >
                <Hud
                  client={client}
                  fps={fps}
                  minimap={minimap}
                  onMinimap={view.setMinimap}
                  fullscreen={fullscreen}
                  onFullscreen={toggleFullscreen}
                  onScreenshot={() => void screenshot()}
                  recording={video.since}
                  onRecord={recordable ? video.toggle : undefined}
                />
              </ArenaCanvas>
              <Announcer client={client} every={announceEvery} />
              {over && !between && !hidden && (
                <Victory
                  result={result}
                  order={order}
                  hash={hash}
                  match={match}
                  names={names}
                  maxCycles={maxCycles}
                  check={replay?.check}
                  onDismiss={() => setHidden(true)}
                  onRematch={onRematch}
                  onNewSeed={onNewSeed}
                  share={shareTarget}
                  onDebug={replay === undefined ? debug : undefined}
                  onDownload={replay?.onDownload ?? (() => void download())}
                  onReplayLink={replay === undefined ? copyReplayLink : undefined}
                />
              )}
              {between && (
                <RoundOver
                  round={round}
                  rounds={rounds}
                  outcome={roundOutcome(result, order, names)}
                  autoplay={autoplay}
                  onAutoplay={view.setAutoplay}
                  onNextRound={nextRound}
                />
              )}
            </div>
            <Transport
              client={client}
              log={log}
              autoplay={autoplay}
              onAutoplay={view.setAutoplay}
              onNextRound={nextRound}
              coach={guide.transport}
            />
          </div>
        )}
      </Panel>
      <BotsPanel
        className="col-span-12 max-h-[26rem] lg:col-span-4"
        client={client}
        log={log}
        isolated={isolated}
        onIsolate={view.isolate}
      />
      <EventsPanel
        className="col-span-12 h-80 lg:col-span-4 lg:h-auto"
        client={client}
        log={log}
        filter={events}
        onFilter={view.setEvents}
        coach={intro === undefined ? coach : guide.events}
      />
      {rounds > 1 && (
        <StandingsPanel className="col-span-12 lg:col-span-4" client={client} log={log} />
      )}
    </PanelGrid>
  )
}

/** The link that replays `match` of `fight`: the bots' bytes alone, no sources (PRODUCT_SPEC §10). */
async function replayLinkOf(fight: ArenaFight, match: MatchResult): Promise<string> {
  const file = await buildReplay(fight.bots, [], fight.config, fight.rounds, match)
  return replayUrl(window.location.origin, file)
}

/** The header's stat line for the battle: `8 bots · 41 procs · cycle 12,480`, every frame. */
function BattleStat({ client }: { client: ArenaClient }) {
  const bots = useStore(client.store, (state) => state.botMeta.length)
  const cycle = useStore(client.store, (state) => state.cycle)
  const procs = useStore(client.store, (state) => {
    let sum = 0
    for (let o = STAT_PROCS; o < state.stats.length; o += STAT_FIELDS) sum += state.stats[o] ?? 0
    return sum
  })
  useRouteStat(`${bots} bots · ${count(procs)} procs · cycle ${count(cycle)}`)
  return null
}
