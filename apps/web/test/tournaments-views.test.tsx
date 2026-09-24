/**
 * The round robin and melee views, and the live controls (src/features/tournaments): the results
 * matrix (a cell per pair played, the diagonal blank, the match in flight marked), its tooltip and
 * match panel, the sortable standings and their CSV; the melee's survival histograms and `watch
 * round N`; and the status chip, pause/resume/cancel, and auto-watch on a runner's match event.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import type { BattleConfigInput } from '@asmbots/engine'
import { csv, type MatchResult, melee, roundRobin, roundRobinSchedule } from '@asmbots/tourney'
import { ToastProvider } from '@asmbots/ui'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { stubLayout, useDom, window } from '../../../packages/ui/test/dom'
import type { ArenaClient } from '../src/features/arena/worker/client'
import { MeleeView } from '../src/features/tournaments/MeleeView'
import { cellTone, type MatrixCell } from '../src/features/tournaments/ResultsMatrix'
import { RoundRobinView } from '../src/features/tournaments/RoundRobinView'
import {
  entrantBots,
  type RunnerEvent,
  type TournamentRunner,
} from '../src/features/tournaments/runner'
import type { Tournament, TournamentEntrant } from '../src/features/tournaments/store'
import { TournamentControls } from '../src/features/tournaments/TournamentControls'
import { liveWatchTarget } from '../src/features/tournaments/watch'
import { stubCanvas } from './fake-canvas'
import { manualSchedule, type SessionWorker, sessionClient } from './session-worker'

useDom()
window.scrollTo = () => {}

const CONFIG: BattleConfigInput = { maxCycles: 4_000, maxProcesses: 64, minSpacing: 1024, seed: 7 }

const roster = (...names: string[]): TournamentEntrant[] =>
  names.map((name) => ({ source: 'roster', ref: name.toLowerCase(), name }))

const FOUR = roster('Dwarf', 'Imp', 'Paper', 'Stone')

/** A round robin of the four, 2 rounds a match, played to `upTo` matches. */
function roundRobinCup(change: Partial<Tournament> = {}, upTo = 6): Tournament {
  const whole = roundRobin(entrantBots(FOUR), CONFIG, { rounds: 2 })
  const top = whole.standings[0]?.entrant ?? null
  return {
    id: 'rr',
    name: 'rr cup',
    kind: 'round-robin',
    entrants: FOUR,
    config: CONFIG,
    rounds: 2,
    status: 'finished',
    matches: whole.matches.slice(0, upTo),
    standings: whole.standings,
    progress: { done: upTo, of: 6 },
    champion: top,
    createdAt: 0,
    updatedAt: 0,
    ...change,
  }
}

function meleeCup(entrants: TournamentEntrant[], rounds: number): Tournament {
  const { match, standings } = melee(entrantBots(entrants), CONFIG, rounds)
  return {
    ...roundRobinCup(),
    id: 'melee',
    name: 'melee cup',
    kind: 'melee',
    entrants,
    rounds,
    matches: [match],
    standings,
    progress: { done: rounds, of: rounds },
    champion: standings[0]?.entrant ?? null,
  }
}

const made: { client: ArenaClient; worker: SessionWorker }[] = []
const frames = manualSchedule()
function createClient(): ArenaClient {
  const next = sessionClient(frames.schedule)
  made.push(next)
  return next.client
}

const withToasts = (node: ReactNode) => render(<ToastProvider>{node}</ToastProvider>)

let restore: (() => void)[] = []
beforeAll(() => {
  restore = [
    stubCanvas(window),
    stubLayout('clientWidth', () => 800),
    stubLayout('clientHeight', () => 600),
  ]
})
afterAll(() => {
  for (const undo of restore) undo()
  for (const { client } of made.splice(0)) client.dispose()
})

const cell = (label: RegExp) => screen.getByRole('button', { name: label })

describe('ResultsMatrix', () => {
  it('fills a cell per entrant per match: 12 for 4 bots, the diagonal blank', () => {
    const t = roundRobinCup()
    withToasts(<RoundRobinView tournament={t} />)
    const matrix = screen.getByRole('table', { name: 'results matrix' })
    expect(matrix.querySelectorAll('[data-played]')).toHaveLength(12)
    expect(matrix.querySelectorAll('[data-diagonal]')).toHaveLength(4)
    // Both cells of a pair tell the same match, each from its row's side.
    const [a, b] = (t.matches[0] as MatchResult).points
    expect(cell(/^Dwarf v Imp: /).textContent).toBe(String(a))
    expect(cell(/^Imp v Dwarf: /).getAttribute('aria-label')).toBe(`Imp v Dwarf: ${b} to ${a}`)
  })

  it('tints a win by its margin, leaves a tie plain, and dims a loss', () => {
    const tone = (points: number, against: number) =>
      cellTone({ points, against } as unknown as MatrixCell)
    expect(tone(6, 0)).toContain('bg-accent-45')
    expect(tone(3, 1)).toContain('bg-accent-25')
    expect(tone(3, 2)).toContain('bg-accent-10')
    expect(tone(2, 2)).toBe('text-text')
    expect(tone(0, 3)).toBe('text-dim')
  })

  it('shows the round breakdown on hover', async () => {
    const t = roundRobinCup()
    withToasts(<RoundRobinView tournament={t} />)
    fireEvent.pointerEnter(cell(/^Imp v Dwarf: /), { pointerType: 'mouse' })
    const tip = await screen.findByRole('tooltip', {}, { timeout: 2_000 })
    const rounds = (t.matches[0] as MatchResult).rounds
    const expected = rounds.map((r) => `${r.points[1]} – ${r.points[0]}`).join(', ')
    expect(tip.textContent).toContain(`by round ${expected}`)
  })

  it('selects a match from either of its cells and replays a round of it', async () => {
    withToasts(<RoundRobinView tournament={roundRobinCup()} createClient={createClient} />)
    expect(screen.queryByRole('region', { name: 'match' })).toBeNull()
    // Match 3 of the schedule is Dwarf v Stone: entrants 0 and 3.
    expect(roundRobinSchedule(4)[2]?.entrants).toEqual([0, 3])
    fireEvent.click(cell(/^Stone v Dwarf: /))
    expect(cell(/^Dwarf v Stone: /).getAttribute('aria-pressed')).toBe('true')
    expect(cell(/^Stone v Dwarf: /).getAttribute('aria-pressed')).toBe('true')
    const panel = screen.getByRole('region', { name: 'match' })
    expect(panel.textContent).toContain('Dwarf v Stone · match 3')
    fireEvent.click(within(panel).getByRole('button', { name: 'watch round 2' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('Dwarf v Stone · round 2')
  })

  it('marks the match in flight while the tournament runs', () => {
    withToasts(<RoundRobinView tournament={roundRobinCup({ status: 'running' }, 2)} />)
    const matrix = screen.getByRole('table', { name: 'results matrix' })
    expect(matrix.querySelectorAll('[data-played]')).toHaveLength(4)
    const live = [...matrix.querySelectorAll('[data-live]')]
    expect(live).toHaveLength(2)
    // The third match, Dwarf v Stone: row 1 column 4, and row 4 column 1.
    const place = (td: Element) => {
      const tr = td.parentElement as HTMLTableRowElement
      return [tr.rowIndex, (td as HTMLTableCellElement).cellIndex]
    }
    expect(live.map(place)).toEqual([
      [1, 4],
      [4, 1],
    ])
  })
})

describe('the standings', () => {
  it('ranks by points and sorts by any column from its header', () => {
    const t = roundRobinCup()
    withToasts(<RoundRobinView tournament={t} />)
    const table = screen.getByRole('table', { name: 'standings' })
    const names = () =>
      within(table)
        .getAllByRole('row')
        .slice(1)
        .map((row) => row.querySelectorAll('td')[1]?.textContent)
    expect(names()).toEqual((t.standings ?? []).map((s: { name: string }) => s.name))
    fireEvent.click(within(table).getByRole('button', { name: 'bot' }))
    expect(names()).toEqual(['Dwarf', 'Imp', 'Paper', 'Stone'])
    expect(within(table).getByRole('columnheader', { name: 'bot' }).getAttribute('aria-sort')).toBe(
      'ascending',
    )
  })

  it('downloads the standings as CSV', async () => {
    const t = roundRobinCup()
    const created: Blob[] = []
    const saved: string[] = []
    const url = { create: URL.createObjectURL, revoke: URL.revokeObjectURL }
    URL.createObjectURL = (blob: Blob) => {
      created.push(blob)
      return 'blob:standings'
    }
    URL.revokeObjectURL = () => {}
    const click = window.HTMLAnchorElement.prototype.click
    window.HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      saved.push(this.download)
    }
    try {
      withToasts(<RoundRobinView tournament={t} />)
      fireEvent.click(screen.getByRole('button', { name: 'standings.csv' }))
      expect(saved).toEqual(['asmbots-rr-cup-standings.csv'])
      expect(await (created[0] as Blob).text()).toBe(csv(t.standings ?? []))
    } finally {
      URL.createObjectURL = url.create
      URL.revokeObjectURL = url.revoke
      window.HTMLAnchorElement.prototype.click = click
    }
  })
})

describe('MeleeView', () => {
  it('draws each bot’s survival histogram and a watch button per round', async () => {
    const t = meleeCup(roster('Dwarf', 'Imp', 'Paper', 'Stone', 'Scanner'), 3)
    withToasts(<MeleeView tournament={t} createClient={createClient} />)
    const table = screen.getByRole('table', { name: 'standings' })
    const histograms = within(table).getAllByRole('img', { name: /survival/ })
    expect(histograms).toHaveLength(5)
    for (const [i, s] of (t.standings ?? []).entries()) {
      if (!('histogram' in s)) throw new Error('not melee standings')
      expect(histograms[i]?.getAttribute('aria-label')).toContain(s.histogram.join(' · '))
      expect(histograms[i]?.querySelectorAll('rect').length).toBe(
        s.histogram.filter((n) => n > 0).length,
      )
    }
    const rounds = screen.getByRole('table', { name: 'rounds' })
    // Five bots: no points column each, the survivors column says it.
    expect(within(rounds).queryByRole('columnheader', { name: 'Dwarf' })).toBeNull()
    expect(within(rounds).getAllByRole('button', { name: /^watch round/ })).toHaveLength(3)
    fireEvent.click(within(rounds).getByRole('button', { name: 'watch round 3' }))
    expect((await screen.findByRole('dialog')).textContent).toContain('5 bots · round 3')
  })
})

/** A runner that records what the controls ask of it, and emits the events it is given. */
function fakeRunner() {
  const calls: string[] = []
  const listeners = new Set<(event: RunnerEvent) => void>()
  const runner = {
    subscribe(listener: (event: RunnerEvent) => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    start: async (id: string) => {
      calls.push(`start ${id}`)
      return undefined
    },
    pause: async (id: string) => {
      calls.push(`pause ${id}`)
    },
    cancel: async (id: string) => {
      calls.push(`cancel ${id}`)
    },
  } as unknown as TournamentRunner
  const emit = (event: RunnerEvent) => {
    for (const listener of listeners) listener(event)
  }
  return { runner, calls, emit }
}

describe('TournamentControls', () => {
  it('shows the progress and the controls the status allows', () => {
    const { runner, calls } = fakeRunner()
    const t = roundRobinCup({ status: 'running', progress: { done: 2, of: 6 } }, 2)
    const { rerender } = withToasts(<TournamentControls tournament={t} runner={runner} />)
    const chip = screen.getByText('running · 2 / 6')
    expect(chip.dataset.live).toBe('true')
    expect(screen.queryByRole('button', { name: 'resume' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'pause' }))
    rerender(
      <ToastProvider>
        <TournamentControls tournament={{ ...t, status: 'paused' }} runner={runner} />
      </ToastProvider>,
    )
    expect(screen.getByText('paused · 2 / 6').dataset.live).toBeUndefined()
    fireEvent.click(screen.getByRole('button', { name: 'resume' }))
    fireEvent.click(screen.getByRole('button', { name: 'cancel' }))
    rerender(
      <ToastProvider>
        <TournamentControls tournament={{ ...t, status: 'finished' }} runner={runner} />
      </ToastProvider>,
    )
    expect(screen.queryByRole('button', { name: 'cancel' })).toBeNull()
    expect(screen.getByRole('button', { name: 'auto-watch' })).toHaveProperty('disabled', true)
    expect(calls).toEqual(['pause rr', 'start rr', 'cancel rr'])
  })

  it('opens each match the runner starts at max speed while auto-watch is on', async () => {
    const { runner, emit } = fakeRunner()
    const t = roundRobinCup({ status: 'running' }, 2)
    withToasts(<TournamentControls tournament={t} runner={runner} createClient={createClient} />)
    // Off: a match start opens nothing.
    act(() => emit({ type: 'match', id: 'rr', entrants: [0, 3], round: 0 }))
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'auto-watch' }))
    act(() => emit({ type: 'match', id: 'other', entrants: [0, 3], round: 0 }))
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => emit({ type: 'match', id: 'rr', entrants: [0, 3], round: 0 }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('live · Dwarf v Stone · round 1')
    const last = made[made.length - 1] as (typeof made)[0]
    await waitFor(() => expect(last.worker.sent.some((r) => r.type === 'load')).toBe(true))
    expect(last.worker.sent.find((r) => r.type === 'speed')).toMatchObject({
      cyclesPerFrame: 'max',
    })

    // Closing the arena turns auto-watch off.
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByRole('button', { name: 'auto-watch' }).getAttribute('aria-pressed')).toBe(
      'false',
    )
  })
})

describe('liveWatchTarget', () => {
  it('builds a round as runMatch does: the order rotated and the seed stepped', () => {
    const t = roundRobinCup()
    const target = liveWatchTarget(t, [1, 2, 3], 1)
    expect(target.bots.map((b) => b.name)).toEqual(['Paper', 'Stone', 'Imp'])
    expect(target.config.seed).toBe(8)
    expect(target.resultHash).toBeUndefined()
    expect(target.label).toBe('live · Imp v Paper v Stone · round 2')
  })
})
