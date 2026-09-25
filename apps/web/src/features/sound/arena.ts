/**
 * The arena's cues (DESIGN_SYSTEM §7) from a battle's messages: a tick for a frame of a few cycles
 * (a step, the slowest speeds), a click for a frame's writes, a thud for its processes' deaths, a
 * falling tone for a bot's death, three rising notes when a match ends with one winner, and a
 * click when the battle plays, pauses, or changes speed. A full frame (a load, a seek) carries no
 * activity and makes no sound, but one cycle back is a step back, and ticks. The arena's battle
 * view plays them; the home demo and the other arenas that play by themselves stay silent.
 */
import { meleeStandings } from '@asmbots/tourney'
import { useEffect } from 'react'
import { matchOutcome, roundOutcome } from '../arena/battle/outcome'
import type { ArenaClient, ArenaState } from '../arena/worker/client'
import { BOT_DEATH_FIELDS, DEATH_FIELDS, type EndedMessage } from '../arena/worker/protocol'
import { appSound, type SoundEngine } from './engine'

/** A frame of at most this many cycles ticks: a step, or the slowest speeds. */
export const TICK_CYCLES = 10

/** What sounds the cues. */
export type CuePlayer = Pick<SoundEngine, 'play'>

/** Plays the cues of `client`'s battle on `sound` from now on. Returns what stops it. */
export function attachArenaSound(
  client: Pick<ArenaClient, 'on' | 'store'>,
  sound: CuePlayer,
): () => void {
  /** The last frame's cycle; null until the round's first frame. */
  let last: number | null = null
  const offs = [
    client.on('loaded', () => {
      last = null
    }),
    client.on('frame', (frame) => {
      const from = last
      last = frame.cycle
      if (from === null) return
      if (frame.ownerDirty !== null) {
        if (from - frame.cycle === 1) sound.play('tick')
        return
      }
      const cycles = frame.cycle - from
      if (cycles <= 0) return
      // A bot's death is its last process's too: the thud is for the others.
      const botDeaths = frame.botDeaths.length / BOT_DEATH_FIELDS
      const deaths = frame.deaths.length / DEATH_FIELDS - botDeaths
      if (botDeaths > 0) sound.play('botDeath', { bot: frame.botDeaths[1] })
      if (deaths > 0) sound.play('death', { weight: deaths })
      if (frame.writes.length > 0) sound.play('write', { weight: frame.writes.length / 2 })
      if (cycles <= TICK_CYCLES) sound.play('tick')
    }),
    client.on('ended', (message) => {
      if (won(message, client.store.getState())) sound.play('victory')
    }),
    client.store.subscribe((state, previous) => {
      const toggled =
        (state.status === 'playing' && previous.status === 'paused') ||
        (state.status === 'paused' && previous.status === 'playing')
      if (toggled || state.speed !== previous.speed) sound.play('click')
    }),
  ]
  return () => {
    for (const off of offs) off()
  }
}

/** Plays the cues of `client`'s battle on the app's engine while the component is mounted. */
export function useArenaSound(client: ArenaClient): void {
  useEffect(() => attachArenaSound(client, appSound()), [client])
}

/**
 * Whether `ended` ends the match with one winner, as the victory overlay heads it: the match's
 * points for a match of more rounds, else the round's last bot standing.
 */
function won({ result, match }: EndedMessage, { order, botMeta, config }: ArenaState): boolean {
  if (match.rounds.length < match.of) return false
  const outcome =
    match.of > 1
      ? matchOutcome(match, meleeStandings(match, config ?? {}))
      : roundOutcome(
          result,
          order,
          botMeta.map((bot) => bot.name),
        )
  return outcome.kind === 'winner'
}
