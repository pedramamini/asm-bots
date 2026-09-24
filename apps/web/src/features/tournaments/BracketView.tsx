/**
 * A bracket tournament (PRODUCT_SPEC §4): the bracket (`BracketSvg`), live as the runner saves,
 * and under it the match panel of the match selected; `watch` on a round replays it in the arena
 * (`WatchModal`). The panel's actions download `bracket.svg` and `results.json`.
 */
import { type BracketMatch, type MatchRound, nextMatches, roundTitle } from '@asmbots/tourney'
import { Button, Panel } from '@asmbots/ui'
import { Download } from 'lucide-react'
import { useMemo, useState } from 'react'
import { BracketSvg } from './BracketSvg'
import { downloadBracket, downloadResults } from './export'
import { MatchPanel } from './MatchPanel'
import type { Tournament } from './store'
import { useRoundWatch, WatchModal } from './WatchModal'

export interface BracketViewProps {
  tournament: Tournament
  /** Makes the watch modal's arena client; tests pass a stand-in. */
  createClient?: Parameters<typeof WatchModal>[0]['createClient']
}

/** The match the runner plays now: the first ready one, as `iterateBracket` takes them. */
export function liveMatches(t: Tournament): number[] {
  if (t.status !== 'running' || t.bracket === undefined) return []
  const next = nextMatches(t.bracket)[0]
  return next === undefined ? [] : [next.id]
}

/** `semifinals · match 5`, `third place · match 8`. */
function matchTitle(t: Tournament, m: BracketMatch): string {
  const rounds = t.bracket?.rounds ?? 1
  const where = m.thirdPlace ? 'third place' : roundTitle(m.round, rounds)
  return `${where} · match ${m.id + 1}`
}

export function BracketView({ tournament: t, createClient }: BracketViewProps) {
  const [selected, setSelected] = useState<number | null>(null)
  const watching = useRoundWatch()
  const live = useMemo(() => liveMatches(t), [t])
  const bracket = t.bracket
  const match = bracket === undefined || selected === null ? undefined : bracket.matches[selected]

  const actions = (
    <>
      <Button
        size="sm"
        icon={Download}
        disabled={bracket === undefined}
        onClick={() => downloadBracket(t)}
      >
        bracket.svg
      </Button>
      <Button size="sm" icon={Download} onClick={() => downloadResults(t)}>
        results.json
      </Button>
    </>
  )

  return (
    <div className="flex flex-col gap-3">
      <Panel
        title="bracket"
        status={bracket === undefined ? 'not drawn yet' : `${t.entrants.length} bots`}
        actions={actions}
      >
        {bracket === undefined ? (
          <p className="text-data text-muted">the bracket is drawn when the tournament starts.</p>
        ) : (
          <BracketSvg bracket={bracket} live={live} selected={selected} onSelect={setSelected} />
        )}
      </Panel>
      {bracket !== undefined && match !== undefined && (
        <BracketMatchPanel
          tournament={t}
          match={match}
          live={live.includes(match.id)}
          onWatch={(round) => {
            if (match.result === null) return
            const entrants = match.slots.map((s) => s.entrant as number)
            watching.watch(t, entrants, match.result, round)
          }}
        />
      )}
      <WatchModal target={watching.target} onClose={watching.close} createClient={createClient} />
    </div>
  )
}

function BracketMatchPanel({
  tournament: t,
  match: m,
  live,
  onWatch,
}: {
  tournament: Tournament
  match: BracketMatch
  live: boolean
  onWatch: (round: MatchRound) => void
}) {
  const bracket = t.bracket
  if (bracket === undefined) return null
  const entrants = m.slots.map((slot) =>
    slot.state === 'filled'
      ? {
          name: bracket.names[slot.entrant as number] as string,
          seed: bracket.seeds[slot.entrant as number],
        }
      : { name: slot.state === 'bye' ? 'bye' : 'to be decided' },
  )
  const winner = m.winner === null ? null : m.slots.findIndex((s) => s.entrant === m.winner)
  const note =
    m.status === 'walkover'
      ? `a walkover: ${bracket.names[m.winner as number]} goes through.`
      : m.status === 'empty'
        ? 'no bots: both slots are byes.'
        : live
          ? 'playing now.'
          : m.status === 'ready'
            ? 'ready: it plays when the matches before it in the bracket have.'
            : 'waits for the matches before it.'
  return (
    <MatchPanel
      title={matchTitle(t, m)}
      status={live ? 'live' : m.status}
      entrants={entrants}
      result={m.result}
      winner={winner}
      note={note}
      onWatch={onWatch}
    />
  )
}
