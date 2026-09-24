/**
 * `challenge` on a hill's standings (PRODUCT_SPEC §5): one of my bots against the entry in the
 * arena, under the hill's rules and seed, mine first as the hill plays a challenger: the match the
 * server would play. The entry's version loads when a bot is picked; a private one has no source.
 */
import type { Hill, HillStanding } from '@asmbots/protocol'
import { Button, Menu, useToast } from '@asmbots/ui'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Swords } from 'lucide-react'
import { botVersionQuery } from '../../api/queries'
import { type LocalBot, useLocalBots } from '../../store/local-bots'

export function ChallengeMenu({ hill, standing }: { hill: Hill; standing: HillStanding }) {
  const local = useLocalBots().data ?? []
  const client = useQueryClient()
  const navigate = useNavigate()
  const { toast } = useToast()
  const { bot } = standing
  const mine = local.filter((b) => b.cloudId !== bot.botId)
  const fight = async (picked: LocalBot) => {
    try {
      const [{ version }, { hillChallenge }] = await Promise.all([
        client.fetchQuery(botVersionQuery(bot.botId, bot.version)),
        import('./challenge'),
      ])
      if (version.source === undefined) {
        toast(`${bot.name}'s source is not public: it fights on the server only.`, {
          variant: 'warn',
        })
        return
      }
      const { search, hash } = hillChallenge(hill, bot.botId, version.source, picked, local)
      void navigate({ to: '/arena', search, hash })
    } catch {
      toast(`could not load ${bot.name}.`, { variant: 'danger' })
    }
  }
  return (
    <Menu
      placement="bottom-end"
      trigger={
        <Button
          size="sm"
          icon={Swords}
          aria-label={`challenge ${bot.name}`}
          disabled={mine.length === 0}
          title={mine.length === 0 ? 'save a bot of your own first' : undefined}
        >
          challenge ▾
        </Button>
      }
      items={mine.map((b) => ({ label: b.name, onSelect: () => void fight(b) }))}
    />
  )
}
