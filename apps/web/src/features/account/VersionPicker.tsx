/**
 * Picking a version of one of my account's bots, for what takes one (a hill's `submit`, a
 * tournament's `enter`): my bots that have a version, the first to start with, then the versions
 * of the bot picked, newest first, with its size against a cap.
 */
import type { BotVersion, MyBot } from '@asmbots/protocol'
import { Select } from '@asmbots/ui'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { botQuery, useMyBots } from '../../api/queries'
import { count } from '../hills/links'

export interface VersionPick {
  /** The read of my bots. */
  readonly mine: ReturnType<typeof useMyBots>
  /** My bots that have a version. */
  readonly bots: readonly MyBot[]
  /** The bot picked; undefined when I have none. */
  readonly picked: MyBot | undefined
  readonly versions: readonly BotVersion[]
  /** The version picked; undefined while there is none. */
  readonly version: BotVersion | undefined
  pickBot(botId: string): void
  pickVersion(version: number): void
}

/** The pick: the first bot and its newest version until another is picked. */
export function useVersionPick(): VersionPick {
  const mine = useMyBots()
  const bots = (mine.data?.bots ?? []).filter((b) => b.latest !== null)
  const [botId, setBotId] = useState<string | null>(null)
  const picked = bots.find((b) => b.bot.id === botId) ?? bots[0]
  const detail = useQuery({ ...botQuery(picked?.bot.id ?? ''), enabled: !!picked })
  const versions = detail.data?.versions ?? (picked?.latest ? [picked.latest] : [])
  const [number, setNumber] = useState<number | null>(null)
  const version = versions.find((v) => v.version === number) ?? versions[0]
  return {
    mine,
    bots,
    picked,
    versions,
    version,
    pickBot: (id) => {
      setBotId(id)
      setNumber(null)
    },
    pickVersion: setNumber,
  }
}

export interface VersionFieldsProps {
  pick: VersionPick & { readonly picked: MyBot }
  /** The most bytes the version may be. */
  cap: number
  /** What follows the size when the version is over the cap: `: over the tiny hill's cap.` */
  over: string
  /** A pick changed. */
  onChange?: (() => void) | undefined
}

/** The bot and version selects, and the version's size against `cap`. */
export function VersionFields({ pick, cap, over, onChange }: VersionFieldsProps) {
  const { bots, picked, versions, version } = pick
  const tooBig = version !== undefined && version.size > cap
  return (
    <>
      <div className="grid grid-cols-[5rem_1fr] items-center gap-2">
        <span className="text-muted">bot</span>
        <Select
          aria-label="bot"
          value={picked.bot.id}
          onChange={(event) => {
            pick.pickBot(event.target.value)
            onChange?.()
          }}
        >
          {bots.map((b) => (
            <option key={b.bot.id} value={b.bot.id}>
              {b.bot.name}
            </option>
          ))}
        </Select>
        <span className="text-muted">version</span>
        <Select
          aria-label="version"
          value={version?.version ?? ''}
          onChange={(event) => {
            pick.pickVersion(Number(event.target.value))
            onChange?.()
          }}
        >
          {versions.map((v) => (
            <option key={v.id} value={v.version}>
              v{v.version} · {count(v.size)} B
            </option>
          ))}
        </Select>
      </div>
      {version !== undefined && (
        <p className={tooBig ? 'text-danger' : 'text-muted'}>
          {count(version.size)} / {count(cap)} B{tooBig ? over : ''}
        </p>
      )}
    </>
  )
}
