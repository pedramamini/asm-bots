# @asmbots/tourney

Rounds, matches, round robins, melees, brackets, King of the Hill, standings, and Glicko-2 ratings. The contract is [ARCHITECTURE](../../docs/ARCHITECTURE.md) §5, [ISA_SPEC](../../docs/ISA_SPEC.md) §5.5, and [PRODUCT_SPEC](../../docs/PRODUCT_SPEC.md) §4 and §5. The only dependency is `@asmbots/engine`. Every function is pure and every state is plain JSON-safe data, so the same code runs in the browser, the arena Worker, and the tournament Durable Object.

## Formats

| Format | Sync | Incremental | What it does |
|---|---|---|---|
| Round | `runRound(bots, config)` | | One battle. Adds the result hash, the cycles run, and each bot's points. |
| Match | `runMatch(bots, config, rounds)` | `iterateMatch` | K rounds. Round i uses seed `seed + i` (wraps at 2^32) and rotates the bot order by i, so placement order bias cancels. The score is the sum of round points. `matchHash` keys identical matches for the cache. |
| Round robin | `roundRobin(entrants, config, { rounds, groupSize })` | `iterateRoundRobin` | One match per pair, or per k-subset when `groupSize` is k > 2 (at most 16 entrants). `roundRobinSchedule(n, k)` lists the matches in lexicographic order. |
| Melee | `melee(entrants, config, rounds)` | `iterateMelee` | 2..16 entrants in one core per round, as one match. Standings add each entrant's survival cycles per round and a histogram of them. |
| Bracket | `bracket(bots, config, { rounds, ... })` | `createBracket`, `advance`, `nextMatches`, `iterateBracket` | Single elimination, 2..32 entrants, size 2..32. Standard seed positions, so byes go to the top seeds. Seeding is `given`, `rating`, or `{ random: seed }`. Optional third-place match. |
| King of the Hill | `hill(state, challenger, lookup)` | `createHill`, `submitToHill` | The challenger fights every entry. The field ranks by score, then age (older stays), then old board order. Over `size`, the lowest entry goes. A challenger with the same bytes as an entry replaces it. |

## Scoring

A round gives each survivor `pmarsPoints(n, s) = floor((n*n - 1) / s)`, and a dead bot 0 (ISA §5.5):

| Bots n | 1 survivor | 2 survivors | 3 survivors | 4 survivors |
|---|---|---|---|---|
| 2 | 3 | 1 | | |
| 3 | 8 | 4 | 2 | |
| 4 | 15 | 7 | 5 | 3 |
| 8 | 63 | 31 | 21 | 15 |

A match outcome comes from its points: the sole top scorer wins, a shared top is a tie, and the rest lose. A melee counts W/T/L per round instead: sole survivor, shared survival, died.

`standingsFromMatches(names, matches)` totals points, wins, ties, losses, and matches per entrant. `compareStandings` orders by points, then wins (both descending), then name and entrant index. `csv(standings)` writes `rank,entrant,name,points,wins,ties,losses` as RFC 4180 CSV with CRLF line ends. It quotes names that hold a comma, a quote, or a line break, and prefixes `'` to a name that starts with `=`, `+`, `-`, `@`, a tab, or a CR, so a spreadsheet does not run it as a formula.

## Ratings

Glicko-2 as in Glickman's "Example of the Glicko-2 system": τ = 0.5, and a new bot starts at `DEFAULT_RATING` (1500, RD 350, volatility 0.06).

- `updateRating(player, games, { tau?, maxRd? })` is one rating period. Each game is `{ opponent: { rating, rd }, score: 0 | 0.5 | 1 }` against the opponent's rating at the start of the period. With no games, the rating and volatility stay and the RD grows. The RD never goes above `maxRd` (default 350).
- `scoreFromPoints(mine, theirs)` maps match points to a game score: more is 1, the same is 0.5, fewer is 0.
- `rateMatches(ratings, matches)` is one period over played matches: every entrant of a match plays every other entrant of it. The result has a new rating for each entrant, the idle ones included.

The test reproduces Glickman's example (1500/200 vs 1400/30 W, 1550/100 L, 1700/300 L → 1464.06 / 151.52 / 0.05999). The paper rounds as it goes; the unrounded result is 1464.0507 / 151.5165 / 0.059996.

## The resumable iterator contract

The Durable Object drives every format one match (or one round) at a time. All the iterators follow the same rules:

1. **One step per yield.** `iterateMatch` and `iterateMelee` (one match of everyone) yield after each round; `iterateRoundRobin`, `iterateBracket`, and `submitToHill` yield after each match. Each yield holds everything needed to resume: persist it, then pull the next step.
2. **Resume with what you stored.** `iterateMatch` and `iterateMelee` take `{ resume: partialMatch }` (same `key`) and run only the missing rounds. `iterateRoundRobin` and `submitToHill` take `{ resume: MatchResult[] }`, the first matches in schedule order; each must be complete and carry the `matchHash` the schedule expects. A bracket is its own state: pass the last yielded bracket back to `iterateBracket`. A hill is its own state too; `submitToHill` changes it only on its last yield.
3. **Cancel between steps.** Pass `{ signal }`. When it aborts, the iterator throws the abort reason before it starts the next step. A step already running finishes.
4. **The caller runs the battles where it wants.** `iterateBracket` and `submitToHill` take a runner, `(entrants, match) => MatchResult` or `(challenger, defenderEntry, config) => MatchResult`, sync or async, so the DO loads bot bytes by id and can use a match cache. The iterators check that each result is a whole match of the expected entrants.
5. **Same inputs, same outputs.** Seeds come from the config, never the clock. A resumed run yields the same results as an uninterrupted one.

```ts
for await (const step of submitToHill(state, challenger, runner, { signal, resume })) {
  await storage.put('hill-progress', step.matches) // resume from here after an eviction
  if (step.final) state = step.final.state
}
```
