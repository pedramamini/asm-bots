/**
 * The intro (PRODUCT_SPEC §9): the header's `intro` link opens a guided demo in the arena. It loads
 * Dwarf vs Imp at a seed where Dwarf's bomb lands on Imp's next word at cycle 55,602, first blood
 * and the battle's end. The guide holds the placement for a few seconds, plays at 200 cycles a
 * frame (about 5 s at 60 fps), points at the events log when first blood happens, and hands over
 * to the setup: about 30 s from the link to `pick bots`. Each step is a coach mark with `skip`.
 */
import { CoachMark } from '@asmbots/ui'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import type { BattleLog } from './battle/log'
import { type ArenaFight, arenaFight, resolveSelection } from './setup/bots'
import { DEFAULT_ARENA_CONFIG } from './setup/config'
import type { ArenaSetupSpec, BotRef } from './setup/url'
import type { ArenaClient } from './worker/client'
import type { Speed } from './worker/protocol'

/** The intro's bots, in their placing order: the bomber, then the replicator. */
export const INTRO_BOTS: readonly BotRef[] = [
  { kind: 'roster', slug: 'dwarf' },
  { kind: 'roster', slug: 'imp' },
]

/**
 * The intro's seed: Dwarf's bomb lands on Imp at cycle 55,602, the latest first blood of seeds
 * 1..400 in the duel config (found by simulation), so the battle plays long enough to watch.
 * `test/intro.test.ts` holds the cycle.
 */
export const INTRO_SEED = 263

/** Cycles a frame while the intro plays. */
export const INTRO_SPEED: Speed = 200

/** How long the intro shows the bots placed before it plays by itself, ms. */
export const INTRO_HOLD_MS = 6000

/** The intro's setup: the duel config with its seed fixed. */
export function introSpec(): ArenaSetupSpec {
  return { bots: INTRO_BOTS, config: { ...DEFAULT_ARENA_CONFIG, seed: INTRO_SEED } }
}

/** The intro's fight: roster bots only, so nothing waits on the local store. */
export function introFight(): ArenaFight {
  const spec = introSpec()
  const selection = resolveSelection(spec.bots, { local: new Map(), shared: new Map() })
  return arenaFight(selection, spec, INTRO_SEED)
}

/** Where the guide stands: the bots, first blood, your turn, or put away. */
export type IntroStep = 'bots' | 'blood' | 'yours' | 'done'

/**
 * A run of the intro, as the page hands it to the battle: while it is set, the battle is the
 * intro's, and the tour stays out of it. `skip` and `done` put the guide away; the battle stays.
 */
export interface IntroRun {
  /** Counts the runs: a new run starts the guide over. */
  readonly run: number
  /** `pick bots`: to the setup, the intro over. */
  readonly onPickBots: () => void
}

/** The guide's coach marks, by the control each is pinned to. */
export interface IntroMarks {
  /** Over the transport's play button: the bots, and `play now` while it holds. */
  readonly transport: ReactNode
  /** Under the events log's title, over its lines: first blood, then your turn. */
  readonly events: ReactNode
}

const NONE: IntroMarks = { transport: null, events: null }

const count = (n: number) => n.toLocaleString('en-US')

/**
 * The guide of an intro run (none without one). It holds the placement `holdMs`, then plays; a
 * press of play (`play now`, the transport, `space`) plays sooner. At first blood it moves to the events log,
 * and `next` to your turn; a battle that ends with no first blood goes straight there. It hears
 * the log's changes itself, so the battle view does not redraw with them.
 */
export function useIntroGuide(
  client: ArenaClient,
  log: BattleLog,
  intro: IntroRun | undefined,
  holdMs = INTRO_HOLD_MS,
): IntroMarks {
  const [step, setStep] = useState<IntroStep>('bots')
  const status = useStore(client.store, (state) => state.status)
  const atStart = useStore(client.store, (state) => state.cycle === 0)
  /** The run has played: the hold is over for good, whatever happens to the cycle after. */
  const played = useRef(false)
  const run = intro?.run

  // Each run starts the guide over.
  useEffect(() => {
    void run
    played.current = false
    setStep('bots')
  }, [run])

  useEffect(() => {
    if (status === 'playing') played.current = true
  }, [status])

  // The hold: the placement for a moment, then the battle plays by itself.
  const holding = run !== undefined && step === 'bots' && status === 'paused' && atStart
  useEffect(() => {
    if (!holding || played.current) return
    const timer = setTimeout(() => client.play(), holdMs)
    return () => clearTimeout(timer)
  }, [holding, client, holdMs])

  // First blood, as the log takes it in. While a load is on its way the log still holds the
  // battle before, so a run that starts over does not read that one's first blood.
  useEffect(() => {
    if (run === undefined) return
    const check = () => {
      if (client.store.getState().status === 'loading' || log.firstBlood() === null) return
      setStep((current) => (current === 'bots' ? 'blood' : current))
    }
    check()
    return log.subscribe(check)
  }, [client, log, run])

  // Over with no first blood: a draw. Your turn all the same.
  useEffect(() => {
    if (status === 'ended') setStep((current) => (current === 'bots' ? 'yours' : current))
  }, [status])

  if (intro === undefined || step === 'done') return NONE
  const end = () => setStep('done')
  switch (step) {
    case 'bots':
      return {
        transport: (
          <CoachMark
            data-coach="intro-bots"
            placement="top-start"
            step="intro 1/3"
            dismissLabel="skip"
            action={
              status === 'paused' ? { label: 'play now', onClick: () => client.play() } : undefined
            }
            onDismiss={end}
          >
            Dwarf and Imp, placed at random in one 64 KB core. Dwarf bombs every 4th byte as it
            walks back; Imp copies itself one word ahead. {INTRO_SPEED} cycles a frame.
          </CoachMark>
        ),
        events: null,
      }
    case 'blood': {
      const blood = log.firstBlood()
      const killer = log.names[(blood?.killer ?? 1) - 1] ?? 'a bot'
      const victim = log.names[blood?.bot ?? 0] ?? 'a bot'
      return {
        transport: null,
        events: (
          <CoachMark
            data-coach="intro-blood"
            placement="inline"
            step="intro 2/3"
            dismissLabel="skip"
            action={{ label: 'next', onClick: () => setStep('yours') }}
            onDismiss={end}
          >
            first blood at cycle {count(blood?.cycle ?? 0)}: {killer}&rsquo;s bomb hit {victim}.
            every death lands in this log; click a line to go back to it.
          </CoachMark>
        ),
      }
    }
    case 'yours':
      return {
        transport: null,
        events: (
          <CoachMark
            data-coach="intro-yours"
            placement="inline"
            step="intro 3/3"
            dismissLabel="done"
            action={{ label: 'pick bots', onClick: intro.onPickBots }}
            onDismiss={end}
          >
            your turn: pick bots and fight, or write your own in the editor.
          </CoachMark>
        ),
      }
  }
}
