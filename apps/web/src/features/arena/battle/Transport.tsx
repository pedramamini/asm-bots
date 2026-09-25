import { Button, Chip, hueColor, IconButton, Slider, Toggle, vars } from '@asmbots/ui'
import { FastForward, Pause, Play, SkipForward, StepBack, StepForward } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import type { ArenaClient } from '../worker/client'
import { MAX_CYCLES_PER_FRAME } from '../worker/protocol'
import type { BattleLog } from './log'
import { speedLabel } from './speed'

export interface TransportProps {
  client: ArenaClient
  log: BattleLog
  /** Whether a match goes on to its next round by itself, and what sets it. */
  autoplay: boolean
  onAutoplay: (on: boolean) => void
  /** Starts the match's next round: the first not played yet. */
  onNextRound: () => void
  /** A coach mark to pin to the play button: the intro's first step. */
  coach?: ReactNode
}

const count = (n: number) => n.toLocaleString('en-US')

/**
 * The transport under the arena (PRODUCT_SPEC §2): step back, play and pause, step, the speed (a
 * log slider from 1 to 10,000 cycles a frame, and `max`), the scrub bar, and the round with `next
 * round` between the rounds of a match.
 */
export function Transport({
  client,
  log,
  autoplay,
  onAutoplay,
  onNextRound,
  coach,
}: TransportProps) {
  const status = useStore(client.store, (state) => state.status)
  const cycle = useStore(client.store, (state) => state.cycle)
  const speed = useStore(client.store, (state) => state.speed)
  const round = useStore(client.store, (state) => state.round)
  const rounds = useStore(client.store, (state) => state.rounds)
  const played = useStore(client.store, (state) => state.match?.rounds.length ?? 0)
  const playing = status === 'playing'
  const ready = status === 'paused' || status === 'playing' || status === 'ended'
  const between = status === 'ended' && played < rounds
  // The last count, however it was set (the slider, `[`, `]`): the slider shows it while `max`
  // is on, and leaving `max` goes back to it.
  const [lastCount, setLastCount] = useState(speed === 'max' ? MAX_CYCLES_PER_FRAME : speed)
  useEffect(() => {
    if (speed !== 'max') setLastCount(speed)
  }, [speed])
  const shown = speed === 'max' ? lastCount : speed
  const setSpeed = (next: number) => client.speed(next)

  return (
    <div className="flex h-6 shrink-0 items-center gap-2">
      <IconButton
        icon={StepBack}
        label="step back"
        shortcut=","
        disabled={!ready || cycle === 0}
        onClick={() => {
          client.pause()
          client.seek(cycle - 1)
        }}
      />
      <span className="relative flex">
        <IconButton
          icon={playing ? Pause : Play}
          label={playing ? 'pause' : 'play'}
          shortcut="space"
          pressed={playing}
          disabled={!ready || status === 'ended'}
          onClick={() => (playing ? client.pause() : client.play())}
        />
        {coach}
      </span>
      <IconButton
        icon={StepForward}
        label="step"
        shortcut="."
        disabled={!ready || status === 'ended'}
        onClick={() => {
          client.pause()
          client.step(1)
        }}
      />
      <Slider
        aria-label="speed"
        min={1}
        max={MAX_CYCLES_PER_FRAME}
        scale="log"
        value={shown}
        onValueChange={setSpeed}
        format={(n) => `${count(n)}/f`}
        showValue
        className="w-40 shrink-0"
        // At max the count is not in effect: the track fades, its value stays readable.
        style={speed === 'max' ? { opacity: 0.6 } : undefined}
      />
      <IconButton
        icon={FastForward}
        label={speed === 'max' ? `back to ${speedLabel(lastCount)}` : 'max speed'}
        shortcut="]"
        pressed={speed === 'max'}
        onClick={() => client.speed(speed === 'max' ? lastCount : 'max')}
      />
      <ScrubBar client={client} log={log} disabled={!ready} />
      <Chip title={`round ${round + 1} of ${rounds}`}>
        round {round + 1}/{rounds}
      </Chip>
      {rounds > 1 && (
        <>
          <Button
            icon={SkipForward}
            size="sm"
            variant={between ? 'primary' : 'default'}
            disabled={!between}
            onClick={onNextRound}
          >
            next round
          </Button>
          <Toggle
            pressed={autoplay}
            onPressedChange={onAutoplay}
            title="go on to the next round by itself"
          >
            autoplay
          </Toggle>
        </>
      )}
    </div>
  )
}

interface ScrubBarProps {
  client: ArenaClient
  log: BattleLog
  disabled: boolean
}

/**
 * The scrub bar: the round's cycles, 0 to the cycle cap. Under the track, how far the round has
 * run (a seek back to there is quick) and a tick at each keyframe; over it, a mark in the bot's
 * hue where each bot died. A drag pauses the battle and plays it again after.
 */
function ScrubBar({ client, log, disabled }: ScrubBarProps) {
  const cycle = useStore(client.store, (state) => state.cycle)
  const maxCycles = useStore(client.store, (state) => state.config?.maxCycles ?? 1)
  const reached = useStore(client.store, (state) => state.reached)
  const keyframes = useStore(client.store, (state) => state.keyframes)
  /** Where a drag holds the thumb, ahead of the frame that lands there. */
  const [dragged, setDragged] = useState<number | null>(null)
  const drag = useRef({ on: false, resume: false })
  const at = (value: number) => `${(Math.min(value, maxCycles) / maxCycles) * 100}%`
  // The round's bot deaths as the log has them: marks that stay through a seek back. This redraws
  // with every frame, so it reads them fresh.
  const deaths = log.botDeathMarks()

  const end = () => {
    if (!drag.current.on) return
    setDragged(null)
    if (drag.current.resume) client.play()
    drag.current = { on: false, resume: false }
  }

  return (
    <div className="relative flex min-w-0 flex-1 items-center">
      <Slider
        aria-label="cycle"
        className="w-full"
        min={0}
        max={maxCycles}
        value={dragged ?? cycle}
        format={(n) => `cycle ${count(n)}`}
        disabled={disabled}
        onPointerDown={() => {
          drag.current = { on: true, resume: client.store.getState().status === 'playing' }
          client.pause()
        }}
        onPointerUp={end}
        onPointerCancel={end}
        onValueChange={(value) => {
          if (drag.current.on) setDragged(value)
          client.seek(value)
        }}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 left-0 h-px w-(--at) bg-text-dim"
        style={vars({ '--at': at(reached) })}
      />
      {Array.from(keyframes, (k) => (
        <span
          key={k}
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 left-(--at) h-1 w-px bg-text-dim"
          style={vars({ '--at': at(k) })}
        />
      ))}
      {deaths.map(({ bot, cycle: died }) => (
        <span
          key={bot}
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-(--at) h-2.5 w-0.5 -translate-y-1/2 bg-(--hue)"
          style={vars({ '--at': at(died), '--hue': hueColor(bot) })}
        />
      ))}
    </div>
  )
}
