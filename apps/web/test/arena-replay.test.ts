/**
 * Replay links and their check (PRODUCT_SPEC §2, §10): `battle/replay.ts` writes a match into
 * `/arena/<key>#r=…` and reads it back, holding a link to what the arena runs, and
 * `battle/verify.ts` says how the arena's run of it compares with what it recorded.
 */
import { describe, expect, it } from 'bun:test'
import { fighter } from '@asmbots/bots'
import type { BattleConfigInput } from '@asmbots/engine'
import { type MatchResult, runMatch } from '@asmbots/tourney'
import {
  buildReplay,
  bytesProblem,
  type LocalReplay,
  linkReplay,
  parseReplay,
  REPLAY_FORMAT,
  readReplayFragment,
  replayBots,
  replayFragment,
  replayUrl,
} from '../src/features/arena/battle/replay'
import {
  checkLabel,
  checkReplay,
  checkTitle,
  NO_RUN,
  type ReplayRun,
} from '../src/features/arena/battle/verify'
import { toBase64Url } from '../src/features/arena/setup/url'
import type { ArenaBot } from '../src/features/arena/worker/protocol'

const BOTS: readonly ArenaBot[] = ['dwarf', 'imp'].map((slug) => {
  const { name, bytes, meta } = fighter(slug)
  return { name, bytes, meta }
})
const CONFIG: BattleConfigInput = {
  maxCycles: 100_000,
  maxProcesses: 64,
  minSpacing: 1024,
  seed: 1,
}
const SOURCES = ['; dwarf', '; imp']

/** The replay of `rounds` rounds of Dwarf vs Imp from seed 1, as `download replay` makes it. */
async function duel(rounds = 1): Promise<{ replay: LocalReplay; match: MatchResult }> {
  const match = runMatch(BOTS, CONFIG, rounds)
  const replay = await buildReplay(BOTS, SOURCES, CONFIG, rounds, match, new Date(0))
  return { replay, match }
}

/** A fragment whose `r` is the base64url of `value`'s JSON. */
function fragmentOf(value: unknown): string {
  return `r=${toBase64Url(new TextEncoder().encode(JSON.stringify(value)))}`
}

/** Why `value`, as a replay link, does not load. */
function brokenBecause(value: unknown): string {
  const read = readReplayFragment(fragmentOf(value))
  if (read.kind !== 'broken') throw new Error(`read as ${read.kind}`)
  return read.reason
}

/** The arena's run of `match` to its end: its key and every round's hash. */
function ranTo(match: MatchResult): ReplayRun {
  return {
    key: match.key,
    hashes: new Map(match.rounds.map((round) => [round.round, round.resultHash])),
    error: null,
  }
}

describe('replay links', () => {
  it('read back as the replay, less its sources', async () => {
    const { replay } = await duel(2)
    expect(replay.bots.map((bot) => bot.source)).toEqual(SOURCES)
    const fragment = replayFragment(replay)
    expect(fragment).toMatch(/^r=[A-Za-z0-9_-]+$/)
    const read = readReplayFragment(`#${fragment}`)
    if (read.kind !== 'ok') throw new Error(read.kind)
    expect(read.replay).toEqual(linkReplay(replay))
    expect(read.replay.bots.every((bot) => bot.source === undefined)).toBe(true)
    expect(read.replay.bots.map((bot) => bot.meta)).toEqual(BOTS.map((bot) => bot.meta))
    expect(read.bots.map((bot) => bot.name)).toEqual(['Dwarf', 'Imp'])
    expect(read.bots.map((bot) => [...bot.bytes])).toEqual(BOTS.map((bot) => [...bot.bytes]))
    expect(replayBots(replay)).toEqual(read.bots)
  })

  it('name their page by the match key', async () => {
    const { replay, match } = await duel()
    const url = new URL(replayUrl('https://asmbots.dev', replay))
    expect(url.origin).toBe('https://asmbots.dev')
    expect(url.pathname).toBe(`/arena/${match.key}`)
    expect(match.key).toMatch(/^[0-9a-f]{16}$/)
    expect(url.hash).toBe(`#${replayFragment(replay)}`)
    // A Dwarf vs Imp duel's link is short: the bots' bytes, the config, and the match.
    expect(url.href.length).toBeLessThan(1500)
  })

  it('carry nothing without r=, and say why a cut, garbled, or foreign one is broken', async () => {
    const { replay } = await duel()
    expect(readReplayFragment('')).toEqual({ kind: 'none' })
    expect(readReplayFragment('#src=abc')).toEqual({ kind: 'none' })
    expect(readReplayFragment('r=')).toEqual({ kind: 'none' })
    const cut = replayFragment(replay).slice(0, -40)
    expect(readReplayFragment(cut)).toEqual({
      kind: 'broken',
      reason: 'it does not decode, so the link may be cut short',
    })
    expect(readReplayFragment('r=!!!')).toMatchObject({ kind: 'broken' })
    expect(readReplayFragment(`r=${'A'.repeat((1 << 20) + 4)}`)).toEqual({
      kind: 'broken',
      reason: 'it is longer than any replay link',
    })
    expect(brokenBecause([1, 2])).toBe('the replay is missing')
    expect(brokenBecause({ ...replay, format: 'asmbots-replay/0' })).toBe(
      `it is not a replay of format ${REPLAY_FORMAT}`,
    )
    expect(brokenBecause({ ...replay, isa: 'x86-64' })).toBe(
      'its bots are written for x86-64, not x16c-v1',
    )
  })

  it('hold a replay to what the arena runs', async () => {
    const { replay } = await duel()
    const [dwarf, imp] = replay.bots as [LocalReplay['bots'][0], LocalReplay['bots'][0]]
    const with_ = (change: Record<string, unknown>) => brokenBecause({ ...replay, ...change })
    const config = (change: Record<string, unknown>) =>
      with_({ config: { ...replay.config, ...change } })
    expect(with_({ rounds: 11 })).toBe('rounds must be a whole number in 1..10')
    expect(config({ maxCycles: 2_000_000 })).toBe(
      'maxCycles must be a whole number in 1..1,000,000',
    )
    expect(config({ maxProcesses: 300 })).toBe('maxProcesses must be a whole number in 1..256')
    expect(config({ seed: -1 })).toBe('the seed must be a whole number in 0..4,294,967,295')
    expect(config({ seed: 1.5 })).toBe('the seed must be a whole number in 0..4,294,967,295')
    expect(with_({ bots: [dwarf] })).toBe('it has 1 bot, and a battle has 2 to 16')
    expect(with_({ bots: Array(17).fill(dwarf) })).toBe('it has 17 bots, and a battle has 2 to 16')
    expect(with_({ bots: [dwarf, { ...imp, bytes: 'not base64!' }] })).toBe(
      "Imp's bytes is not well formed",
    )
    expect(with_({ bots: [dwarf, { ...imp, bytes: '' }] })).toBe('Imp has no bytes')
    expect(with_({ bots: [dwarf, { ...imp, sha256: 'abc' }] })).toBe(
      "Imp's SHA-256 is not well formed",
    )
    expect(with_({ bots: [dwarf, { ...imp, name: 'Imp\nand more' }] })).toBe(
      "bot 2's name is not well formed",
    )
    expect(with_({ bots: [dwarf, { ...imp, meta: { author: 7 } }] })).toBe(
      "Imp's author is not well formed",
    )
    const match = (change: Record<string, unknown>) =>
      with_({ match: { ...replay.match, ...change } })
    expect(match({ key: 'nope' })).toBe('the match key is not well formed')
    expect(match({ of: 2 })).toBe('the match has 2 rounds, not 1')
    expect(match({ rounds: [] })).toBe('it records 0 of its 1 rounds')
    expect(match({ names: ['Dwarf'] })).toBe('the match names 1 bot, not 2')
    const round = replay.match.rounds[0] as object
    expect(match({ rounds: [{ ...round, order: [0, 0] }] })).toBe("round 1's order repeats a bot")
    expect(match({ rounds: [{ ...round, round: 1 }] })).toBe('round 1 is out of order')
    expect(match({ rounds: [{ ...round, resultHash: 'XYZ' }] })).toBe(
      "round 1's result hash is not well formed",
    )
    // What `download replay` wrote reads as it was, sources and all.
    expect(parseReplay(JSON.parse(JSON.stringify(replay)))).toEqual(replay)
  })

  it('know when a bot’s bytes are not the bytes its SHA-256 names', async () => {
    const { replay } = await duel()
    expect(await bytesProblem(replay)).toBeNull()
    const [dwarf, imp] = replay.bots as [LocalReplay['bots'][0], LocalReplay['bots'][0]]
    // Imp's bytes, one bit changed: they still decode, to other code.
    const bytes = atob(imp.bytes)
    const flipped = btoa(String.fromCharCode(bytes.charCodeAt(0) ^ 1) + bytes.slice(1))
    const tampered = { ...replay, bots: [dwarf, { ...imp, bytes: flipped }] }
    expect(await bytesProblem(tampered)).toBe("Imp's bytes do not match their SHA-256")
  })
})

describe('the check', () => {
  it('waits for the rounds, then verifies a replay the engine plays the same', async () => {
    const { replay, match } = await duel(3)
    const run = ranTo(match)
    expect(checkReplay(replay, NO_RUN, 'pending')).toEqual({ state: 'pending', verified: 0, of: 3 })
    const first: ReplayRun = { ...run, hashes: new Map([...run.hashes].slice(0, 1)) }
    expect(checkReplay(replay, first, 'ok')).toEqual({ state: 'pending', verified: 1, of: 3 })
    expect(checkReplay(replay, run, 'ok')).toEqual({ state: 'verified', of: 3 })
    // Not before the bytes are checked, and not before the match's key came.
    expect(checkReplay(replay, run, 'pending')).toEqual({ state: 'pending', verified: 3, of: 3 })
    expect(checkReplay(replay, { ...run, key: null }, 'ok').state).toBe('pending')
    // The engine plays the replay's own inputs the same, from the link.
    const read = readReplayFragment(replayFragment(replay))
    if (read.kind !== 'ok') throw new Error(read.kind)
    const again = runMatch(read.bots, read.replay.config, read.replay.rounds)
    expect(checkReplay(read.replay, ranTo(again), 'ok')).toEqual({ state: 'verified', of: 3 })
  })

  it('calls anything else a mismatch, and says what', async () => {
    const { replay, match } = await duel(2)
    const run = ranTo(match)
    expect(checkReplay(replay, run, { problem: "Imp's bytes do not match their SHA-256" })).toEqual(
      {
        state: 'mismatch',
        reason: "Imp's bytes do not match their SHA-256",
      },
    )
    expect(checkReplay(replay, { ...NO_RUN, error: 'Battle: bad config' }, 'ok')).toEqual({
      state: 'mismatch',
      reason: 'the replay did not run: Battle: bad config',
    })
    expect(checkReplay(replay, { ...run, key: '0123456789abcdef' }, 'ok')).toEqual({
      state: 'mismatch',
      reason: 'the recorded match is of other bots or another config',
    })
    const hash = match.rounds[1]?.resultHash as string
    const other = { ...run, hashes: new Map(run.hashes).set(1, '0000000000000000') }
    expect(checkReplay(replay, other, 'ok')).toEqual({
      state: 'mismatch',
      reason: `round 2: result 0000000000000000, recorded ${hash}`,
    })
    const { replay: single, match: one } = await duel(1)
    const tampered = {
      ...single,
      match: { ...one, rounds: [{ ...one.rounds[0], resultHash: 'ffffffffffffffff' }] },
    } as LocalReplay
    expect(checkReplay(tampered, ranTo(one), 'ok')).toEqual({
      state: 'mismatch',
      reason: `result ${one.rounds[0]?.resultHash}, recorded ffffffffffffffff`,
    })
  })

  it('reads as a chip: verifying, verified 1/3, verified, mismatch', () => {
    expect(checkLabel({ state: 'pending', verified: 0, of: 1 })).toBe('verifying')
    expect(checkLabel({ state: 'pending', verified: 1, of: 3 })).toBe('verified 1/3')
    expect(checkLabel({ state: 'verified', of: 3 })).toBe('verified')
    expect(checkLabel({ state: 'mismatch', reason: 'x' })).toBe('mismatch')
    expect(checkTitle({ state: 'pending', verified: 0, of: 1 })).toBe(
      'checked against the recorded result hash when the battle ends',
    )
    expect(checkTitle({ state: 'pending', verified: 1, of: 3 })).toBe(
      '1 of 3 rounds match their recorded result hash; each round is checked when it ends',
    )
    expect(checkTitle({ state: 'verified', of: 1 })).toBe(
      'the result hash matches the recorded one',
    )
    expect(checkTitle({ state: 'verified', of: 3 })).toBe(
      'all 3 rounds match their recorded result hash',
    )
    expect(checkTitle({ state: 'mismatch', reason: 'round 2: result a, recorded b' })).toBe(
      'round 2: result a, recorded b',
    )
  })
})
