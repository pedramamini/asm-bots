/**
 * Roster bots for the Playwright specs, assembled by Bun: the roster imports its sources as text
 * (`with { type: 'text' }`), which Node, and so the Playwright runner, cannot load.
 */
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const APP = fileURLToPath(new URL('..', import.meta.url))

/** A bot as a spec hands it to the page: its name and machine code. */
export interface RosterBot {
  name: string
  bytes: number[]
}

/** The roster bots of `slugs`, in order. A slug's second copy is named `<name> 2`, and so on. */
export function rosterBots(slugs: readonly string[]): RosterBot[] {
  const script = `
    import { fighter } from '@asmbots/bots'
    const copies = new Map()
    const bots = ${JSON.stringify(slugs)}.map((slug) => {
      const bot = fighter(slug)
      const n = (copies.get(slug) ?? 0) + 1
      copies.set(slug, n)
      return { name: n === 1 ? bot.name : bot.name + ' ' + n, bytes: Array.from(bot.bytes) }
    })
    console.log(JSON.stringify(bots))`
  return JSON.parse(execFileSync('bun', ['--eval', script], { cwd: APP, encoding: 'utf8' }))
}
