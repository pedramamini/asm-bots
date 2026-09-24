/**
 * The arena of a hill's `challenge`: loaded when a challenge is picked, since the arena's setup
 * code brings the roster and the assembler with it.
 */
import { HILL_SEED, type Hill } from '@asmbots/protocol'
import type { LocalBot } from '../../store/local-bots'
import type { ArenaConfig } from '../../store/settings'
import { presetOf, ROUNDS } from '../arena/setup/config'
import { challengeLink } from '../bots/BotActions'

/**
 * A hill's rules as the arena's config: its rounds (the arena's most at the top), cycles, process
 * cap, spacing, and its seed, so the arena's battle is the match the hill plays.
 */
export function hillArenaConfig(hill: Hill): ArenaConfig {
  const values = {
    rounds: Math.min(hill.rounds, ROUNDS.max),
    maxCycles: hill.config.maxCycles,
    maxProcesses: hill.config.maxProcesses,
    minSpacing: hill.config.minSpacing,
  }
  return { ...values, preset: presetOf(values), seed: HILL_SEED }
}

/** My bot `mine` against bot `botId`'s version `source`, under `hill`'s rules, mine first. */
export function hillChallenge(
  hill: Hill,
  botId: string,
  source: string,
  mine: LocalBot,
  local: readonly LocalBot[],
) {
  return challengeLink({ id: botId }, source, mine, local, hillArenaConfig(hill))
}
