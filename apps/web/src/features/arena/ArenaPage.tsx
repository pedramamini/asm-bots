import { useToast } from '@asmbots/ui'
import { useLocation, useNavigate, useSearch } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocalBots } from '../../store/local-bots'
import { useCoachMark, useSettings } from '../../store/settings'
import { ArenaBattle } from './ArenaBattle'
import { ArenaSetup } from './ArenaSetup'
import { BattleLog } from './battle/log'
import { useArenaView } from './battle/view'
import { INTRO_SPEED, type IntroRun, introFight } from './intro'
import { type ArenaFight, fightSeed } from './setup/bots'
import { DEFAULT_ARENA_CONFIG, randomSeed } from './setup/config'
import { validateArenaSearch } from './setup/search'
import {
  type ArenaSetupSpec,
  type SharedBot,
  searchFromSetup,
  setupFromSearch,
  sharedBots,
  sharedFragment,
} from './setup/url'
import { ARENA_TOUR, WatchStep } from './tour'
import { ArenaClient, INITIAL_ARENA_STATE } from './worker/client'

/** How long the URL waits after the setup's last change, ms: a slider drag writes it once. */
export const URL_DELAY = 250

export interface ArenaPageProps {
  /** Makes the client of the first fight. Default: an `ArenaClient` and its Worker. */
  createClient?: (() => ArenaClient) | undefined
  /** How long the URL waits after the setup's last change, ms. */
  urlDelay?: number | undefined
}

/** A setup as a key: equal setups, equal keys. */
function keyOf(spec: ArenaSetupSpec): string {
  return JSON.stringify(searchFromSetup(spec))
}

/** The Worker's client, and the log that reads it from the first message on. */
interface Session {
  readonly client: ArenaClient
  readonly log: BattleLog
}

/**
 * `/arena` (PRODUCT_SPEC §2): the setup until the fight button, then the battle. The URL holds the
 * setup (`setup/url.ts`): the page reads it on load and when it changes (a link, the back button),
 * and writes each change back `URL_DELAY` ms after the last, replacing the entry. A fresh visit,
 * `/arena` with no query, starts from the config last fought with. The Worker starts with the
 * first fight and ends with the page. `rematch` fights the same fight again; `new seed` draws
 * another seed, which a fixed seed in the setup, and so the URL, takes too. `?intro=true` (the
 * header's `intro`) runs the guided demo (`intro.tsx`), and a first visit gets the tour
 * (`tour.tsx`) until it is put away.
 */
export function ArenaPage({
  createClient = () => new ArenaClient(),
  urlDelay = URL_DELAY,
}: ArenaPageProps) {
  const raw = useSearch({ strict: false })
  const hash = useLocation({ select: (location) => location.hash })
  const navigate = useNavigate()
  const { toast } = useToast()
  const localBots = useLocalBots()
  const tour = useCoachMark(ARENA_TOUR)
  // Read once: the config the last fight used, for a visit with no query.
  const [fallback] = useState(() => useSettings.getState().lastArenaConfig ?? DEFAULT_ARENA_CONFIG)
  const search = useMemo(() => validateArenaSearch(raw), [raw])
  const fromUrl = useMemo(() => setupFromSearch(search, fallback), [search, fallback])
  const shared = useMemo(() => sharedBots(hash), [hash])
  const [spec, setSpec] = useState(fromUrl)
  const [fight, setFight] = useState<ArenaFight | null>(null)
  /** The intro's run while its battle shows: its guide, and no tour, over the battle. */
  const [introRun, setIntroRun] = useState<number | null>(null)
  const introRuns = useRef(0)
  /** The key of the setup the URL holds, as last read or written. */
  const inUrl = useRef(keyOf(fromUrl))
  const session = useRef<Session | null>(null)

  /** The fragment for `next`: the shared bots it still names that this browser has not saved. */
  const fragmentOf = (next: ArenaSetupSpec): string => {
    const saved = new Set(localBots.data?.map((bot) => bot.id))
    const keep = new Map<string, SharedBot>()
    for (const ref of next.bots) {
      const source = ref.kind === 'local' && !saved.has(ref.id) ? shared.get(ref.id) : undefined
      if (ref.kind === 'local' && source !== undefined) keep.set(ref.id, { id: ref.id, source })
    }
    return sharedFragment([...keep.values()])
  }

  const writeUrl = (next: ArenaSetupSpec) => {
    inUrl.current = keyOf(next)
    // An empty fragment is none: the URL loses its `#`.
    void navigate({
      to: '/arena',
      search: searchFromSetup(next),
      hash: fragmentOf(next),
      replace: true,
    })
  }

  // The URL changed under the page (a link, back, forward): its setup wins, and a battle ends.
  useEffect(() => {
    const key = keyOf(fromUrl)
    if (key === inUrl.current) return
    inUrl.current = key
    setSpec(fromUrl)
    session.current?.client.pause()
    setIntroRun(null)
    setFight(null)
  }, [fromUrl])

  // The setup changed on the page: the URL follows once the changes stop.
  useEffect(() => {
    if (keyOf(spec) === inUrl.current) return
    const timer = setTimeout(() => {
      if (keyOf(spec) !== inUrl.current) writeUrl(spec)
    }, urlDelay)
    return () => clearTimeout(timer)
  })

  // The Worker goes with the page, and the arena store back to nothing loaded.
  useEffect(
    () => () => {
      const current = session.current
      session.current = null
      if (current === null) return
      current.client.dispose()
      current.client.store.setState({ ...INITIAL_ARENA_STATE })
    },
    [],
  )

  /** Loads `next` and plays it; the intro's fight waits paused, at its own speed, for its guide. */
  const startFight = (next: ArenaFight, intro = false) => {
    writeUrl(next.spec)
    if (session.current === null) {
      const made = createClient()
      const log = new BattleLog()
      log.attach(made)
      session.current = { client: made, log }
    }
    useArenaView.getState().clearIsolation()
    const { client } = session.current
    client.load(next.bots, next.config, next.rounds)
    if (intro) client.speed(INTRO_SPEED)
    else client.play()
    setFight(next)
    setIntroRun(intro ? ++introRuns.current : null)
  }

  // `?intro=true`, the header's link: the intro's fight starts, and the URL takes its setup, so
  // the link can run it again and a reload keeps the bots.
  useEffect(() => {
    if (search.intro !== true) return
    const next = introFight()
    setSpec(next.spec)
    startFight(next, true)
  }, [search.intro])

  const exit = () => {
    session.current?.client.pause()
    // A battle the tour's last step showed on: the tour is done.
    if (tour.open && introRun === null) tour.dismiss()
    setIntroRun(null)
    setFight(null)
  }

  /** The same bots with a new random seed that places them in every round. */
  const newSeed = (from: ArenaFight) => {
    const sizes = from.bots.map((bot) => bot.bytes.length)
    const { minSpacing, seed: fixed } = from.spec.config
    const seed = fightSeed(sizes, minSpacing, null, randomSeed, from.rounds)
    if (seed === null) {
      toast('no seed places these bots: lower the spacing.', { variant: 'danger' })
      return
    }
    const spec =
      fixed === null ? from.spec : { ...from.spec, config: { ...from.spec.config, seed } }
    if (spec !== from.spec) setSpec(spec)
    startFight({ ...from, spec, config: { ...from.config, seed } })
  }

  const intro: IntroRun | undefined =
    introRun === null ? undefined : { run: introRun, onPickBots: exit }
  if (fight !== null && session.current !== null) {
    return (
      <ArenaBattle
        client={session.current.client}
        log={session.current.log}
        fight={fight}
        onExit={exit}
        onRematch={() => startFight(fight)}
        onNewSeed={() => newSeed(fight)}
        intro={intro}
        coach={tour.open && <WatchStep onDismiss={tour.dismiss} />}
      />
    )
  }
  return (
    <ArenaSetup
      spec={spec}
      onSpecChange={(update) => setSpec((current) => update(current))}
      shared={shared}
      onFight={(next) => startFight(next)}
      tour={tour.open ? { onDismiss: tour.dismiss } : undefined}
    />
  )
}
