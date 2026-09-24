import { Panel, PanelGrid } from '@asmbots/ui'
import { isNotFound } from '../../api/client'
import { useHill, useHillMatches } from '../../api/queries'
import { LoadFailure, readStatus } from '../../app/LoadFailure'
import { Placeholder } from '../../app/Placeholder'
import { HillStandingsTable } from './HillStandingsTable'
import { rules } from './links'
import { MatchesTable } from './MatchesTable'

/** The recent matches a hill page lists. */
const RECENT = 20

/** `/hills/$slug` (PRODUCT_SPEC §5): the hill's standings, king first, and its recent matches. */
export function HillPage({ slug }: { slug: string }) {
  const hill = useHill(slug)
  const matches = useHillMatches(slug, { limit: RECENT })
  if (isNotFound(hill.error)) {
    return (
      <Placeholder title="hills" status={slug} action={{ label: 'all hills', to: '/hills' }}>
        there is no hill named {slug}.
      </Placeholder>
    )
  }
  const detail = hill.data
  return (
    <PanelGrid className="p-3">
      <Panel
        className="col-span-12 xl:col-span-8"
        title={detail?.hill.name ?? slug}
        status={readStatus(detail, hill.error, (d) => rules(d.hill.rounds, d.hill.config))}
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
            <HillStandingsTable aria-label="standings" standings={detail?.standings} />
          </div>
        )}
      </Panel>
      <Panel
        className="col-span-12 xl:col-span-4"
        title="recent matches"
        status={readStatus(matches.data, matches.error, (d) => `last ${d.matches.length}`)}
      >
        {matches.error !== null && matches.data === undefined ? (
          <LoadFailure error={matches.error} />
        ) : (
          <MatchesTable aria-label="recent matches" matches={matches.data?.matches} />
        )}
      </Panel>
    </PanelGrid>
  )
}
