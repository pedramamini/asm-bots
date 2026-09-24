/**
 * A round robin tournament (PRODUCT_SPEC §4): the results matrix (`ResultsMatrix`) beside the
 * standings, live as the runner saves; a cell selects its match, whose panel shows the rounds with
 * `watch` on each. The downloads: the standings CSV and `results.json`.
 */
import { roundRobinSchedule, type Standing } from '@asmbots/tourney'
import { Button, Panel } from '@asmbots/ui'
import { Download } from 'lucide-react'
import { useMemo, useState } from 'react'
import { downloadResults, downloadStandings } from './export'
import { MatchPanel } from './MatchPanel'
import { ResultsMatrix } from './ResultsMatrix'
import { StandingsTable } from './Standings'
import type { Tournament } from './store'
import { matchVerify } from './verify'
import { useRoundWatch, WatchModal } from './WatchModal'

export interface RoundRobinViewProps {
  tournament: Tournament
  /** Makes the watch modal's arena client; tests pass a stand-in. */
  createClient?: Parameters<typeof WatchModal>[0]['createClient']
}

export function RoundRobinView({ tournament: t, createClient }: RoundRobinViewProps) {
  const [selected, setSelected] = useState<number | null>(null)
  const watching = useRoundWatch()
  const n = t.entrants.length
  const schedule = useMemo(() => (n < 2 ? [] : roundRobinSchedule(n)), [n])
  const standings = (t.standings ?? []) as readonly Standing[]
  const spec = selected === null ? undefined : schedule[selected]
  const result = selected === null ? undefined : t.matches[selected]

  const actions = (
    <>
      <Button
        size="sm"
        icon={Download}
        disabled={t.standings === undefined}
        onClick={() => downloadStandings(t)}
      >
        standings.csv
      </Button>
      <Button size="sm" icon={Download} onClick={() => downloadResults(t)}>
        results.json
      </Button>
    </>
  )

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Panel
          title="results"
          status={`${t.matches.length} of ${schedule.length} matches`}
          actions={actions}
          className="min-w-0"
        >
          <ResultsMatrix tournament={t} selected={selected} onSelect={setSelected} />
        </Panel>
        <Panel title="standings" status={`${n} bots`} className="min-w-0">
          <StandingsTable rows={standings} champion={t.champion} className="max-h-96" />
        </Panel>
      </div>
      {spec !== undefined && result !== undefined && (
        <MatchPanel
          title={`${result.names.join(' v ')} · match ${(selected as number) + 1}`}
          status="done"
          entrants={spec.entrants.map((e) => ({ name: t.entrants[e]?.name ?? `bot ${e + 1}` }))}
          result={result}
          winner={winnerOf(result.points)}
          onWatch={(round) => watching.watch(t, spec.entrants, result, round)}
          actions={matchVerify(
            t,
            result,
            `${result.names.join(' v ')} · match ${(selected as number) + 1}`,
          )}
        />
      )}
      <WatchModal target={watching.target} onClose={watching.close} createClient={createClient} />
    </div>
  )
}

/** The index of the sole top scorer, or null for a tie. */
function winnerOf(points: readonly number[]): number | null {
  const top = Math.max(...points)
  const at = points.flatMap((p, i) => (p === top ? [i] : []))
  return at.length === 1 ? (at[0] as number) : null
}
