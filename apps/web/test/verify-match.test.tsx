/**
 * `verify` (src/features/verify): a published match's inputs, run a round at a time on an arena
 * session and checked against the server's row, round by round or by the match's one hash; the
 * first thing that differs stops it. And the button in a match table: it asks the server for the
 * inputs, runs them in a real arena Worker (Bun has one), and gives way to the chip, without
 * opening the row's replay; a match the server cannot give back leaves a toast and the button.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import type { LoadedBot } from '@asmbots/engine'
import {
  type LiveMatch,
  type Match,
  type MatchSummary,
  type MatchVerification,
  matchResultHash,
  sha256Hex,
  toBase64,
} from '@asmbots/protocol'
import { type MatchResult, type RunMatchOptions, runMatch } from '@asmbots/tourney'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { useDom, window } from '../../../packages/ui/test/dom'
import type { ReplayCheck } from '../src/features/arena/battle/verify'
import { MatchesTable } from '../src/features/hills/MatchesTable'
import { VerifyMatch } from '../src/features/verify/VerifyMatch'
import { type VerifyClient, verifyMatch } from '../src/features/verify/verify'
import { answer, refuse, renderAt, useApiServer } from './api-server'
import { manualSchedule, sessionClient } from './session-worker'

useDom()
const server = useApiServer()
// The router restores the scroll on each navigation; jsdom has no scrolling.
window.scrollTo = () => {}

/** `jmp short $`: lives to the cycle cap. */
const LOOP: LoadedBot = { name: 'Loop', bytes: Uint8Array.from([0xeb, 0xfe]) }
/** `dat`: dies on its first instruction. */
const DAT: LoadedBot = { name: 'Dat', bytes: Uint8Array.from([0x00, 0x00]) }
const CONFIG = {
  coreSize: 65_536,
  maxCycles: 500,
  maxProcesses: 64,
  minSpacing: 1024,
  maxBotBytes: 512,
}
const SEED = 7
const ROUNDS = 3
const T = '2026-09-24T12:00:00.000Z'

/** The match as the server played it and the answer of `GET /api/matches/m1/verify`. */
async function published(rounds = true): Promise<MatchVerification> {
  const played = runMatch([LOOP, DAT], { ...CONFIG, seed: SEED }, ROUNDS)
  const inputs: LiveMatch = {
    id: 'm1',
    key: played.key,
    participants: ['v-loop', 'v-dat'],
    rounds: ROUNDS,
    seed: SEED,
    config: CONFIG,
    bots: await Promise.all(
      [LOOP, DAT].map(async ({ name, bytes }) => ({
        name,
        bytes: toBase64(bytes),
        sha256: await sha256Hex(bytes),
      })),
    ),
  }
  const match: Match = {
    id: 'm1',
    tournamentId: null,
    hillId: 'hill-main',
    participants: ['v-loop', 'v-dat'],
    rounds: ROUNDS,
    seed: SEED,
    key: rounds ? played.key : null,
    result: {
      points: [...played.points],
      survivors: [...(played.rounds[played.rounds.length - 1]?.survivors ?? [])],
      resultHash: matchResultHash(played.rounds),
      ...(rounds && {
        rounds: played.rounds.map((r) => ({
          ...r,
          order: [...r.order],
          points: [...r.points],
          survivors: [...r.survivors],
          survival: [...r.survival],
        })),
      }),
    },
    replayKey: 'ab'.repeat(32),
    finishedAt: T,
  }
  return { match, inputs }
}

/** A stand-in client: the tourney's `runMatch` in this thread, or a failure. */
class LocalClient implements VerifyClient {
  readonly asked: RunMatchOptions[] = []
  disposed = false
  constructor(private readonly failure: string | null = null) {}

  async runMatch(
    bots: readonly LoadedBot[],
    config: object,
    rounds: number,
    options: RunMatchOptions = {},
  ): Promise<MatchResult> {
    this.asked.push(options)
    if (this.failure !== null) throw new Error(this.failure)
    return runMatch(bots, config, rounds, options)
  }

  dispose(): void {
    this.disposed = true
  }
}

/** Runs `verification`, and every check it reported on the way. */
async function checks(
  verification: MatchVerification,
  client: VerifyClient = new LocalClient(),
  signal?: AbortSignal,
): Promise<{ seen: ReplayCheck[]; last: ReplayCheck }> {
  const seen: ReplayCheck[] = []
  const last = await verifyMatch(verification, (c) => seen.push(c), {
    createClient: () => client,
    signal,
  })
  return { seen, last }
}

describe('verifyMatch', () => {
  it("runs a Runner's match a round at a time on the arena session, to verified", async () => {
    const { client, worker } = sessionClient(manualSchedule().schedule)
    const { seen, last } = await checks(await published(), client)
    expect(seen).toEqual([
      { state: 'pending', verified: 0, of: 3 },
      { state: 'pending', verified: 1, of: 3 },
      { state: 'pending', verified: 2, of: 3 },
      { state: 'verified', of: 3 },
    ])
    expect(last).toEqual({ state: 'verified', of: 3 })
    // A round a request, each resuming the last; then the Worker ends.
    const asked = worker.sent.filter((r) => r.type === 'match')
    expect(asked.map((r) => [r.through, r.resume?.rounds.length ?? 0])).toEqual([
      [1, 0],
      [2, 1],
      [3, 2],
    ])
    expect(worker.terminated).toBe(true)
  })

  it('checks a row stored without rounds by the match’s one hash', async () => {
    const { seen, last } = await checks(await published(false))
    expect(seen.map((c) => c.state)).toEqual(['pending', 'pending', 'pending', 'verified'])
    expect(last).toEqual({ state: 'verified', of: 3 })
  })

  it('stops at the first round whose hash differs from the row’s', async () => {
    const verification = await published()
    const rounds = verification.match.result?.rounds ?? []
    const round = rounds[1]
    if (round === undefined) throw new Error('no second round')
    rounds[1] = { ...round, resultHash: '0123456789abcdef' }
    const client = new LocalClient()
    const { last } = await checks(verification, client)
    expect(last).toEqual({
      state: 'mismatch',
      reason: `round 2: result ${round.resultHash}, recorded 0123456789abcdef`,
    })
    expect(client.asked.map((o) => o.through)).toEqual([1, 2])
    expect(client.disposed).toBe(true)
  })

  it('refuses bytes that are not their SHA-256 before it runs anything', async () => {
    const verification = await published()
    const [loop, dat] = verification.inputs.bots
    if (loop === undefined || dat === undefined) throw new Error('no bots')
    verification.inputs.bots = [loop, { ...dat, sha256: 'f'.repeat(64) }]
    let made = 0
    const last = await verifyMatch(verification, () => {}, {
      createClient: () => {
        made++
        return new LocalClient()
      },
    })
    expect(last).toEqual({ state: 'mismatch', reason: "Dat's bytes do not match their SHA-256" })
    expect(made).toBe(0)
  })

  it('names inputs that are not the match the row stores', async () => {
    const verification = await published(false)
    verification.inputs.key = '0123456789abcdef'
    const { last } = await checks(verification)
    expect(last).toEqual({
      state: 'mismatch',
      reason: 'the match the server sent is of other bots or another config',
    })
  })

  it('says a run that fails did not run, and reports nothing once stopped', async () => {
    const { last } = await checks(await published(), new LocalClient('the engine refused it'))
    expect(last).toEqual({
      state: 'mismatch',
      reason: 'the match did not run: the engine refused it',
    })

    const controller = new AbortController()
    const client = new LocalClient()
    const seen: ReplayCheck[] = []
    const run = client.runMatch.bind(client)
    client.runMatch = async (...args) => {
      const result = await run(...args)
      controller.abort()
      return result
    }
    await verifyMatch(await published(), (c) => seen.push(c), {
      createClient: () => client,
      signal: controller.signal,
    })
    // The bytes' check, and nothing after the stop.
    expect(seen).toEqual([{ state: 'pending', verified: 0, of: 3 }])
    expect(client.disposed).toBe(true)
  })
})

const SUMMARY = async (): Promise<MatchSummary> => ({
  match: (await published()).match,
  bots: [null, null],
})

describe('VerifyMatch', () => {
  afterEach(() => {
    server.resetHandlers()
  })

  it('runs the match in an arena Worker from its row in a table, and does not open the replay', async () => {
    server.use(answer('/matches/m1/verify', await published()))
    const summary = await SUMMARY()
    const router = await renderAt('/hills', () => (
      <MatchesTable aria-label="recent matches" matches={[summary]} />
    ))
    const row = screen.getAllByRole('row')[1] as HTMLElement
    const button = within(row).getByRole('button', { name: 'verify [deleted] vs [deleted]' })
    await act(async () => void fireEvent.click(button))
    const chip = await within(row).findByRole('status', {}, { timeout: 5000 })
    await waitFor(() => expect(chip.textContent).toBe('verified'), { timeout: 5000 })
    expect(chip.getAttribute('title')).toBe('all 3 rounds match their recorded result hash')
    expect(router.state.location.pathname).toBe('/hills')
  })

  it('shows an icon, not words, in a narrow table: the chip keeps its words for screen readers', async () => {
    server.use(answer('/matches/m1/verify', await published(false)))
    await renderAt('/hills', () => (
      <VerifyMatch id="m1" label="Loop vs Dat" compact createClient={() => new LocalClient()} />
    ))
    const button = screen.getByRole('button', { name: 'verify Loop vs Dat' })
    expect(button.textContent).toBe('')
    await act(async () => void fireEvent.click(button))
    const chip = await screen.findByRole('status')
    await waitFor(() => expect(chip.getAttribute('data-check')).toBe('verified'))
    expect(chip.querySelector('.sr-only')?.textContent).toBe('verified')
    expect(chip.getAttribute('title')).toBe(
      'verified: all 3 rounds match their recorded result hash',
    )
  })

  it('toasts why when the server cannot give the inputs, and gives the button back', async () => {
    server.use(
      refuse('/matches/m1/verify', 404, 'not_found', 'the inputs of match m1 are not stored'),
    )
    await renderAt('/hills', () => <VerifyMatch id="m1" label="Loop vs Dat" />)
    await act(
      async () => void fireEvent.click(screen.getByRole('button', { name: 'verify Loop vs Dat' })),
    )
    expect(
      await screen.findByText('cannot verify Loop vs Dat: the inputs of match m1 are not stored'),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'verify Loop vs Dat' })).toBeTruthy()
  })
})
