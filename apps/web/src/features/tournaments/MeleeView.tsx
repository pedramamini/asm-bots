/**
 * A melee tournament (PRODUCT_SPEC §4): the standings, each bot with a histogram of the rounds by
 * the cycles it lived (0 at the left, the cycle cap at the right), live as the runner saves; under
 * them the melee's rounds, `watch round N` on each. The downloads: the standings CSV and
 * `results.json`.
 */
import type { MeleeStanding } from '@asmbots/tourney'
import { Button, Panel, Sparkline, type TableColumn } from '@asmbots/ui'
import { Download } from 'lucide-react'
import { useMemo } from 'react'
import { downloadResults, downloadStandings } from './export'
import { MatchPanel } from './MatchPanel'
import { StandingsTable } from './Standings'
import type { Tournament } from './store'
import { useRoundWatch, WatchModal } from './WatchModal'

export interface MeleeViewProps {
  tournament: Tournament
  /** Makes the watch modal's arena client; tests pass a stand-in. */
  createClient?: Parameters<typeof WatchModal>[0]['createClient']
}

/** `Dwarf survival, …: 2 · 0 · 5`: the histogram as the label of its image. */
function histogramLabel(s: MeleeStanding): string {
  return `${s.name} survival, rounds per tenth of the cycles, fewest first: ${s.histogram.join(' · ')}`
}

/** The survival columns: the histogram, every bot's on one scale, and the mean cycles lived. */
function survivalColumns(standings: readonly MeleeStanding[]): TableColumn<MeleeStanding>[] {
  const top = Math.max(1, ...standings.flatMap((s) => s.histogram))
  const mean = (s: MeleeStanding) =>
    s.survival.length === 0 ? 0 : s.survival.reduce((a, b) => a + b, 0) / s.survival.length
  return [
    {
      id: 'survival',
      header: 'survival',
      cell: (s) => (
        <Sparkline
          bars
          values={s.histogram}
          max={top}
          width={80}
          height={16}
          hue={s.entrant}
          aria-label={histogramLabel(s)}
          className="align-middle"
        />
      ),
      className: 'w-24',
    },
    {
      id: 'lived',
      header: 'mean cycles',
      cell: (s) => Math.round(mean(s)).toLocaleString('en-US'),
      align: 'right',
      sortValue: mean,
      className: 'w-24',
    },
  ]
}

export function MeleeView({ tournament: t, createClient }: MeleeViewProps) {
  const watching = useRoundWatch()
  const standings = (t.standings ?? []) as readonly MeleeStanding[]
  const extra = useMemo(() => survivalColumns(standings), [standings])
  const match = t.matches[0] ?? null
  const all = t.entrants.map((_, e) => e)
  const live = t.status === 'running'

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
      <Panel
        title="standings"
        status={`${t.entrants.length} bots · ${match?.rounds.length ?? 0} of ${t.rounds} rounds`}
        actions={actions}
      >
        <StandingsTable rows={standings} extra={extra} champion={t.champion} className="max-h-96" />
      </Panel>
      <MatchPanel
        title="rounds"
        status={
          live ? 'live' : match !== null && match.rounds.length === match.of ? 'done' : 'pending'
        }
        entrants={t.entrants.map((e) => ({ name: e.name }))}
        result={match}
        note={live ? 'the first round is playing now.' : 'not played yet.'}
        onWatch={(round) => {
          if (match !== null) watching.watch(t, all, match, round)
        }}
      />
      <WatchModal target={watching.target} onClose={watching.close} createClient={createClient} />
    </div>
  )
}
