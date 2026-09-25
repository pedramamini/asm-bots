import type { BotLabel } from './api'

/**
 * The entrants' names, one each: a bot's name, and its owner's handle after it when another
 * entrant has the same name (`Dwarf (alice)`, `Dwarf (bob)`). The tournament pages and their share
 * cards name entrants this way.
 */
export function entrantNames(labels: readonly Pick<BotLabel, 'name' | 'owner'>[]): string[] {
  const seen = new Map<string, number>()
  for (const label of labels) seen.set(label.name, (seen.get(label.name) ?? 0) + 1)
  return labels.map((label) =>
    (seen.get(label.name) ?? 0) > 1 ? `${label.name} (${label.owner})` : label.name,
  )
}
