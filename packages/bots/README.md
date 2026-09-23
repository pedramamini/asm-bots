# @asmbots/bots

The roster of ASM Bots: the x16c bots that ship with the game, and the goldens that pin what they do. [roster/README.md](roster/README.md) describes the families, the tiers, and the house style of a bot file. The dependencies are `@asmbots/asm` and `@asmbots/engine`. The package reads no files (each bot is a text import) and uses no clock, so it runs in Bun, the browser, Web Workers, and Cloudflare Workers.

## API

| Export | Does |
|---|---|
| `ROSTER` | One `RosterEntry` for each bot: `slug`, `file`, `name`, `author`, `family`, `tier`, and `blurb`. |
| `loadRoster()` | Each bot by slug: its source, and what `assemble` made of it. It assembles the bots on the first call (at import under `bun test`) and then gives the same map. |
| `fighter(slug)` | The roster bot `slug` as a `LoadedBot`, ready for `new Battle` or `simulate`. |
| `ROSTER_FAMILIES`, `ROSTER_TIERS` | The families and the tiers of [roster/README.md](roster/README.md). |
| `GOLDEN_MATCHUPS`, `HILL_RULES` | The golden matchups (see [Goldens](#goldens)), and the rules they play under: 80,000 cycles, all else at the engine's default. |
| `playGolden(matchup, seed)`, `playGoldens(matchups?)` | The `GoldenResult` of one round, and of every round of the matchups, in order. |
| `diffGoldens(want, got)` | The rounds whose results differ between two lists: `changed`, `new` (only in `got`), or `removed` (only in `want`). |
| `parseGoldens(json)`, `formatGoldens(results)` | The parsed `goldens/results.json`, checked; and the text of the file for a list of results, laid out as Biome formats it. |

Types: `RosterEntry`, `RosterBot`, `RosterFamily`, `RosterTier`, `GoldenMatchup`, `GoldenResult`, and `GoldenChange`.

## Goldens

A golden is one round of a fixed matchup of roster bots under hill rules, and its result. `GOLDEN_MATCHUPS` (`src/goldens.ts`) has 152 rounds:

| Matchups | Seeds | Rounds |
|---|---|---|
| Each pair of showcase bots: 28 pairs of the 8 | 1..5 | 140 |
| Three 4-bot melees: `imp-ring vs dwarf-wide vs silk vs hybrid`, `gate vs decoy vs imp vs scanner`, and `dwarf vs stone vs paper vs vampire` | 1..3 | 9 |
| One 8-bot melee: the 8 showcase bots | 1..3 | 3 |

Each bot except the test bots plays in one or more goldens. `test/test-bots.test.ts` gives each test bot an exact test instead. Round `i` of a matchup plays its bots rotated left by `i`, because the bot order rotates in a match (ISA §5.5).

`goldens/results.json` has one entry for each round, in the order of `GOLDEN_MATCHUPS`:

| Field | Holds |
|---|---|
| `matchup` | The slugs of the bots, joined by ` vs `. |
| `seed` | The seed of the round. |
| `survivors` | The slugs of the bots alive at the end, in the matchup order. |
| `points` | The pMARS points of each bot, by slug. |
| `lastDeathCycle` | The cycle in which the last bot died, or `null` if no bot died. |
| `resultHash`, `eventHash` | The engine's determinism hashes (ISA §5.6): FNV-1a 64 of the result, and of every event of the battle. |

`bun run golden` (at the repo root, `scripts/golden.ts`) plays every round on the main thread and in a Bun Worker. If the two disagree, it stops: the engine is not deterministic. Then it compares the results with the file. If one or more rounds are different, it shows each changed field (old value → new value), and new and removed rounds, and exits 1. CI runs it after `bun run check`. `bun run golden --update` writes the results to the file and shows a table of the rounds that changed. `bun test` also runs `test/goldens.test.ts`, which plays every golden on both threads (about 2 s).

A golden changes only when a bot, the assembler, or the engine changes what a battle does. When you change the code of a bot, its goldens change. When you change the engine or the assembler, the goldens must not change, unless the behavior change is intentional: then give the reason in the commit message. Before you commit `--update` output, read the table and the diff of `results.json`. Make sure that only the rounds you expect changed.

## Adding a bot

1. **Write the file.** Put it in `roster/<slug>.asm` (a test bot goes in `roster/test/<slug>.asm`). Use the [house style](roster/README.md#house-style): a header of three or more sentences on the tactic; `%name`, `%author`, and `%strategy`; the base idiom; labeled sections. The file must be formatter-clean and lint-clean, and at most 512 bytes.
2. **Add the roster entry.** In `src/roster.ts`, import the file as text (`import x from '../roster/<slug>.asm' with { type: 'text' }`), and add a row to `ROWS` with the slug, file, name, author, family, tier, and blurb. `test/roster.test.ts` checks the file against the row and the house style.
3. **Record the fights in the header.** A bot of the six classic families fights `imp.asm` over seeds 1..20 and writes the result in its header: `; vs imp.asm, seeds 1..20: 14 W / 6 T / 0 L`. `record` in `test/fight.ts` gives the numbers. `test/fighters.test.ts` fights each record line again.
4. **Write the tests.** Test what the bot is for: a bar against a rival or a shape in `test/fighters.test.ts`, the paint in `test/painters.test.ts`, or the exact outcome of a test bot in `test/test-bots.test.ts`.
5. **Update the goldens.** A `showcase` bot gets a pair with each other showcase bot automatically. Put a `solid` bot into a melee of `GOLDEN_MATCHUPS`: `test/goldens.test.ts` fails until each bot, except the test bots, plays in a golden. Then run `bun run golden --update`, read the table and the diff of `goldens/results.json`, and commit the file with the bot. The only changed rounds must be those of the matchups that the bot joined.

## Tests

| File | Checks |
|---|---|
| `test/roster.test.ts` | Each bot assembles with no errors, is lint-clean and formatter-clean, is at most 512 bytes, and matches its roster entry and the house style. |
| `test/fighters.test.ts` | Each record line in a header, fought again; the bars of each fighter; what each fighter does alone. |
| `test/painters.test.ts`, `test/test-bots.test.ts` | What each painter paints, and the exact outcome of each test bot. |
| `test/goldens.test.ts` | The matchups; `playGolden` against battles played by hand; the file against `playGoldens` on the main thread and in a Worker; `diffGoldens`, `parseGoldens`, and the layout of `formatGoldens`. |
| `scripts/golden.test.ts` (repo root) | The diff, the table, the Worker check, and the exit codes of `bun run golden`. |
