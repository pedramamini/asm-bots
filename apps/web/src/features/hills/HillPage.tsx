import { liveRoomName } from '@asmbots/protocol'
import { Panel, PanelGrid } from '@asmbots/ui'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { isNotFound } from '../../api/client'
import { useHill, useHillMatches } from '../../api/queries'
import { LoadFailure, readStatus } from '../../app/LoadFailure'
import { Placeholder } from '../../app/Placeholder'
import type { ArenaClient } from '../arena/worker/client'
import { LivePanel } from '../live/LivePanel'
import type { LiveRoomOptions } from '../live/room'
import { useLiveRoom } from '../live/useLiveRoom'
import { ChallengeMenu } from './ChallengeMenu'
import { HillFeed } from './HillFeed'
import { HillStandingsTable } from './HillStandingsTable'
import { KingCard } from './KingCard'
import { rules } from './links'
import { MatchesTable } from './MatchesTable'
import { SubmissionPanel } from './SubmissionPanel'
import { SubmitButton } from './SubmitModal'

/** The recent matches a hill page lists. */
const RECENT = 20

export interface HillPageProps {
  slug: string
  /** The submission the page follows (`?submission=`), or null. */
  submission?: string | null | undefined
  /** The live room's socket and timers; tests pass stand-ins. Default: the browser's. */
  live?: LiveRoomOptions | undefined
  /** Makes the live arena's client; tests pass one without a Worker. */
  createArenaClient?: (() => ArenaClient) | undefined
}

/**
 * `/hills/$slug` (PRODUCT_SPEC §5): the hill's standings, king first, each with `challenge`, and
 * `submit`; beside them the hill's live room (the match its `Runner` is fighting, run here too,
 * PRODUCT_SPEC §4), the submission the page follows (its progress, then its result), the king's
 * card, the recent submissions, and the recent matches. A job that ends in the room loads the
 * hill's reads again, for whoever is watching.
 */
export function HillPage({ slug, submission = null, live, createArenaClient }: HillPageProps) {
  const hill = useHill(slug)
  const matches = useHillMatches(slug, { limit: RECENT })
  const navigate = useNavigate()
  const client = useQueryClient()
  const hillId = hill.data?.hill.id
  const room = useLiveRoom(
    hillId === undefined ? null : liveRoomName({ kind: 'hill', id: hillId }),
    live,
  )
  const { endings } = room
  useEffect(() => {
    if (endings > 0) void client.invalidateQueries({ queryKey: ['hills', slug] })
  }, [endings, client, slug])
  if (isNotFound(hill.error)) {
    return (
      <Placeholder title="hills" status={slug} action={{ label: 'all hills', to: '/hills' }}>
        there is no hill named {slug}.
      </Placeholder>
    )
  }
  const detail = hill.data
  const follow = (id: string | null) =>
    void navigate({
      to: '/hills/$slug',
      params: { slug },
      search: id === null ? {} : { submission: id },
    })
  return (
    <PanelGrid className="p-3">
      <Panel
        className="col-span-12 xl:col-span-8"
        title={detail?.hill.name ?? slug}
        status={readStatus(detail, hill.error, (d) => rules(d.hill.rounds, d.hill.config))}
        actions={
          <SubmitButton
            hill={detail?.hill}
            entrants={detail?.standings.length ?? 0}
            onSubmitted={follow}
          />
        }
      >
        {hill.error !== null && detail === undefined ? (
          <LoadFailure error={hill.error} />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            {detail !== undefined && (
              <p className="text-data text-muted">
                {detail.hill.description} {detail.standings.length} of {detail.hill.size} places
                taken.
              </p>
            )}
            <HillStandingsTable
              aria-label="standings"
              standings={detail?.standings}
              action={detail && ((s) => <ChallengeMenu hill={detail.hill} standing={s} />)}
            />
          </div>
        )}
      </Panel>
      <div className="col-span-12 flex min-w-0 flex-col gap-3 xl:col-span-4">
        {detail !== undefined && <LivePanel live={room} createClient={createArenaClient} />}
        {submission !== null && detail !== undefined && (
          <SubmissionPanel
            hill={detail.hill}
            id={submission}
            onClose={() => follow(null)}
            live={room}
          />
        )}
        <KingCard king={detail === undefined ? undefined : (detail.standings[0] ?? null)} />
        <HillFeed slug={slug} />
        <Panel
          title="recent matches"
          status={readStatus(matches.data, matches.error, (d) => `last ${d.matches.length}`)}
        >
          {matches.error !== null && matches.data === undefined ? (
            <LoadFailure error={matches.error} />
          ) : (
            <MatchesTable aria-label="recent matches" matches={matches.data?.matches} />
          )}
        </Panel>
      </div>
    </PanelGrid>
  )
}
