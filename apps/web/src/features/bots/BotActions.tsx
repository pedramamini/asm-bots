import type { Bot } from '@asmbots/protocol'
import { Button, Menu, useToast } from '@asmbots/ui'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { GitFork, Swords } from 'lucide-react'
import { meQuery } from '../../api/queries'
import { LOCAL_BOTS_KEY, type LocalBot, useLocalBots } from '../../store/local-bots'
import type { ArenaConfig } from '../../store/settings'
import { DEFAULT_ARENA_CONFIG } from '../arena/setup/config'
import type { ArenaSearch } from '../arena/setup/search'
import { type BotRef, type SharedBot, searchFromSetup, sharedFragment } from '../arena/setup/url'
import { forkIntoMyBots } from './cloud'

/**
 * The arena of `challenge`: my bot `mine` against `bot` (`source`, the version to fight), mine
 * first, under `config`: a duel on a random seed unless given. The bot plays as the local bot
 * linked to it when this browser has one, else as a bot the link carries, keyed by its account id.
 */
export function challengeLink(
  bot: Pick<Bot, 'id'>,
  source: string,
  mine: LocalBot,
  local: readonly LocalBot[],
  config: ArenaConfig = DEFAULT_ARENA_CONFIG,
): { search: ArenaSearch; hash: string } {
  const linked = local.find((b) => b.cloudId === bot.id && b.source === source)
  const theirs: BotRef = { kind: 'local', id: linked?.id ?? bot.id }
  const shared: SharedBot[] = linked === undefined ? [{ id: bot.id, source }] : []
  const search = searchFromSetup({ bots: [{ kind: 'local', id: mine.id }, theirs], config })
  return { search, hash: sharedFragment(shared) }
}

/**
 * The bot page's actions (PRODUCT_SPEC §6): `fork` copies the bot into my bots (the account's too
 * when signed in) and opens it in the editor; `challenge ▾` picks one of my bots to fight it in
 * the arena. Both need the source, so both wait while it is not public.
 */
export function BotActions({ bot, source }: { bot: Bot; source: string | undefined }) {
  const navigate = useNavigate()
  const client = useQueryClient()
  const { toast } = useToast()
  const local = useLocalBots().data ?? []
  const hidden = source === undefined ? 'its source is not public' : undefined

  const fork = async () => {
    if (source === undefined) return
    try {
      // Asked at the click, so a click before the account has loaded still counts it.
      const signedIn = (await client.ensureQueryData(meQuery()).catch(() => null)) !== null
      const { local: copy, cloud } = await forkIntoMyBots({ name: bot.name, source }, signedIn)
      await Promise.all([
        client.invalidateQueries({ queryKey: LOCAL_BOTS_KEY }),
        cloud && client.invalidateQueries({ queryKey: ['me', 'bots'] }),
      ])
      toast(
        signedIn && !cloud
          ? `forked ${bot.name} into this browser; your account did not take it.`
          : `forked ${bot.name} into my bots.`,
        { variant: signedIn && !cloud ? 'warn' : 'accent' },
      )
      void navigate({ to: '/editor/$botId', params: { botId: copy.id } })
    } catch {
      toast('could not save the bot in this browser.', { variant: 'danger' })
    }
  }

  const challenge = (mine: LocalBot) => {
    if (source === undefined) return
    const { search, hash } = challengeLink(bot, source, mine, local)
    void navigate({ to: '/arena', search, hash })
  }

  const mine = local.filter((b) => b.cloudId !== bot.id)
  return (
    <div className="flex gap-1">
      <Button
        size="sm"
        icon={GitFork}
        disabled={source === undefined}
        title={hidden}
        onClick={() => void fork()}
      >
        fork
      </Button>
      <Menu
        placement="bottom-end"
        trigger={
          <Button
            size="sm"
            icon={Swords}
            disabled={source === undefined || mine.length === 0}
            title={hidden ?? (mine.length === 0 ? 'save a bot of your own first' : undefined)}
          >
            challenge ▾
          </Button>
        }
        items={mine.map((b) => ({ label: b.name, onSelect: () => challenge(b) }))}
      />
    </div>
  )
}
