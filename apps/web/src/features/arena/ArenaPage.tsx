import { useLocation, useNavigate, useSearch } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocalBots } from '../../store/local-bots'
import { useSettings } from '../../store/settings'
import { ArenaBattle } from './ArenaBattle'
import { ArenaSetup } from './ArenaSetup'
import type { ArenaFight } from './setup/bots'
import { DEFAULT_ARENA_CONFIG } from './setup/config'
import { validateArenaSearch } from './setup/search'
import {
  type ArenaSetupSpec,
  type SharedBot,
  searchFromSetup,
  setupFromSearch,
  sharedBots,
  sharedFragment,
} from './setup/url'
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

/**
 * `/arena` (PRODUCT_SPEC §2): the setup until the fight button, then the battle. The URL holds the
 * setup (`setup/url.ts`): the page reads it on load and when it changes (a link, the back button),
 * and writes each change back `URL_DELAY` ms after the last, replacing the entry. A fresh visit,
 * `/arena` with no query, starts from the config last fought with. The Worker starts with the
 * first fight and ends with the page.
 */
export function ArenaPage({
  createClient = () => new ArenaClient(),
  urlDelay = URL_DELAY,
}: ArenaPageProps) {
  const raw = useSearch({ strict: false })
  const hash = useLocation({ select: (location) => location.hash })
  const navigate = useNavigate()
  const localBots = useLocalBots()
  // Read once: the config the last fight used, for a visit with no query.
  const [fallback] = useState(() => useSettings.getState().lastArenaConfig ?? DEFAULT_ARENA_CONFIG)
  const fromUrl = useMemo(
    () => setupFromSearch(validateArenaSearch(raw), fallback),
    [raw, fallback],
  )
  const shared = useMemo(() => sharedBots(hash), [hash])
  const [spec, setSpec] = useState(fromUrl)
  const [fight, setFight] = useState<ArenaFight | null>(null)
  /** The key of the setup the URL holds, as last read or written. */
  const inUrl = useRef(keyOf(fromUrl))
  const client = useRef<ArenaClient | null>(null)

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
    client.current?.pause()
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
      const current = client.current
      client.current = null
      if (current === null) return
      current.dispose()
      current.store.setState({ ...INITIAL_ARENA_STATE })
    },
    [],
  )

  const startFight = (next: ArenaFight) => {
    writeUrl(next.spec)
    client.current ??= createClient()
    client.current.load(next.bots, next.config)
    client.current.play()
    setFight(next)
  }

  if (fight !== null && client.current !== null) {
    return (
      <ArenaBattle
        client={client.current}
        fight={fight}
        onExit={() => {
          client.current?.pause()
          setFight(null)
        }}
      />
    )
  }
  return (
    <ArenaSetup
      spec={spec}
      onSpecChange={(update) => setSpec((current) => update(current))}
      shared={shared}
      onFight={startFight}
    />
  )
}
