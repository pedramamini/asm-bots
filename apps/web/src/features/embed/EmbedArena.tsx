/**
 * The arena with no frame (PRODUCT_SPEC §10), for another site's `<iframe>` (`share ▾` → `copy
 * embed`): `/embed/arena?b=…#src=…` fights the battle an arena link names, and
 * `/embed/arena/<key>` plays a replay, stored or carried in `#r=`. It plays as it loads (under
 * reduced motion it waits for `play`), each round follows the last, and the end says who won. The
 * controls: play and pause, restart, the round and cycle, and `watch on asmbots`, which opens the
 * arena at the same battle in a new tab. The arena is a picture here: the wheel scrolls the page
 * around it. It makes no sound and takes no keys.
 */
import { SHA256 } from '@asmbots/protocol'
import { meleeStandings } from '@asmbots/tourney'
import { Chip, cx, HueSwatch, IconButton, RadarLoader } from '@asmbots/ui'
import { useLocation, useSearch } from '@tanstack/react-router'
import { ExternalLink, Pause, Play, RotateCcw } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { isNotFound } from '../../api/client'
import { useReplay } from '../../api/queries'
import { useMotionReduced } from '../../store/settings'
import { ArenaCanvas } from '../arena/ArenaCanvas'
import { matchOutcome, roundOutcome } from '../arena/battle/outcome'
import { readReplayFragment, readReplayValue, replayFight } from '../arena/battle/replay'
import { ROUND_PAUSE_MS } from '../arena/battle/view'
import {
  type ArenaFight,
  arenaFight,
  fightSeed,
  resolveSelection,
  sizesOf,
} from '../arena/setup/bots'
import { MIN_ARENA_BOTS, randomSeed } from '../arena/setup/config'
import { type ArenaSearch, validateArenaSearch } from '../arena/setup/search'
import { setupFromSearch, sharedBots } from '../arena/setup/url'
import { ArenaClient, createArenaStore } from '../arena/worker/client'
import { STAT_FIELDS, STAT_PROCS } from '../arena/worker/protocol'
import { embedTitle, watchUrl } from '../share/share'

export interface EmbedProps {
  /** Makes the battle's client. Default: an `ArenaClient` with a store of its own. */
  createClient?: (() => ArenaClient) | undefined
}

const newClient = () => new ArenaClient({ store: createArenaStore() })

const count = (n: number) => n.toLocaleString('en-US')

/** A battle an embed can fight, or what keeps it from one. */
type EmbedRead = { readonly fight: ArenaFight } | { readonly problem: string }

/**
 * The battle of an arena link's query and fragment: its bots (the roster's, and the ones the
 * fragment carries; this browser's own bots are not read), its config, and its seed, or a random
 * seed that places them when it names none.
 */
export function embedFight(search: ArenaSearch, fragment: string): EmbedRead {
  const spec = setupFromSearch(search)
  const selection = resolveSelection(spec.bots, { local: new Map(), shared: sharedBots(fragment) })
  if (selection.length < MIN_ARENA_BOTS) return { problem: 'this embed names no battle.' }
  if (selection.some((s) => s.state === 'missing')) {
    return { problem: 'this embed names a bot it does not carry.' }
  }
  if (selection.some((s) => s.state === 'broken')) {
    return { problem: 'a bot of this embed does not assemble.' }
  }
  const { minSpacing, seed, rounds } = spec.config
  const placed = fightSeed(sizesOf(selection), minSpacing, seed, randomSeed, rounds)
  if (placed === null) return { problem: 'these bots do not fit in the core.' }
  return { fight: arenaFight(selection, spec, placed) }
}

/** `/embed/arena`: the battle an arena link names. */
export function EmbedSetup({ createClient }: EmbedProps) {
  const raw = useSearch({ strict: false })
  const hash = useLocation({ select: (location) => location.hash })
  const read = useMemo(() => embedFight(validateArenaSearch(raw), hash), [raw, hash])
  if ('problem' in read) return <EmbedNote>{read.problem}</EmbedNote>
  return <EmbedBattle fight={read.fight} createClient={createClient} />
}

/** `/embed/arena/$replayId`: a replay, from the link's `#r=` or the server's store. */
export function EmbedReplay({ replayId, createClient }: EmbedProps & { replayId: string }) {
  const hash = useLocation({ select: (location) => location.hash })
  const linked = useMemo(() => readReplayFragment(hash), [hash])
  const stored = linked.kind === 'none' && SHA256.test(replayId) ? replayId : null
  const fetched = useReplay(stored)
  const read = useMemo(
    () => (stored === null || fetched.data === undefined ? linked : readReplayValue(fetched.data)),
    [linked, stored, fetched.data],
  )
  const fight = useMemo(
    () => (read.kind === 'ok' ? replayFight(read.replay, read.bots) : null),
    [read],
  )
  if (fight !== null) return <EmbedBattle fight={fight} createClient={createClient} />
  if (read.kind === 'broken')
    return <EmbedNote>this replay link is broken: {read.reason}.</EmbedNote>
  if (stored === null) return <EmbedNote>this embed carries no replay.</EmbedNote>
  if (isNotFound(fetched.error))
    return <EmbedNote>the server has no replay with this key.</EmbedNote>
  if (fetched.error !== null) return <EmbedNote>the replay did not load.</EmbedNote>
  return (
    <EmbedNote>
      <RadarLoader label="loading the replay" />
    </EmbedNote>
  )
}

/** The embed's whole page: black, as the arena is in every theme. */
function EmbedFrame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <main aria-label={label} className="fixed inset-0 flex flex-col bg-arena-bg">
      {children}
    </main>
  )
}

/** Why there is no battle, and the way to the arena: on a panel, as paper's text needs. */
function EmbedNote({ children }: { children: ReactNode }) {
  return (
    <EmbedFrame label="ASM BOTS embed">
      <div className="grid min-h-0 flex-1 place-items-center p-4 text-center text-body text-muted">
        <div className="flex flex-col items-center gap-3 rounded-md border border-border bg-panel px-4 py-3">
          {children}
          <WatchLink />
        </div>
      </div>
    </EmbedFrame>
  )
}

/** `watch on asmbots`: this battle in the arena, in a new tab. */
function WatchLink() {
  const here = useLocation({ select: (location) => location.href })
  const href = watchUrl(new URL(here, window.location.origin).href)
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener"
      className="rounded-sm focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <Chip variant="accent" icon={ExternalLink}>
        watch on asmbots
      </Chip>
    </a>
  )
}

/** The battle, its bots, and the controls under it. */
function EmbedBattle({ fight, createClient = newClient }: EmbedProps & { fight: ArenaFight }) {
  const reduced = useMotionReduced()
  const make = useRef(createClient)
  const still = useRef(reduced)
  still.current = reduced
  const [client, setClient] = useState<ArenaClient | null>(null)

  // A client for each fight, made in the effect: StrictMode's second run gets a live one.
  useEffect(() => {
    const made = make.current()
    made.load(fight.bots, fight.config, fight.rounds)
    if (!still.current) made.play()
    setClient(made)
    return () => {
      made.dispose()
      setClient(null)
    }
  }, [fight])

  const names = useMemo(() => fight.bots.map((bot) => bot.name), [fight])
  return (
    <EmbedFrame label={embedTitle(names)}>
      <div className="relative min-h-0 flex-1">
        {client !== null && (
          <>
            <ArenaCanvas
              client={client}
              interactive={false}
              minimap={false}
              label={`${embedTitle(names)}: the arena`}
              className="size-full"
            />
            <Legend client={client} names={names} />
            <Outcome client={client} names={names} />
          </>
        )}
      </div>
      {client !== null && <Controls client={client} fight={fight} />}
    </EmbedFrame>
  )
}

/** Each bot's hue and name, top left; a dead bot's struck through. */
function Legend({ client, names }: { client: ArenaClient; names: readonly string[] }) {
  // A string, so the legend draws again only when a bot lives or dies, not every frame.
  const alive = useStore(client.store, (state) =>
    names
      .map((_, i) => ((state.stats[i * STAT_FIELDS + STAT_PROCS] ?? 1) > 0 ? '1' : '0'))
      .join(''),
  )
  return (
    <ul
      aria-label="bots"
      className="pointer-events-none absolute top-2 left-2 flex max-w-[45%] flex-col gap-0.5 rounded-md border border-border bg-panel px-2 py-1.5"
    >
      {names.map((name, i) => (
        <li
          key={`${i}:${name}`}
          className={cx(
            'flex min-w-0 items-center gap-2 text-data',
            alive[i] === '0' ? 'text-muted line-through' : 'text-text',
          )}
        >
          <HueSwatch hue={i} />
          <span className="truncate">{name}</span>
        </li>
      ))}
    </ul>
  )
}

/** Who won, over the arena's foot, once the last round is over. */
function Outcome({ client, names }: { client: ArenaClient; names: readonly string[] }) {
  const status = useStore(client.store, (state) => state.status)
  const match = useStore(client.store, (state) => state.match)
  const result = useStore(client.store, (state) => state.result)
  const order = useStore(client.store, (state) => state.order)
  const maxCycles = useStore(client.store, (state) => state.config?.maxCycles ?? 0)
  const outcome = useMemo(() => {
    if (status !== 'ended' || match === null || result === null) return null
    if (match.rounds.length < match.of) return null
    return match.of > 1
      ? matchOutcome(match, meleeStandings(match, { maxCycles }))
      : roundOutcome(result, order, names)
  }, [status, match, result, order, names, maxCycles])
  if (outcome === null) return null
  return (
    <div className="absolute inset-x-2 bottom-2 flex justify-center">
      <p
        aria-live="polite"
        className="max-w-full rounded-md border border-border-strong bg-panel px-3 py-1.5 text-center"
      >
        <span className="text-panel-title text-accent-fg uppercase">{outcome.headline}</span>
        <span className="text-data text-muted"> · {outcome.detail}</span>
      </p>
    </div>
  )
}

/** Play or pause, restart, where the battle is, and `watch on asmbots`. Rounds follow on. */
function Controls({ client, fight }: { client: ArenaClient; fight: ArenaFight }) {
  const status = useStore(client.store, (state) => state.status)
  const cycle = useStore(client.store, (state) => state.cycle)
  const round = useStore(client.store, (state) => state.round)
  const rounds = useStore(client.store, (state) => state.rounds)
  const played = useStore(client.store, (state) => state.match?.rounds.length ?? 0)
  const of = useStore(client.store, (state) => state.match?.of ?? 0)
  const between = status === 'ended' && played < of

  // The next round after a rest, as the arena's autoplay does.
  useEffect(() => {
    if (!between) return
    const timer = setTimeout(() => {
      client.setRound(played)
      client.play()
    }, ROUND_PAUSE_MS)
    return () => clearTimeout(timer)
  }, [between, client, played])

  const playing = status === 'playing'
  const restart = () => {
    client.load(fight.bots, fight.config, fight.rounds)
    client.play()
  }
  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-border bg-panel px-2 py-1">
      <IconButton
        icon={playing ? Pause : Play}
        label={playing ? 'pause' : 'play'}
        size="sm"
        tooltip="top"
        disabled={status === 'loading' || status === 'error' || (status === 'ended' && !between)}
        onClick={() => (playing ? client.pause() : client.play())}
      />
      <IconButton icon={RotateCcw} label="restart" size="sm" tooltip="top" onClick={restart} />
      <p className="min-w-0 flex-1 truncate text-data text-muted tabular-nums">
        {rounds > 1 && `round ${round + 1}/${rounds} · `}cycle {count(cycle)}
      </p>
      <WatchLink />
    </div>
  )
}
