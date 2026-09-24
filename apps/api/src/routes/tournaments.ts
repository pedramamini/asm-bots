import type { TournamentDetail, TournamentList } from '@asmbots/protocol'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import {
  getTournament,
  listTournamentEntrants,
  listTournamentMatches,
  listTournaments,
} from '../db/queries'
import type { AppEnv } from '../env'
import { idParam } from '../params'
import { viewerId } from '../viewer'

/**
 * `GET /api/tournaments`: running first, then by start time (`listTournaments`).
 * `GET /api/tournaments/:id`: the tournament, its entrants, and its matches. A draft is its
 * owner's: 404 to anyone else.
 */
export const tournaments = new Hono<AppEnv>()
  .get('/', async (c) =>
    c.json({
      tournaments: await listTournaments(c.env.DB, { viewerId: viewerId(c) }),
    } satisfies TournamentList),
  )
  .get('/:id', async (c) => {
    const id = idParam(c.req.param('id'), 'the tournament id')
    const tournament = await getTournament(c.env.DB, id)
    if (
      tournament === null ||
      (tournament.status === 'draft' && tournament.ownerId !== viewerId(c))
    ) {
      throw new HTTPException(404, { message: `no tournament ${id}` })
    }
    const [entrants, matches] = await Promise.all([
      listTournamentEntrants(c.env.DB, id),
      listTournamentMatches(c.env.DB, id),
    ])
    return c.json({ tournament, entrants, matches } satisfies TournamentDetail)
  })
