import { useCallback, useEffect, useRef, useState } from 'react'
import type { AsmClient } from './client'
import type { AsmResult } from './protocol'

/** How long the source must rest before it assembles, ms (PRODUCT_SPEC §3: auto on idle 300 ms). */
export const ASSEMBLE_DELAY = 300

export interface Assembler {
  /** The latest result: for `source`, or for a source before it while `pending`. Null at first. */
  readonly result: AsmResult | null
  /** Whether `result` is not yet `source`'s: an assemble waits for idle, or runs. */
  readonly pending: boolean
  /** Assembles the source at once, without the wait: the `assemble` button. Null when stale. */
  readonly assembleNow: () => Promise<AsmResult | null>
}

/**
 * Assembles `source` in the assembler Worker once it has not changed for `delay` ms: the first
 * source at once, then each that rests. Only the answer to the last request counts, so a slow
 * answer never replaces a newer one.
 */
export function useAssembler(
  source: string,
  client: AsmClient,
  delay: number = ASSEMBLE_DELAY,
): Assembler {
  const [result, setResult] = useState<AsmResult | null>(null)
  /** The id of the last request; an answer to an earlier one is dropped. */
  const latest = useRef(0)
  const held = useRef({ source, result })
  held.current = { source, result }

  const run = useCallback(
    async (text: string): Promise<AsmResult | null> => {
      const id = ++latest.current
      try {
        const next = await client.assemble(text)
        if (id !== latest.current) return null
        setResult(next)
        return next
      } catch {
        // The client was disposed: the page is going.
        return null
      }
    },
    [client],
  )

  const started = useRef(false)
  useEffect(() => {
    if (!started.current) {
      started.current = true
      void run(source)
      return
    }
    // Typed back to the text last assembled: its result stands.
    if (held.current.result?.source === source) {
      latest.current++
      return
    }
    const timer = setTimeout(() => void run(source), delay)
    return () => clearTimeout(timer)
  }, [source, delay, run])

  const assembleNow = useCallback(() => run(held.current.source), [run])
  return { result, pending: result?.source !== source, assembleNow }
}
