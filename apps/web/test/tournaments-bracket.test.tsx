/**
 * The bracket view (src/features/tournaments/BracketSvg.tsx, BracketView.tsx): a node per match,
 * a click or a key selects one, the match panel shows its rounds, and `watch` replays a round in
 * the arena, on a real `ArenaClient` whose Worker is an `ArenaSession` in this thread, to the
 * recorded result hash. Also the downloads' content.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import type { BattleConfigInput } from '@asmbots/engine'
import { type Bracket, bracket, createBracket, DEFAULT_BRACKET_PALETTE } from '@asmbots/tourney'
import { ToastProvider } from '@asmbots/ui'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { stubLayout, useDom, window } from '../../../packages/ui/test/dom'
import type { ArenaClient } from '../src/features/arena/worker/client'
import { BracketSvg } from '../src/features/tournaments/BracketSvg'
import { BracketView, liveMatches } from '../src/features/tournaments/BracketView'
import { resultsJson, themePalette } from '../src/features/tournaments/export'
import { entrantBots } from '../src/features/tournaments/runner'
import type { Tournament, TournamentEntrant } from '../src/features/tournaments/store'
import { watchTarget } from '../src/features/tournaments/watch'
import { stubCanvas } from './fake-canvas'
import { manualSchedule, type SessionWorker, sessionClient } from './session-worker'

useDom()
window.scrollTo = () => {}

const named = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `bot ${i + 1}` }))

const CONFIG: BattleConfigInput = { maxCycles: 20_000, maxProcesses: 64, minSpacing: 1024, seed: 7 }

const ENTRANTS: TournamentEntrant[] = [
  { source: 'roster', ref: 'dwarf', name: 'Dwarf' },
  { source: 'roster', ref: 'imp', name: 'Imp' },
  { source: 'roster', ref: 'paper', name: 'Paper' },
  { source: 'local', ref: 'mine.asm', name: 'Mine', code: '%name "Mine"\nstart: jmp start\n' },
]

/** A bracket of the entrants, played out: 2 rounds a match. */
function played(): Bracket {
  return bracket(entrantBots(ENTRANTS), CONFIG, { seeding: 'given', rounds: 2 })
}

function tournament(change: Partial<Tournament> = {}): Tournament {
  const b = played()
  return {
    id: 't1',
    name: 'cup',
    kind: 'bracket',
    entrants: ENTRANTS,
    config: CONFIG,
    rounds: 2,
    status: 'finished',
    seeding: 'given',
    bracket: b,
    matches: b.matches.flatMap((m) => (m.result === null ? [] : [m.result])),
    progress: { done: 3, of: 3 },
    champion: b.matches[b.final]?.winner ?? null,
    createdAt: 0,
    updatedAt: 0,
    ...change,
  }
}

function Selecting({ bracket: b }: { bracket: Bracket }) {
  const [selected, setSelected] = useState<number | null>(null)
  return <BracketSvg bracket={b} selected={selected} onSelect={setSelected} />
}

const nodes = () => document.querySelectorAll<SVGGElement>('[data-match-id]')
const node = (id: number) => document.querySelector(`[data-match-id="${id}"]`) as SVGGElement

let restore: (() => void)[] = []
const made: { client: ArenaClient; worker: SessionWorker }[] = []
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

describe('BracketSvg', () => {
  it('draws a node per match: 7 for 8 entrants, 15 for 13', () => {
    const { unmount } = render(
      <Selecting bracket={createBracket(named(8), { seeding: 'given' })} />,
    )
    expect(nodes()).toHaveLength(7)
    unmount()
    render(<Selecting bracket={createBracket(named(13), { seeding: 'given' })} />)
    expect(nodes()).toHaveLength(15)
    expect(document.querySelectorAll('[data-status="walkover"]')).toHaveLength(3)
  })

  it('selects the match clicked, or the one focused on Enter', () => {
    render(<Selecting bracket={createBracket(named(8), { seeding: 'given' })} />)
    expect(node(3).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(node(3).querySelector('text') as Element)
    expect(node(3).getAttribute('aria-pressed')).toBe('true')
    expect(node(3).dataset.selected).toBe('true')
    expect(node(3).getAttribute('role')).toBe('button')
    fireEvent.keyDown(node(5), { key: 'Enter' })
    expect(node(5).getAttribute('aria-pressed')).toBe('true')
    expect(node(3).getAttribute('aria-pressed')).toBe('false')
    // A drag pans; it selects nothing.
    const box = screen.getByRole('region', { name: 'bracket' })
    fireEvent.pointerDown(box, { button: 0, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(box, { clientX: 60, clientY: 30 })
    fireEvent.pointerUp(box)
    fireEvent.click(node(1))
    expect(node(1).getAttribute('aria-pressed')).toBe('false')
  })
})

describe('BracketView', () => {
  it('shows a match’s rounds and replays one to its recorded hash', async () => {
    const t = tournament()
    const frames = manualSchedule()
    const createClient = () => {
      const next = sessionClient(frames.schedule)
      made.push(next)
      return next.client
    }
    render(
      <ToastProvider>
        <BracketView tournament={t} createClient={createClient} />
      </ToastProvider>,
    )
    expect(nodes()).toHaveLength(3)
    const final = t.bracket?.matches[t.bracket.final]
    fireEvent.click(node(final?.id as number))
    const panel = screen.getByRole('region', { name: 'match' })
    expect(panel.textContent).toContain('final · match 3')
    const table = within(panel).getByRole('table', { name: 'rounds' })
    expect(within(table).getAllByRole('button', { name: /^watch round/ })).toHaveLength(2)

    fireEvent.click(within(panel).getByRole('button', { name: 'watch round 2' }))
    const dialog = await screen.findByRole('dialog')
    const round = final?.result?.rounds[1]
    const last = made[made.length - 1] as (typeof made)[0]
    await waitFor(() => expect(last.worker.sent.some((r) => r.type === 'load')).toBe(true))
    const load = last.worker.sent.find((r) => r.type === 'load')
    expect(load).toMatchObject({ rounds: 1, config: { ...CONFIG, seed: round?.seed } })
    const names = (round?.order ?? []).map((k) => final?.result?.names[k])
    expect(load?.type === 'load' && load.bots.map((b) => b.name)).toEqual(names)

    await act(async () => {
      for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0))
    })
    last.client.seek(CONFIG.maxCycles as number)
    await waitFor(() => expect(within(dialog).getByText('verified')).toBeTruthy())
  })

  it('marks the next ready match live while the tournament runs', () => {
    const b = createBracket(named(4), { seeding: 'given' })
    const running = tournament({ status: 'running', bracket: b })
    expect(liveMatches(running)).toEqual([0])
    expect(liveMatches({ ...running, status: 'paused' })).toEqual([])
    render(
      <ToastProvider>
        <BracketView tournament={running} />
      </ToastProvider>,
    )
    expect(node(0).dataset.live).toBe('true')
    expect(node(1).dataset.live).toBeUndefined()
    fireEvent.click(node(0))
    expect(screen.getByRole('region', { name: 'match' }).textContent).toContain('playing now.')
  })
})

describe('the downloads', () => {
  it('results.json holds the bracket and matches, not the local sources', () => {
    const t = tournament()
    const json = JSON.parse(resultsJson(t))
    expect(json).toMatchObject({ format: 'asmbots-tournament', name: 'cup', kind: 'bracket' })
    expect(json.bracket.matches).toHaveLength(3)
    expect(json.matches).toHaveLength(3)
    expect(json.champion).toBe(t.entrants[t.champion as number]?.name)
    expect(json.entrants[3]).toEqual({ source: 'local', ref: 'mine.asm', name: 'Mine' })
    expect(JSON.stringify(json)).not.toContain('jmp start')
  })

  it('the palette keeps the defaults where no token resolves', () => {
    expect(themePalette()).toEqual(DEFAULT_BRACKET_PALETTE)
  })

  it('watchTarget rebuilds a round in fighting order with its seed', () => {
    const t = tournament()
    const m = t.bracket?.matches.find((x) => x.status === 'done')
    const result = m?.result
    if (m === undefined || result == null) throw new Error('no match played')
    const entrants = m.slots.map((s) => s.entrant as number)
    const round = result.rounds[1]
    if (round === undefined) throw new Error('no second round')
    const target = watchTarget(t, entrants, result, round)
    expect(target.bots.map((b) => b.name)).toEqual(round.order.map((k) => result.names[k]))
    expect(target.config.seed).toBe(round.seed)
    expect(target.resultHash).toBe(round.resultHash)
    expect(target.label).toBe(`${result.names.join(' v ')} · round 2`)
  })
})
