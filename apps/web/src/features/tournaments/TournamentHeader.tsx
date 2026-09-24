/**
 * A tournament's header (PRODUCT_SPEC §4): its name, kind, and status, the live controls, `share`,
 * and the entrants as chips with their identicons, the champion's in accent. A shared tournament
 * (a link's snapshot, `share.ts`) has no controls: nothing runs it in this browser.
 */
import { Button, Chip, Identicon, Panel, useToast } from '@asmbots/ui'
import { Link } from 'lucide-react'
import { copyTournamentLink } from './share'
import { KIND_LABELS, type Tournament } from './store'
import { StatusChip, TournamentControls } from './TournamentControls'
import { identiconValue } from './TournamentsPage'

export interface TournamentHeaderProps {
  tournament: Tournament
  /** A tournament read from a link, not stored in this browser. */
  shared?: boolean | undefined
  /** Makes the auto-watch arena client; tests pass a stand-in. */
  createClient?: Parameters<typeof TournamentControls>[0]['createClient']
}

export function TournamentHeader({
  tournament: t,
  shared = false,
  createClient,
}: TournamentHeaderProps) {
  const { toast } = useToast()
  const share = (
    <Button size="sm" icon={Link} onClick={() => void copyTournamentLink(t, toast)}>
      share
    </Button>
  )
  const n = t.entrants.length
  return (
    <Panel title={t.name} status={`${n} ${n === 1 ? 'bot' : 'bots'}`} actions={share}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Chip>{KIND_LABELS[t.kind]}</Chip>
          {shared ? (
            <>
              <StatusChip tournament={t} />
              <Chip variant="info">shared</Chip>
              <span className="text-data text-muted">
                a snapshot from a link: nothing runs it in this browser.
              </span>
            </>
          ) : (
            <TournamentControls tournament={t} createClient={createClient} />
          )}
        </div>
        <ul aria-label="entrants" className="flex flex-wrap gap-1">
          {t.entrants.map((entrant, e) => (
            <li key={entrant.name}>
              <Chip
                variant={e === t.champion ? 'accent' : 'neutral'}
                title={e === t.champion ? 'champion' : undefined}
              >
                <Identicon value={identiconValue(entrant)} size={8} />
                {entrant.name}
              </Chip>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  )
}
