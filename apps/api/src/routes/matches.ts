import type { LiveMatch, MatchVerification } from '@asmbots/protocol'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { getMatchRow, toMatch } from '../db/queries'
import type { AppEnv } from '../env'
import { idParam } from '../params'
import { getReplay } from '../storage'

/**
 * `GET /api/matches/:id/verify` (ARCHITECTURE §7, verification model): a published match, and
 * what it takes to run it again. The inputs are its stored replay's (each bot's name, bytes, and
 * SHA-256, the config, the seed, the rounds), keyed by the `matchHash` its row stores (the
 * replay's own, for a row the launch seed stored); the row is the result its standings came from.
 * The server checks nothing here: the client runs the inputs and compares. Anyone may ask, since
 * a published match's bytes are in its replay already. 404 for no such match, one not finished,
 * and one whose replay is not stored.
 */
export const matches = new Hono<AppEnv>().get('/:id/verify', async (c) => {
  const id = idParam(c.req.param('id'), 'the match id')
  const row = await getMatchRow(c.env.DB, id)
  if (row === null) throw new HTTPException(404, { message: `no match ${id}` })
  if (row.result_json === null) {
    throw new HTTPException(404, { message: `match ${id} has not finished: nothing to verify` })
  }
  const replay = row.replay_key === null ? null : await getReplay(c.env.REPLAYS, row.replay_key)
  if (replay === null) {
    throw new HTTPException(404, { message: `the inputs of match ${id} are not stored` })
  }
  const match = toMatch(row)
  const inputs: LiveMatch = {
    id,
    key: match.key ?? replay.result.key,
    participants: match.participants,
    rounds: replay.rounds,
    seed: replay.seed,
    config: replay.config,
    bots: replay.bots.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 })),
  }
  return c.json({ match, inputs } satisfies MatchVerification)
})
