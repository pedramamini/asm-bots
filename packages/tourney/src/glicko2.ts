/**
 * Glicko-2 ratings (ARCHITECTURE §5): a secondary number per bot across hill history. This is
 * Glickman's algorithm ("Example of the Glicko-2 system", 2012) with τ = 0.5 and a new player at
 * 1500 / RD 350 / volatility 0.06.
 *
 * One call to `updateRating` is one rating period: the player's games in the period, each
 * against the opponent's rating at the start of the period. A player with no games keeps its
 * rating and volatility, and its RD grows. RD is capped at `maxRd` (default 350) so a long idle
 * bot is no less certain than a new one.
 *
 * A game's score comes from match points: more points is a win (1), the same is a tie (0.5),
 * fewer is a loss (0). `rateMatches` applies that to every pair of entrants in each match.
 */
import type { PlayedMatch } from './scoring'

/** A rating on the Glicko scale. */
export interface Rating {
  readonly rating: number
  /** The rating deviation (RD). */
  readonly rd: number
  /** σ, the expected fluctuation of the rating. */
  readonly volatility: number
}

/** A game score: win, tie, or loss. */
export type GameScore = 0 | 0.5 | 1

/** One game in a rating period, against the opponent's rating at the start of the period. */
export interface Game {
  readonly opponent: Pick<Rating, 'rating' | 'rd'>
  readonly score: GameScore
}

export interface Glicko2Options {
  /** τ, the system constant that limits the change in volatility. Default `TAU`. */
  readonly tau?: number | undefined
  /** The largest RD a period can produce. Default the new-player RD, 350. */
  readonly maxRd?: number | undefined
}

/** A new player's rating. */
export const DEFAULT_RATING: Rating = Object.freeze({ rating: 1500, rd: 350, volatility: 0.06 })

/** The default system constant τ. */
export const TAU = 0.5

/** Glicko to Glicko-2 scale factor, 400 / ln 10. */
const SCALE = 173.7178

/** The convergence tolerance of the volatility iteration. */
const EPSILON = 0.000001

/** The score of a game with `mine` points against `theirs`. */
export function scoreFromPoints(mine: number, theirs: number): GameScore {
  return mine > theirs ? 1 : mine === theirs ? 0.5 : 0
}

/** The player's rating after one rating period with `games` (Glickman, steps 1-8). */
export function updateRating(
  player: Rating,
  games: readonly Game[],
  options: Glicko2Options = {},
): Rating {
  const tau = options.tau ?? TAU
  const maxRd = options.maxRd ?? DEFAULT_RATING.rd
  checkRating(player, 'player')
  if (!(player.volatility > 0) || !Number.isFinite(player.volatility)) {
    throw new RangeError(`glicko2: player volatility must be positive, got ${player.volatility}`)
  }
  if (!(tau > 0)) throw new RangeError(`glicko2: tau must be positive, got ${tau}`)

  const mu = (player.rating - 1500) / SCALE
  const phi = player.rd / SCALE
  const sigma = player.volatility

  if (games.length === 0) {
    const rd = Math.min(Math.sqrt(phi * phi + sigma * sigma) * SCALE, maxRd)
    return { rating: player.rating, rd, volatility: sigma }
  }

  // Step 3 and 4: the estimated variance v and the estimated improvement delta.
  let vInverse = 0
  let sum = 0
  for (const [i, { opponent, score }] of games.entries()) {
    checkRating(opponent, `opponent ${i}`)
    if (score !== 0 && score !== 0.5 && score !== 1) {
      throw new RangeError(`glicko2: score must be 0, 0.5, or 1, got ${score} in game ${i}`)
    }
    const g = gOf(opponent.rd / SCALE)
    const e = 1 / (1 + Math.exp(-g * (mu - (opponent.rating - 1500) / SCALE)))
    vInverse += g * g * e * (1 - e)
    sum += g * (score - e)
  }
  const v = 1 / vInverse
  const delta = v * sum

  // Step 5: the new volatility (the Illinois algorithm).
  const volatility = newVolatility(phi, sigma, v, delta, tau)

  // Step 6 and 7: the new RD and rating.
  const phiStar = Math.sqrt(phi * phi + volatility * volatility)
  const phiNew = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v)
  const muNew = mu + phiNew * phiNew * sum

  // Step 8: back to the Glicko scale.
  return {
    rating: muNew * SCALE + 1500,
    rd: Math.min(phiNew * SCALE, maxRd),
    volatility,
  }
}

/**
 * One rating period over `matches`: in each match, every entrant plays every other entrant, and
 * the game score comes from their match points. `ratings[e]` is entrant e's rating at the start
 * of the period; the result has the new rating of every entrant, those without games included.
 */
export function rateMatches(
  ratings: readonly Rating[],
  matches: Iterable<PlayedMatch>,
  options: Glicko2Options = {},
): Rating[] {
  const games: Game[][] = ratings.map(() => [])
  for (const { entrants, result } of matches) {
    if (entrants.length !== result.points.length) {
      throw new RangeError(
        `glicko2: a match has ${entrants.length} entrants and ${result.points.length} points`,
      )
    }
    entrants.forEach((e, j) => {
      const mine = games[e]
      if (mine === undefined) throw new RangeError(`glicko2: no entrant ${e}`)
      entrants.forEach((o, k) => {
        if (k === j) return
        const opponent = ratings[o]
        if (opponent === undefined) throw new RangeError(`glicko2: no entrant ${o}`)
        const score = scoreFromPoints(result.points[j] as number, result.points[k] as number)
        mine.push({ opponent, score })
      })
    })
  }
  return ratings.map((r, e) => updateRating(r, games[e] as Game[], options))
}

function gOf(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI))
}

function newVolatility(phi: number, sigma: number, v: number, delta: number, tau: number): number {
  const a = Math.log(sigma * sigma)
  const phi2 = phi * phi
  const f = (x: number): number => {
    const ex = Math.exp(x)
    const d = phi2 + v + ex
    return (ex * (delta * delta - phi2 - v - ex)) / (2 * d * d) - (x - a) / (tau * tau)
  }
  let lo = a
  let hi: number
  if (delta * delta > phi2 + v) {
    hi = Math.log(delta * delta - phi2 - v)
  } else {
    let k = 1
    while (f(a - k * tau) < 0) k++
    hi = a - k * tau
  }
  let fLo = f(lo)
  let fHi = f(hi)
  while (Math.abs(hi - lo) > EPSILON) {
    const c = lo + ((lo - hi) * fLo) / (fHi - fLo)
    const fC = f(c)
    if (fC * fHi <= 0) {
      lo = hi
      fLo = fHi
    } else {
      fLo /= 2
    }
    hi = c
    fHi = fC
  }
  return Math.exp(lo / 2)
}

function checkRating(r: Pick<Rating, 'rating' | 'rd'>, what: string): void {
  if (!Number.isFinite(r.rating)) throw new RangeError(`glicko2: ${what} rating is not finite`)
  if (!(r.rd > 0) || !Number.isFinite(r.rd)) {
    throw new RangeError(`glicko2: ${what} RD must be positive, got ${r.rd}`)
  }
}
