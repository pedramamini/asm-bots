/**
 * `verify` on a published match (ARCHITECTURE §7, verification model): a click asks the server for
 * the match's inputs (`GET /api/matches/:id/verify`), runs them here in an arena Worker a round at
 * a time (`verify.ts`, loaded with the first click), and the button gives way to the replay chip:
 * `verifying`, `verified 2/10`, then `verified`, or `mismatch` with the reason in its title. When
 * the inputs cannot be had, a toast says why and the button comes back.
 */
import type { MatchVerification } from '@asmbots/protocol'
import { Button, IconButton, useToast } from '@asmbots/ui'
import { useQueryClient } from '@tanstack/react-query'
import { Shield } from 'lucide-react'
import { type MouseEvent, useEffect, useRef, useState } from 'react'
import { matchVerificationQuery } from '../../api/queries'
import { ReplayChip } from '../arena/battle/ReplayChip'
import type { ReplayCheck } from '../arena/battle/verify'
import type { VerifyOptions } from './verify'

/** The chip before the inputs have come: nothing checked yet. */
const STARTING: ReplayCheck = { state: 'pending', verified: 0, of: 1 }

export interface VerifyMatchProps {
  /** The match's id (its `matches` row). */
  id: string
  /** What the match is, for the button's name: `Dwarf vs Imp`. */
  label: string
  /** An icon, not words, for the button and the chip: a narrow table's (the home page's). */
  compact?: boolean | undefined
  /** Makes the client that runs the rounds; tests pass a stand-in. Default: an arena Worker. */
  createClient?: VerifyOptions['createClient']
  className?: string | undefined
}

export function VerifyMatch({ id, label, compact, createClient, className }: VerifyMatchProps) {
  const client = useQueryClient()
  const { toast } = useToast()
  const [check, setCheck] = useState<ReplayCheck | null>(null)
  const running = useRef<AbortController | null>(null)
  // Leaving the page ends the run and its Worker.
  useEffect(() => () => running.current?.abort(), [])

  const start = async (event: MouseEvent) => {
    // The row under the button opens the match's replay: this click is the button's alone.
    event.stopPropagation()
    running.current?.abort()
    const controller = new AbortController()
    running.current = controller
    setCheck(STARTING)
    let loaded: [MatchVerification, typeof import('./verify')]
    try {
      loaded = await Promise.all([
        client.fetchQuery(matchVerificationQuery(id)),
        import('./verify'),
      ])
    } catch (error) {
      if (controller.signal.aborted) return
      setCheck(null)
      const why = error instanceof Error ? error.message : String(error)
      toast(`cannot verify ${label}: ${why}`, { variant: 'danger' })
      return
    }
    if (controller.signal.aborted) return
    const [verification, { verifyMatch }] = loaded
    await verifyMatch(verification, setCheck, { createClient, signal: controller.signal })
  }

  if (check === null && compact) {
    return (
      <IconButton
        icon={Shield}
        size="sm"
        label={`verify ${label}`}
        className={className}
        onClick={(event) => void start(event)}
      />
    )
  }
  if (check === null) {
    return (
      <Button
        variant="ghost"
        size="sm"
        icon={Shield}
        aria-label={`verify ${label}`}
        title="run this match here, and check it against the server's result"
        className={className}
        onClick={(event) => void start(event)}
      >
        verify
      </Button>
    )
  }
  return <ReplayChip check={check} live compact={compact} className={className} />
}
