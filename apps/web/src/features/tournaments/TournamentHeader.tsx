/**
 * A tournament's header (PRODUCT_SPEC §4): its name, kind, and status, the live controls,
 * `share ▾`, and the entrants as chips with their identicons, the champion's in accent. A shared
 * tournament (a link's snapshot, `share.ts`) has no controls: nothing runs it in this browser.
 * `share ▾` copies the tournament's link (it carries the tournament) and saves a bracket as a PNG;
 * a tournament of this browser has no card or stored match on the server to share.
 */
import { Chip, Identicon, Panel, useToast } from '@asmbots/ui'
import { ShareMenu } from '../share/ShareMenu'
import { downloadBracketPng } from './export'
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
  const savePng = async () => {
    if (!(await downloadBracketPng(t))) toast('could not make the image.', { variant: 'danger' })
  }
  const share = (
    <ShareMenu
      link={() => void copyTournamentLink(t, toast)}
      png={t.bracket === undefined ? undefined : () => void savePng()}
    />
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
