/**
 * The new tournament form (src/features/tournaments/NewTournament.tsx, create.ts): each kind's
 * bot limits, the live match count and time, the record it stores, and the modal in jsdom, which
 * picks roster bots, my bots, and dropped files and starts the tournament on the runner.
 * `e2e/tournaments.spec.ts` makes a bracket in Chromium.
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'bun:test'
import { loadRoster } from '@asmbots/bots'
import { ToastProvider } from '@asmbots/ui'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useDom, window } from '../../../packages/ui/test/dom'
import { errorsOf, rosterCatalog } from '../src/features/arena/setup/bots'
import { DEFAULT_ARENA_CONFIG } from '../src/features/arena/setup/config'
import {
  checkPlan,
  formatDuration,
  matchCount,
  type PickedEntrant,
  type Plan,
  tournamentInput,
} from '../src/features/tournaments/create'
import { NewTournament } from '../src/features/tournaments/NewTournament'
import { type MatchExecutor, TournamentRunner } from '../src/features/tournaments/runner'
import {
  deleteTournament,
  getTournament,
  listTournaments,
  type Tournament,
} from '../src/features/tournaments/store'
import { clearLocalBots, LOCAL_BOTS_KEY, saveLocalBot } from '../src/store/local-bots'

useDom()
window.scrollTo = () => {}

const plan = (change: Partial<Plan>): Plan => ({
  kind: 'round-robin',
  entrants: 4,
  rounds: 1,
  maxCycles: 100_000,
  thirdPlace: true,
  ...change,
})

const rosterPick = (slug: string, size = 20): PickedEntrant => ({
  source: 'roster',
  ref: slug,
  name: slug,
  size,
})

describe('checkPlan', () => {
  it('counts the matches of each kind', () => {
    expect(matchCount(plan({ entrants: 12 }))).toBe(66)
    expect(matchCount(plan({ kind: 'bracket', entrants: 5 }))).toBe(5)
    expect(matchCount(plan({ kind: 'bracket', entrants: 5, thirdPlace: false }))).toBe(4)
    // Three bots have one semifinal loser: no third-place match to play.
    expect(matchCount(plan({ kind: 'bracket', entrants: 3 }))).toBe(2)
    expect(matchCount(plan({ kind: 'melee', entrants: 9 }))).toBe(1)
    expect(matchCount(plan({ entrants: 1 }))).toBe(0)
  })

  it('says the count and the time at max speed', () => {
    // 66 matches × 10 rounds × 80k cycles × 2 bots at 20 M instructions a second: 5.3 s.
    expect(checkPlan(plan({ entrants: 12, rounds: 10, maxCycles: 80_000 })).summary).toBe(
      '66 matches · ~6 s at max speed',
    )
    expect(checkPlan(plan({ kind: 'melee', entrants: 8, rounds: 3 })).summary).toBe(
      '1 melee · 3 rounds · ~1 s at max speed',
    )
    expect(formatDuration(0)).toBe('~1 s')
    expect(formatDuration(130)).toBe('~2 min')
    expect(formatDuration(5400)).toBe('~1.5 h')
  })

  it('holds each kind to its bots, and warns of a big round robin', () => {
    expect(checkPlan(plan({ kind: 'bracket', entrants: 2 })).error).toBe(
      'a bracket takes 3..32 bots: 2 bots picked',
    )
    expect(checkPlan(plan({ kind: 'bracket', entrants: 32 })).error).toBeNull()
    expect(checkPlan(plan({ kind: 'bracket', entrants: 33 })).error).not.toBeNull()
    expect(checkPlan(plan({ kind: 'melee', entrants: 17 })).error).toBe(
      'a melee takes 2..16 bots: 17 bots picked',
    )
    expect(checkPlan(plan({ entrants: 1 })).error).toBe(
      'a round robin takes 2..32 bots: 1 bot picked',
    )
    expect(checkPlan(plan({ entrants: 12 })).warning).toBeNull()
    expect(checkPlan(plan({ entrants: 13 })).warning).toContain('13 bots play every pair')
  })
})

describe('tournamentInput', () => {
  const draft = {
    name: '  ',
    kind: 'bracket' as const,
    entrants: [rosterPick('dwarf'), rosterPick('dwarf'), rosterPick('imp')],
    config: { ...DEFAULT_ARENA_CONFIG, seed: 7, rounds: 3 },
    thirdPlace: true,
    seeding: 'random' as const,
  }

  it('names a nameless draft, makes the names unique, and keeps the seed', () => {
    const input = tournamentInput(draft, () => 99)
    expect(input?.name).toBe('bracket · 3 bots')
    expect(input?.entrants.map((e) => e.name)).toEqual(['dwarf', 'dwarf 2', 'imp'])
    expect(input?.config.seed).toBe(7)
    expect(input?.rounds).toBe(3)
    expect(input?.seeding).toEqual({ random: 99 })
    // Three bots play no third-place match.
    expect(input?.thirdPlace).toBe(false)
  })

  it('keeps a local bot source, and gives a round robin no bracket options', () => {
    const local: PickedEntrant = { source: 'local', ref: 'a.asm', name: 'A', code: 'x', size: 4 }
    const input = tournamentInput({ ...draft, kind: 'round-robin', entrants: [local, local] })
    expect(input?.entrants[0]).toEqual({ source: 'local', ref: 'a.asm', name: 'A', code: 'x' })
    expect(input?.seeding).toBeUndefined()
    expect(input?.thirdPlace).toBeUndefined()
  })

  it('draws a seed the bots place with, or none when they do not fit', () => {
    const random = { ...draft, config: { ...draft.config, seed: null } }
    expect(tournamentInput(random, () => 1234)?.config.seed).toBe(1234)
    const crowd = Array.from({ length: 16 }, (_, i) => rosterPick(`b${i}`, 4096))
    const melee = { ...random, kind: 'melee' as const, entrants: crowd }
    const spaced = { ...melee.config, minSpacing: 8192 }
    expect(tournamentInput({ ...melee, config: spaced })).toBeNull()
  })
})

/** An executor whose matches never answer: a started tournament stays at `running · 0 / n`. */
const idle: MatchExecutor = { runMatch: () => new Promise(() => {}) }

beforeEach(async () => {
  for (const t of await listTournaments()) await deleteTournament(t.id)
  await clearLocalBots()
})

async function renderForm(runner = new TournamentRunner(() => idle)) {
  const created: Tournament[] = []
  let closed = 0
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <NewTournament
          open
          onClose={() => closed++}
          onCreated={(t) => created.push(t)}
          runner={runner}
        />
      </ToastProvider>
    </QueryClientProvider>,
  )
  await waitFor(() => expect(client.getQueryState(LOCAL_BOTS_KEY)?.status).toBe('success'))
  return { created, closed: () => closed, runner }
}

const check = (name: string) => fireEvent.click(screen.getByRole('checkbox', { name }))
const entrants = () =>
  within(screen.getByRole('list', { name: 'entrants' }))
    .getAllByRole('listitem')
    .map((item) => item.getAttribute('aria-label'))
const submit = () => document.querySelector<HTMLButtonElement>('button[name="create"]')

describe('the new tournament form', () => {
  it('makes a bracket of five roster bots and starts it', async () => {
    const { created, closed } = await renderForm()
    fireEvent.click(screen.getByRole('radio', { name: 'bracket' }))
    expect(screen.getByText('a bracket takes 3..32 bots: 0 bots picked')).toBeTruthy()
    expect(submit()?.disabled).toBe(true)
    for (const name of ['Imp', 'Dwarf', 'Stone', 'Paper', 'Scanner']) check(name)
    expect(entrants()).toEqual(['Imp', 'Dwarf', 'Stone', 'Paper', 'Scanner'])
    expect(screen.getByText('5 matches · ~1 s at max speed')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('name'), { target: { value: 'spring cup' } })
    expect(submit()?.textContent).toBe('start')
    await act(async () => submit()?.click())

    await waitFor(() => expect(created).toHaveLength(1))
    expect(closed()).toBe(1)
    const made = created[0] as Tournament
    expect(made).toMatchObject({ name: 'spring cup', kind: 'bracket', thirdPlace: true })
    expect(made.entrants.map((e) => e.ref)).toEqual(['imp', 'dwarf', 'stone', 'paper', 'scanner'])
    await waitFor(async () => expect((await getTournament(made.id))?.status).toBe('running'))
  })

  it('selects the showcase, unchecks a bot, and warns past 12 in a round robin', async () => {
    await renderForm()
    fireEvent.click(screen.getByRole('button', { name: 'select all showcase' }))
    expect(entrants()).toHaveLength(8)
    expect(screen.getByText('28 matches · ~1 s at max speed')).toBeTruthy()
    check('Imp')
    expect(entrants()).not.toContain('Imp')
    for (const name of ['Imp', 'Imp Ring', 'Dwarf Wide', 'Gate', 'Decoy', 'Silk']) check(name)
    expect(screen.getByText(/13 bots play every pair/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'remove Silk' }))
    expect(screen.queryByText(/play every pair/)).toBeNull()
  })

  it('switches to a melee preset for a melee, and caps it at 16 bots', async () => {
    await renderForm()
    fireEvent.click(screen.getByRole('radio', { name: 'melee' }))
    expect(screen.getByRole('radio', { name: 'melee 8' }).getAttribute('aria-checked')).toBe('true')
    const good = rosterCatalog().filter((bot) => errorsOf(bot).length === 0)
    for (const bot of good.slice(0, 17)) check(bot.name)
    expect(screen.getByText('a melee takes 2..16 bots: 17 bots picked')).toBeTruthy()
    expect(submit()?.disabled).toBe(true)
  })

  it('enters my bots and dropped files with their sources, and creates without starting', async () => {
    await saveLocalBot({ name: 'mine', source: loadRoster().get('imp')?.source ?? '' })
    const { created } = await renderForm()
    fireEvent.click(screen.getByRole('radio', { name: 'my bots' }))
    await screen.findByRole('checkbox', { name: 'Imp' })
    check('Imp')
    const dwarf = loadRoster().get('dwarf')?.source ?? ''
    const zone = screen.getByText(/drop \.asm files here/)
    const files = [new File([dwarf], 'dwarf.asm'), new File(['jmp nowhere'], 'broken.asm')]
    fireEvent.drop(zone, { dataTransfer: { files, types: ['Files'], dropEffect: 'none' } })
    await waitFor(() => expect(entrants()).toEqual(['Imp', 'Dwarf']))
    expect(
      await screen.findByText('broken.asm did not assemble: fix it in the editor.'),
    ).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'start now' }))
    expect(submit()?.textContent).toBe('create')
    await act(async () => submit()?.click())
    await waitFor(() => expect(created).toHaveLength(1))
    const made = created[0] as Tournament
    expect(made.name).toBe('round robin · 2 bots')
    expect(made.entrants.map((e) => [e.source, e.name, e.code !== undefined])).toEqual([
      ['local', 'Imp', true],
      ['local', 'Dwarf', true],
    ])
    expect((await getTournament(made.id))?.status).toBe('scheduled')
  })
})
