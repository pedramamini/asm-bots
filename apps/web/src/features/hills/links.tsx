/** Links from a table cell to a bot and to a user, and the words the server's records read as. */
import type { BotLabel, ReplayConfig } from '@asmbots/protocol'
import { Link } from '@tanstack/react-router'

/** A link inside running text or a table cell. */
export const CELL_LINK =
  'rounded-sm text-bright underline-offset-2 hover:text-accent hover:underline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-accent'

export function BotLink({ bot }: { bot: BotLabel }) {
  return (
    <Link to="/bots/$id" params={{ id: bot.botId }} className={CELL_LINK}>
      {bot.name}
    </Link>
  )
}

export function UserLink({ handle }: { handle: string }) {
  return (
    <Link to="/u/$handle" params={{ handle }} className={CELL_LINK}>
      {handle}
    </Link>
  )
}

/** Who wrote the bot: its `%author`, else its owner. */
export function authorOf(bot: BotLabel): string {
  return bot.author ?? bot.owner
}

export const count = (n: number) => n.toLocaleString('en-US')

/** `1 bot`, `3 bots`. */
export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/** `100k`, `50k`, `1,500`. */
export function short(n: number): string {
  return n >= 10_000 && n % 1000 === 0 ? `${n / 1000}k` : count(n)
}

/** A hill's rules in one line: `10 rounds · 100k cycles · 512 B`. */
export function rules(rounds: number, config: ReplayConfig): string {
  return `${rounds} rounds · ${short(config.maxCycles)} cycles · ${count(config.maxBotBytes)} B`
}

/** The day of an ISO time: `2026-09-24`. */
export const day = (iso: string) => iso.slice(0, 10)
