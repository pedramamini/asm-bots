/**
 * The assembler, loaded when a setup first needs it: `assembly.ts` is a chunk of its own, and a
 * setup of roster bots (prebuilt) never loads it. A local bot, a share link's bot, the paste box,
 * and dropped files do.
 */
import { useEffect, useState } from 'react'
import { useOnline } from '../../../app/online'
import type { Assemble } from './bots'

type Assembly = typeof import('./assembly')

let loading: Promise<Assembly> | null = null
let loaded: Assemble | null = null

/** The assembler's chunk, loaded once. A load that fails is tried again at the next call. */
export function loadAssembly(): Promise<Assembly> {
  loading ??= import('./assembly').then(
    (assembly) => {
      loaded = assembly.assembleCached
      return assembly
    },
    (error: unknown) => {
      loading = null
      throw error
    },
  )
  return loading
}

/**
 * `assembleCached`, once `needed` has held and the assembler's chunk has come; null until then.
 * A chunk that does not come (offline) leaves it null, so the bots that need it show `loading`,
 * and it is asked for again when the network is back.
 */
export function useAssemble(needed: boolean): Assemble | null {
  const [assemble, setAssemble] = useState<Assemble | null>(() => loaded)
  const online = useOnline()
  useEffect(() => {
    if (!needed || assemble !== null) return
    let live = true
    loadAssembly().then(
      (assembly) => {
        if (live) setAssemble(() => assembly.assembleCached)
      },
      () => {},
    )
    return () => {
      live = false
    }
    // `online`: a load that failed offline runs again when the network is back.
  }, [needed, assemble, online])
  return assemble
}
