/**
 * `test vs ▾` (src/features/editor/test-vs.ts): the record of a match, the bots and ids it
 * fights with, the `watch` link, and the arena Worker's headless `match` request, in the session,
 * through `ArenaClient.runMatch`, and in the real Worker (Bun has one).
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { assemble } from '@asmbots/asm'
import { fighter, rosterSource } from '@asmbots/bots'
import { type MatchResult, runMatch } from '@asmbots/tourney'
import { type CatalogBot, rosterCatalog } from '../src/features/arena/setup/bots'
import { battleConfig } from '../src/features/arena/setup/config'
import { setupFromSearch, sharedBots, shareUrl } from '../src/features/arena/setup/url'
import { ArenaClient, createArenaStore } from '../src/features/arena/worker/client'
import { ArenaSession } from '../src/features/arena/worker/session'
import {
  TEST_CONFIG,
  TEST_ROUNDS,
  tally,
  testBots,
  testedId,
  watchSetup,
} from '../src/features/editor/test-vs'
import { manualSchedule, sessionClient } from './session-worker'

const roster = (slug: string): CatalogBot => {
  const bot = rosterCatalog().find((b) => b.ref.kind === 'roster' && b.ref.slug === slug)
  if (bot === undefined) throw new Error(slug)
  return bot
}

/** A match whose rounds scored `points`, one pair per round. */
function matchOf(points: [number, number][]): MatchResult {
  return {
    key: 'k',
    names: ['a', 'b'],
    of: points.length,
    rounds: points.map((p, round) => ({
      round,
      seed: round,
      order: [0, 1],
      resultHash: '',
      durationCycles: 1,
      points: p,
      survivors: [],
      survival: [],
    })),
    points: [0, 0],
  }
}

describe('the record', () => {
  it('counts a round won, tied, or lost from the tested bot’s side', () => {
    expect(
      tally(
        matchOf([
          [3, 0],
          [1, 1],
          [0, 3],
          [3, 0],
        ]),
      ),
    ).toEqual({ wins: 2, ties: 1, losses: 1 })
    expect(
      tally(
        matchOf([
          [3, 0],
          [0, 3],
        ]),
        1,
      ),
    ).toEqual({ wins: 1, ties: 0, losses: 1 })
  })

  it('fights the arena’s duel, ten rounds', () => {
    expect(TEST_ROUNDS).toBe(10)
    expect(TEST_CONFIG.rounds).toBe(10)
    expect(TEST_CONFIG.maxCycles).toBe(100_000)
  })
})

describe('the bots of a test', () => {
  it('names the tested bot by its %name, and a namesake opponent as the arena does', () => {
    const mine = assemble(rosterSource('dwarf'))
    expect(testBots(mine, roster('imp')).map((b) => b.name)).toEqual(['Dwarf', 'Imp'])
    expect(testBots(mine, roster('dwarf')).map((b) => b.name)).toEqual(['Dwarf', 'Dwarf 2'])
    const nameless = { ...mine, name: '' }
    expect(testBots(nameless, roster('imp'))[0]?.name).toBe('my bot')
    expect(testBots(mine, roster('imp'))[0]?.bytes).toBe(mine.bytes)
  })

  it('keeps a saved bot’s id only for its saved text', () => {
    const saved = { id: 'abc', source: 'nop' }
    expect(testedId('nop', saved)).toBe('abc')
    const draft = testedId('nop\n', saved)
    expect(draft).toMatch(/^draft-[0-9a-f]{12}$/)
    expect(testedId('nop\n', null)).toBe(draft)
    expect(testedId('nop\n\n', null)).not.toBe(draft)
  })

  it('links the arena set up as the test: the two bots, the seed, the source inside', () => {
    const tested = { id: 'draft-1', source: rosterSource('dwarf') }
    const { spec, shared } = watchSetup(tested, 'imp', 42)
    const url = shareUrl('', spec, shared)
    expect(
      url.startsWith('/arena?b=local:draft-1,roster:imp&seed=42&cycles=100000&rounds=10'),
    ).toBe(true)
    const [path, fragment = ''] = url.split('#')
    const query = new URLSearchParams(path?.split('?')[1])
    const back = setupFromSearch({
      b: query.get('b') ?? undefined,
      seed: Number(query.get('seed')),
      cycles: Number(query.get('cycles')),
      rounds: Number(query.get('rounds')),
      procs: Number(query.get('procs')),
      spacing: Number(query.get('spacing')),
    })
    expect(back.config).toEqual({ ...TEST_CONFIG, seed: 42 })
    expect(sharedBots(fragment).get('draft-1')).toBe(tested.source)
  })
})

describe('the arena Worker’s match request', () => {
  const bots = [
    { name: 'Dwarf', bytes: fighter('dwarf').bytes },
    { name: 'Imp', bytes: fighter('imp').bytes },
  ]
  const config = battleConfig(TEST_CONFIG, 7)

  it('runs the whole match headless, as runMatch does, and leaves the battle alone', () => {
    const session = new ArenaSession(() => 0)
    session.handle({ type: 'load', bots, config: { seed: 1 } })
    const before = session.handle({ type: 'step', cycles: 10 })[0]
    const [answer] = session.handle({ type: 'match', bots, config, rounds: TEST_ROUNDS })
    expect(answer).toEqual({ type: 'match', match: runMatch(bots, config, TEST_ROUNDS) })
    const after = session.handle({ type: 'step', cycles: 10 })[0]
    expect(before?.type === 'frame' && after?.type === 'frame' && after.cycle - before.cycle).toBe(
      10,
    )
  })

  it('answers a bad match with an error', () => {
    const [answer] = new ArenaSession().handle({ type: 'match', bots, config, rounds: 0 })
    expect(answer?.type).toBe('error')
    expect(answer?.type === 'error' && answer.request).toBe('match')
  })

  const clients: ArenaClient[] = []
  afterEach(() => {
    for (const client of clients.splice(0)) client.dispose()
  })

  it('settles runMatch calls in order through the client, a refusal too', async () => {
    const { client, worker } = sessionClient(manualSchedule().schedule)
    clients.push(client)
    const first = client.runMatch(bots, config, 2)
    const refused = client.runMatch(bots, config, 0)
    const third = client.runMatch(bots, battleConfig(TEST_CONFIG, 8), 1)
    expect(await first).toEqual(runMatch(bots, config, 2))
    await expect(refused).rejects.toThrow(/rounds/)
    expect((await third).of).toBe(1)
    expect(worker.sent.map((r) => r.type)).toEqual(['match', 'match', 'match'])
    expect(client.store.getState().status).toBe('idle')
    expect(client.store.getState().error).toBeNull()
  })

  it('rejects a runMatch in flight when the client goes', async () => {
    const { client } = sessionClient(manualSchedule().schedule)
    const pending = client.runMatch(bots, config, 1)
    client.dispose()
    await expect(pending).rejects.toThrow('closed')
    await expect(client.runMatch(bots, config, 1)).rejects.toThrow('closed')
  })

  it('runs in the real Worker', async () => {
    const client = new ArenaClient({ store: createArenaStore() })
    clients.push(client)
    const match = await client.runMatch(bots, config, TEST_ROUNDS)
    expect(match).toEqual(runMatch(bots, config, TEST_ROUNDS))
    expect(tally(match).wins + tally(match).ties + tally(match).losses).toBe(TEST_ROUNDS)
  })
})
