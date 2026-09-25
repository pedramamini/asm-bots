# @asmbots/api

The one Cloudflare Worker (ARCHITECTURE §7): Hono serves `/api/*`, and everything else comes from the web app's build (`apps/web/dist`) with the single-page fallback. The engine, assembler, and tourney packages run in it unchanged; nothing it imports may use a Node built-in.

## Local dev

From the repo root:

```sh
bun install
cd apps/api && bun run migrate:local && bun run seed:local && cd ../..
bun run dev          # Vite on :5173 (proxies /api to :8787) + wrangler dev on :8787
```

| Script (root) | Does |
| --- | --- |
| `bun run dev` | `vite dev` and `wrangler dev` side by side (`concurrently`); Ctrl-C stops both. Open http://localhost:5173. |
| `bun run dev:worker` | `wrangler dev` alone on http://localhost:8787: the API plus whatever `apps/web/dist` holds. |
| `bun run build` | The web app (`tsc -b`, `vite build` → `apps/web/dist`), then the Worker (`tsc -b`, `wrangler deploy --dry-run` → `apps/api/dist/worker`). The Worker bundle needs the web build, so the order matters. |
| `bun run deploy` | Placeholder: fails until the deploy playbook (EXEC 3.4) wires it. |
| `bun run test:api` | Vitest in workerd (`@cloudflare/vitest-pool-workers`), fresh D1/R2/KV per file. `bun test` skips these. |

To run the built app the way it deploys, with no Vite: `bun run build && bun run dev:worker`, then http://localhost:8787 serves the SPA and `/api/health`.

Local D1, R2, and KV live in `apps/api/.wrangler/state`; delete that folder to start again, then migrate and seed.

### Secrets

Copy `.dev.vars.example` to `.dev.vars` (git-ignored) for `wrangler dev`. Production sets the same names with `wrangler secret put`. The Worker runs without the file; sign-in then answers 500 `sign-in is not configured` and every reader is anonymous.

| Name | For |
| --- | --- |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | GitHub sign-in (OAuth app) |
| `SESSION_SECRET` | Signs the session cookie |

## Bindings (`wrangler.jsonc`)

| Binding | Kind | Resource | Holds |
| --- | --- | --- | --- |
| `ASSETS` | Static assets | `../web/dist` | The SPA; unknown paths get `index.html`. Everything but `/assets/*`, `/docs-shots/*`, and `/favicon.svg` reaches the Worker first (`run_worker_first`): `/api/*`, and each page, whose head it writes ([Pages and share cards](#pages-and-share-cards)) |
| `DB` | D1 | `asmbots` | Users, bots, versions, hills, tournaments, matches (`src/db/migrations`) |
| `REPLAYS` | R2 | `asmbots-replays` | Replays at `replays/<key>.json`, bot binaries; content-addressed |
| `KV` | KV | `asmbots-kv` | Sessions (`sess:<id>`, 30 days, and `usess:<user>:<id>` beside each so a user's sessions list by prefix), rate-limit counters (`rl:<scope>:<client>:<window>`), share cards (a replay's SVG at `og:<key>`, every card's PNG at `og:png:<SHA-256 of its SVG>`, 1 day each), the ticker's feed (`ticker`, read again after 30 s) |
| `RUNNER` | Durable Object | `Runner` | One per job (`hill:<slug>:<submissionId>`, `tournament:<id>`): plays its matches, one an alarm, into D1 and R2, then settles the hill board or the tournament ([Runner](#runner)) |
| `LIVE_ROOM` | Durable Object | `LiveRoom` | One per hill or tournament (`hill:<id>`, `tournament:<id>`): fans its Runners' events out to spectators' WebSockets and keeps the last 20 ([LiveRoom](#liveroom)) |
| `MATCH_ANALYTICS` | Analytics Engine | `asmbots_matches` | A data point per match a Runner settles: count, duration, bots, kind ([Observability](#observability)) |
| `ISA_VERSION` | var | `x16c-v1` | The ISA the hills run |
| `APP_VERSION` | var | `dev` | Build stamp; deploy passes `--var APP_VERSION:<bun run version>` |
| `CF_VERSION_METADATA` | version metadata | | The running version's id, tag, and upload time: `/api/health`'s uptime counts from it |
| `APP_ORIGIN` | var | `http://localhost:5173` | The one origin CORS lets in (the Vite dev server) |
| `SITE_URL` | var | `https://asmbots.io` | The canonical origin: page heads link to it and share cards sign with its host, whichever host served them. The web build's `SITE_URL` (`apps/web/src/app/pages.ts`) agrees |
| `ADMIN_HANDLES` | var | empty | Who may read `GET /api/admin/stats`: handles, split on commas or spaces, any case. Empty: nobody. A handle is its user's pick, so name only handles their owners hold: a free one could be taken by anyone who signs up |
| `RUNNER_ALARM_DELAY_MS` | var, unset | 0 | Ms between a Runner's alarms. The API tests set an hour and step the alarms by hand (`runDurableObjectAlarm`) |

The cron, `0 18 * * 6`, starts and makes the weekly championship ([Cron](#cron)). The D1 and KV ids are the production ones; `wrangler dev` and the tests keep to local storage. Never mark a binding `remote`: the tests (`@cloudflare/vitest-pool-workers` honors it; `vitest.config.ts` also sets `remoteBindings: false`) and `wrangler dev` would then read and write production data. `.ttf` imports are `Data` (the share cards' font).

## Migrations and seed

Run from `apps/api`:

| Script | Does |
| --- | --- |
| `bun run migrate:local` / `migrate:remote` | `wrangler d1 migrations apply asmbots` on local or production D1 |
| `bun run seed:local` / `seed:remote` | The launch seed: the roster's bots (less test bots) into D1 and R2; showcase bots enter the melee hill. The duel hills are built one challenge at a time, each rated as a Glicko-2 period, so the seeded entries start with ratings. It also makes the next weekly championship, so there is one to enter before the first cron. Migrate first; running it again adds nothing. Flags after `--local` go to wrangler: `bun run scripts/seed.ts --local --persist-to <dir>` seeds that storage. |

A new migration is the next `src/db/migrations/NNNN_name.sql`; never edit one that has shipped. Queries are typed prepared statements in `src/db/queries.ts` (no ORM).

## Routes

Every error is the protocol shape `{ error: { code, message } }` with an `X-Request-Id` header.

Rate limits (`src/rate-limit.ts`, fixed one-minute windows in KV) count a signed-in user by user id and anyone else by IP. Past one, the answer is 429 `rate_limited` with `Retry-After`; every limited answer carries `X-RateLimit-Limit` and `X-RateLimit-Remaining` (the tightest limit's).

| Requests | Per minute |
| --- | --- |
| Every write (`POST`, `PUT`, `PATCH`, `DELETE`) | 60 |
| `POST /api/assemble` | 30 |
| `POST /api/bots` and every `POST` under it (import, versions) | 20 |
| `POST /api/replays` | 10 |
| Every `/api/auth/*` request, reads too (a sign-in is two) | 10 |
| `POST /api/hills/:slug/submit`: submissions made (201) only, so a refused one costs nothing | 5 an hour |
| `POST /api/tournaments`: tournaments made (201) only | 5 an hour |

The audit log (D1 `audit`: `id, user_id, action, target, at`) gets a row in the same batch as each change: `bot.create` (per imported bot too), `bot.update`, `bot.version` (target `<bot id>/v<n>`; a save of the same bytes makes none), `bot.delete`, `hill.submit` (target the submission id), `tournament.create` and `tournament.enter` (target the tournament id), `token.create` and `token.delete` (target the API token id) (`auditInsert` in `src/db/queries.ts`).

### Sign-in and sessions (`src/auth`)

GitHub OAuth through `arctic`. The redirect URI is the OAuth app's registered callback, so the dev app's is `http://localhost:5173/api/auth/github/callback` and production's is the site's. A session is a random id in the signed cookie `__Host-session` (HttpOnly, Secure, SameSite=Lax, 30 days) and `{ userId, createdAt, ua }` in KV at `sess:<id>` with the same TTL. A route that needs someone uses the `requireUser` middleware; `viewerId(c)` is the signed-in user or null.

CSRF: no token. SameSite=Lax keeps the cookie off every cross-site request but a top-level GET, and no GET changes state. A write whose `Origin` is neither the site nor `APP_ORIGIN` is 403. A write with no `Origin` (the CLI, scripts) is allowed, but its cookie counts for nothing, since every browser sends `Origin` on a write. The reasoning is in `src/auth/session.ts`.

API tokens (`src/auth/token.ts`): a script or an AI agent (the CLI's `asmbots login`) signs in with `Authorization: Bearer asmb_<64 hex>`, a personal token its user made on the settings page (`POST /api/me/tokens`). D1 `api_tokens` keeps the token's SHA-256 and its first 12 characters, never the token, which the create answer shows once. `loadSession` takes a token when there is no cookie session, on a write with no `Origin` too; the session is `{ id: 'token:<token id>', userId, createdAt, ua, via: 'token' }`, and rate limits count it by user like any. A token that is not one, or was revoked, is 401 `the api token is not valid` at once, not a request from nobody. `last_used_at` moves at most once an hour, after the response (`waitUntil`). A token acts as its user but for what only a person on the site may do (`refuseToken`, 403 `sign in on the site to do this`): `/api/me/tokens`, `DELETE /api/me`, `/api/auth/*`, `/api/admin/*`. No browser sends an `Authorization` header on its own, and CORS lets no other site set one, so the CSRF reasoning holds.

Beside the session the API sets `signed_in=1`, a cookie the page can read that proves nothing: the web app asks `GET /api/me` only when it is there, so a signed-out visit makes no request and logs no 401.

In dev, sign in from a browser that keeps a Secure cookie on `http://localhost` (Chrome, Firefox).

Test sign-in: with the var `DEV_FAKE_AUTH=1` (`wrangler dev --var DEV_FAKE_AUTH:1`), a request to localhost never goes to GitHub. `/api/auth/github` returns straight to the callback, which signs in `e2e-tester`, or the login `?as=` names. Any other host ignores the var, and `wrangler dev` gives each request the production route's host (`asmbots.io`) unless it runs with `--local-upstream localhost:<port>`. The web e2e (`apps/web/e2e/account.spec.ts`, `hills.spec.ts`) runs on it: Playwright starts `wrangler dev` on :8788 with its own storage in `.wrangler/e2e`, emptied, migrated, and seeded each start, and `RUNNER_ALARM_DELAY_MS=300`, so a spec can watch a submission's progress.

| Method and path | Answers |
| --- | --- |
| `GET /api/health` | `{ ok, version, isa, uptime, since }`: `uptime` is whole seconds since `since`, when this version went up (its upload, from `CF_VERSION_METADATA`; `wrangler dev`'s start locally; this isolate's first answer without one). Touches no storage binding |
| `GET /api/auth/github?returnTo=/path` | 302 to GitHub, with the state (and `returnTo`, a local path) in 10-minute cookies |
| `GET /api/auth/github/callback` | Checks the state, trades the code, makes or refreshes the user by `github_id` (first handle: the login, else login plus a suffix), starts a session, 302 to `returnTo` or `/?signed-in=1`; 400 on a bad state or code |
| `POST /api/auth/logout` | Ends the session (KV and cookie); 204 |
| `GET /api/me` | `{ user, onboarded }` for the signed-in user; 401 otherwise. `onboarded` is false until the user picks a handle |
| `PATCH /api/me` | `{ handle }`: 3..24 of `[a-z0-9-]`, lowercased, no hyphen first, last, or doubled, not reserved (`admin api system roster docs hills arena deleted`), 400 otherwise; 409 when someone has it in any case. Marks the user onboarded → `{ user, onboarded }` |
| `GET /api/me/bots` | `{ bots: [{ bot, latest }] }`: the signed-in user's bots, every visibility, the latest change first; `latest` is the newest version without its source |
| `GET /api/me/audit?limit=` | `{ entries: [{ id, action, target, at }] }`: the signed-in user's audit log, newest first; `limit` 1..100, 50 by default |
| `DELETE /api/me` | Deletes the signed-in account in one D1 batch, then every session it has (KV) → 204. Its bots go with their versions, but a bot with a version on a hill or in a tournament stays so standings keep their shape: owned by the reserved user `deleted`, named and authored `[deleted]`, its sources blanked, 404 to all. What has not started goes: their tournaments not started yet (draft, scheduled), and their entries, and their bots' entries, in anyone's. Their other tournaments, and their entries in them, pass to `deleted`. The audit log and the API tokens go. The GitHub account can sign up again as a new user |
| `GET /api/me/tokens` | `{ tokens: [{ id, name, prefix, createdAt, lastUsedAt }] }`: the signed-in user's API tokens, newest first; never a token or its hash. Cookie sessions only (403 to a token) |
| `POST /api/me/tokens` | `{ name }` (1..40 characters once trimmed), cookie sessions only → 201 `{ token, secret }`: `secret` is the token (`asmb_` and 64 hex digits), shown this once. 409 past 10 tokens an account. With a `token.create` audit row |
| `DELETE /api/me/tokens/:id` | Revokes one of the signed-in user's tokens at once (cookie sessions only) → 204; 404 when it is not theirs. With a `token.delete` audit row |
| `GET /api/version` | `{ version, isa, live }` (`live`: the `LiveRoom` protocol version) |
| `POST /api/assemble` | `{ source }` → `{ bytes, size, diagnostics, sha256 }`; `bytes: null` when the source has errors |
| `POST /api/bots` | `{ name, source, visibility? }`, signed in: assembled here (422 with the first error when it does not), made a bot at version 1 (private by default, bytes in R2) → 201 `{ bot, version }`. 409 past 200 bots an account (deleted ones do not count) |
| `PATCH /api/bots/:id` | `{ name?, visibility? }` (at least one), the owner only: 403 to another who can see it, 404 to one who cannot. The slug stays → `{ bot }` |
| `POST /api/bots/:id/versions` | `{ source }`, the owner only: assembled here (422), the next version → 201 `{ bot, version, created: true }`. Bytes the same as the latest version's make none → 200 `{ bot, version: latest, created: false }`. 409 past 100 versions a bot |
| `DELETE /api/bots/:id` | The owner only: soft (`bots.deleted_at`), so hill entries and matches keep their history; the bot is 404 to everyone from then on, its owner too, and frees its place under the 200. 204 |
| `POST /api/bots/import` | `{ bots: [{ name, source, visibility? }] }` (1..50), signed in: each source assembled here and made a bot at version 1 (private by default, bytes in R2) → 201 `{ results }`, one per bot in order: `{ ok: true, bot, version }`, or `{ ok: false, message, diagnostics }` for one that does not assemble. 409 past 200 bots an account |
| `GET /api/bots/:id` | The bot, its owner, its versions (no sources), its hill places, and `fights`: the finished matches of its versions, hills and tournaments, a match once (duels by the indexed `a_version_id`/`b_version_id`, melees by their participants). A private bot is 404 to others, a deleted one to all |
| `GET /api/bots/:id/versions/:v` | One version, with its source when the bot is public or the reader's |
| `GET /api/bots/:id/og.svg`, `og.png` | Its share card: identicon, name, owner, strategy, size, best place. A public or unlisted bot's; 404 for a private one, to its owner too ([Pages and share cards](#pages-and-share-cards)) |
| `GET /api/hills` | Every hill, its entrant count, and its king |
| `GET /api/hills/:slug` | The hill (with its `scoring`, `duel` or `melee`) and its standings, each with its rating's RD (null until a submission or the seed rated it). The king's entry has its `reign`: the submissions it has held rank 1 through, 0 when the latest crowned it (null on every other entry). The Runner writes it with each board: a king that stays reigns one longer, as does a challenger with its bytes that replaced it |
| `GET /api/hills/:slug/matches?bot=&limit=` | Its finished matches, newest first |
| `GET /api/hills/:slug/og.svg`, `og.png` | Its share card: name, rules, the top 7 of its standings |
| `GET /api/hills/:slug/history?limit=` | `{ events }`, newest first (`limit` 1..100, 20 by default): what each submission did to the board. `entered` (its new rank, and `delta`: its bot's best rank before less the new one, null when the bot had none), `rejected`, `evicted` and `replaced` (the entry's rank before), each with the bot's label |
| `POST /api/hills/:slug/submit` | `{ botVersionId }`, signed in: a version of one of your bots (404 when you may not see it, 403 when it is not yours), its bytes the ones assembled when it was saved. Refused: a `melee`-scored hill (409), a version over the hill's `maxBotBytes` (422), a version on the hill, bytes an entry has (it would take that entry's place and age), a second submission while one is queued or running on that hill (409; a partial unique index backs the check). Makes the `hill_submissions` row and its `hill.submit` audit row in one batch, starts its `Runner` → 201 `{ submissionId, liveRoom }`. A job the Runner refuses is marked `failed` → 409 with the reason |
| `GET /api/hills/:slug/submissions/:id` | `{ submission, bot, progress, matches, events }`: the row (status, score, rank, `needed`: the field score of the lowest entry that stayed, when it did not), its bot version's label, the Runner's `{ done, of, next }` until it has finished (`next`: the bots of the match it is on), its matches in the order played (`<id>-<n>` rows), and its `hill_history` events |
| `GET /api/live/:room` | A spectator's WebSocket to a room: `hill:<hill id>`, or `tournament:<id>` past its draft (404 otherwise). 400 without `Upgrade: websocket`, 403 from another page's `Origin`. Reads no session: anyone may watch |
| `GET /api/tournaments` | `{ tournaments: [{ tournament, entrants, done, of, champion }] }`: running first, then by start time, each with its entrant count, the matches played of the ones its entrants make, and its champion's label once it has one. A tournament has `entry` (`invite` or `open`), `entryClosesAt`, `championId`, and `finishedAt`; its `config` may name a bracket's `seeding` (`given`, `rating`) and `thirdPlace` |
| `GET /api/tournaments/:id` | The tournament, its entrants (in the order its matches index once it has started: by seed), and its matches (each with its `key`, the `matchHash`); a draft is 404 to all but its owner |
| `GET /api/tournaments/:id/og.svg`, `og.png` | Its share card: name, kind, state, champion, and a bracket's drawing (`bracketSvg`) or the points so far; 404 for a draft |
| `POST /api/tournaments` | `{ name, kind, entrants, config }`, signed in: `entrants` is `{ entry: 'invite', botVersionIds }` (2..32, a melee 16; your own versions or anyone's public ones, seeded in the list's order) or `{ entry: 'open', closesAt }` (a deadline within 30 days). 422 for more than 10 rounds a match, more than 200,000 cycles a round, a core other than 65,536, or a version over the config's `maxBotBytes`; 404/403 for a version you may not enter; 400 for one named twice. The tournament (`scheduled`), its invited entries, and its `tournament.create` audit row go in one batch → 201 `{ tournament }` |
| `POST /api/tournaments/:id/enter` | `{ botVersionId }`, signed in: a version of one of your bots enters an open tournament until its deadline (409 after it, once it has started, and for an invite or a full one; 422 over its cap). One entry a user: the first is 201, another replaces it → 200 `{ tournamentId, botVersionId, replaced }`. With a `tournament.enter` audit row |
| `POST /api/tournaments/:id/start` | Its owner starts a scheduled tournament once its entries have closed, with 2 bots or more (403 to others and for a championship, 409 otherwise); its `Runner` plays it, and its live room is `tournament:<id>` → 200 `{ tournamentId, liveRoom }`. A job the Runner refuses cancels the tournament: 409 with the reason |
| `GET /api/matches/:id/verify` | A published match to run again (`MatchVerification`): `{ match, inputs }`, the row its standings came from and the inputs its replay stored (each bot's name, bytes, and SHA-256, the config, the seed, the rounds), keyed by the `matchHash` the row stores. Anyone may ask. 404 for no such match, one not finished, or one whose replay is not stored ([Verification model](#verification-model)) |
| `GET /api/ticker` | The ticker's feed: the latest challenge on any hill (its challenger's `entered` or `rejected`), the last championship to finish and the next (running, else the first scheduled; each with its entrants and champion), and the spectators in the live rooms a page may have open. From KV while it is younger than 30 s, then read again |
| `GET /api/admin/stats` | For `ADMIN_HANDLES` only (401 signed out, 403 otherwise): hill submissions and tournaments by status; the job queue, oldest first (50 at most), each job with its Runner's `{ status, done, of, alarms, error }`; and the Durable Objects: Runners (one a submission and a started tournament), the active ones, live rooms (one a hill and a tournament past its draft), those asked for their count, and the rooms with spectators ([Observability](#observability)) |
| `GET /api/championships?limit=` | The championships feed: `{ championships }`, finished championships as `GET /api/tournaments` has them, the latest to finish first; `limit` 1..100, 20 by default |
| `GET /api/users/:handle` | 404 for `deleted`. The user (any case) and their public bots (all of them for the user themself), their best place on each hill, and their results in finished championships (W/T/L, and `champion`: the champion the Runner wrote, else the winner of the last match) |
| `POST /api/replays` | `{ replay }`: re-simulated (≤ 16 bots, ≤ 10 rounds, ≤ 200k cycles, else 413), result hash checked (422 on a mismatch), stored in R2 → `{ key, url }` |
| `GET /api/replays/:key` | The stored protocol `Replay` |
| `GET /api/replays/:key/og.svg`, `og.png` | The replay's share card: the core's owner map at the end of its last round beside who won; KV keeps the SVG a day (drawing it runs the round again) |
| `GET /api/pages/og.svg?path=`, `og.png` | The share card of a page the web build describes (`/meta/pages.json`): `/`, `/arena`, a docs page; 404 for any other path |
| any other `/api/*` | 404 `not_found` |
| `GET /sitemap.xml` | The build's sitemap with each hill and each public bot added (`lastmod` its last change), an hour's cache |
| anything else | The SPA from `ASSETS`; a page's HTML with its own head ([Pages and share cards](#pages-and-share-cards)) |

## Pages and share cards

The web app draws in the browser, so a crawler or a link preview that runs no script sees only `index.html`. The Worker writes each page's head into it on the way out (`src/site/`, `HTMLRewriter`): `<title>` (the one the route's `head` writes, so the tab does not change as the app starts), the description, the canonical link, `robots: noindex` for the embeds, a draft, an unlisted bot, and the settings, and the Open Graph and Twitter (`summary_large_image`) tags. The ETag goes, since the body is no longer the file's.

- A page with no data of its own (`/`, `/arena`, `/editor`, `/docs/...`) takes the web build's words from `/meta/pages.json` (`apps/web/src/app/pages.ts`), read once an isolate. An arena link that names bots (`/arena?b=roster:dwarf,roster:imp&seed=7`) says which fight; a bot a browser carries in the fragment reads as `a local bot`.
- A page of data takes its words from D1 or R2: a stored replay (`/arena/<key>`: who won, the bots, the rounds, the seed), a bot (name, owner, strategy, best place), a hill (its king), a tournament (kind, state, champion), a profile. A private bot or a draft says nothing of itself. A lookup that finds nothing, fails, or takes past 1 s gives the route's title and the home page's words.
- Every URL is on `SITE_URL`. The image is the page's card.

Cards (`src/og/`) are SVG strings at 1200 × 630 in the sentinel theme, drawn to PNG at the edge by resvg compiled to WebAssembly (`@resvg/resvg-wasm`, started on the first card an isolate draws) with JetBrains Mono (the kit's Latin subset as TrueType, `src/og/fonts`, OFL) as the only font. KV keeps a PNG a day under the hash of its SVG, so a card whose data changed is drawn again and alike cards share one. A replay's card never changes (a day's HTTP cache); the others change with their data (an hour's). The Worker bundle is about 3.1 MiB, 1.1 MiB gzipped, most of it the renderer; it starts in about 30 ms (`wrangler check startup`).

Who may frame what: an embed (`/embed/*`) answers `Content-Security-Policy: frame-ancestors *`, for other sites' `<iframe>`s; every other page `frame-ancestors 'self'`. The API keeps its own policy.

## Runner

`src/do/runner.ts`, with the job logic in `src/runner/`. One Durable Object per job, named by its id: `hill:<slug>:<submissionId>` for a hill submission, `tournament:<id>` for a tournament. `runnerOf(env, job)` gets its stub. RPC: `start(spec)` (reads what the job needs from D1 and R2, keeps it, sets the first alarm; a Runner that has the job answers its status), `status()`, and `cancel()` (stops before the next match; a hill's board stays as it was).

Storage: `job` (the `JobState`: spec, queue of match specs, matches played, status, alarms, failures), `bots` (each bot version's name and bytes as the job took them), and `result:<spec id>` per match.

Each alarm plays the head of the queue:

1. It tells the job's live room `matchStarted`, with the match's inputs.
2. It plays the match with `@asmbots/tourney` `runMatch`, or reads its result back: from the job's own D1 row (the job was cut off after storing it), or from any row with the same `match_key` (another job played the same inputs). A match longer than `ALARM_BUDGET` (50 M instructions: bots × cycles × rounds, about 5 s of CPU) plays a few rounds an alarm.
3. It stores the replay in R2, then the D1 row (`<submission or tournament id>-<spec id>`), then the state and the result in one Durable Object write, and only then sets the next alarm (`RUNNER_ALARM_DELAY_MS` later; 0 in production).
4. It tells the room `matchFinished` (and a tournament's `standings`) and `progress`.

A tournament job writes its entrants' order as their seeds when it starts (a bracket seeded `rating` orders them by their best hill rating). When the queue is empty the job settles. A hill job writes the new board, its ratings (a Glicko-2 period per submission, `src/runner/rating.ts`), its `hill_history`, and its submission's score and rank in one batch, guarded by `hills.revision` (a board changed meanwhile is read again, and an entry that came onto the hill is fought first). A tournament job writes its champion and `finished_at`, which puts a championship in the championships feed. A `JobError` (bad inputs, a bot the engine refuses) fails the job at once; any other error tries again after 2, 4, 8 … up to 60 s, and fails the job after 5 in a row. A failed hill job marks its submission `failed`; a failed tournament is `cancelled`.

## LiveRoom

`src/do/live-room.ts`. One Durable Object per hill (`hill:<hill id>`) or tournament (`tournament:<id>`), the name `liveRoomName` gives. `GET /api/live/:room` opens a spectator's WebSocket to it. The room uses the hibernation API: it sleeps between events with its sockets open.

- Its Runners call `publish(events)`: `matchStarted` (the match's inputs), `matchFinished` (the stored row), `standings`, `progress`. Each goes to every socket, and the last 20 stay in storage (`recent`) for late joiners.
- A socket opens with `hello` (the room and the protocol version), the `spectators` count, then the backlog. The count goes to all a second after joins and leaves (one alarm, not one message per join).
- `{"type":"ping"}` gets `{"type":"pong"}` from the runtime's auto-response, without waking the room. Any other message closes the socket (1008): spectators only listen.
- 500 sockets a room, 20 from one address (`CF-Connecting-IP`); past either, the socket is accepted and closed at once (1013).
- `spectators()` answers the open sockets: the ticker and the admin stats ask it.

## Cron

`0 18 * * 6` (Saturdays 18:00 UTC), the weekly championship (`src/cron.ts`, `src/championship.ts`). Each run starts every championship due (one with fewer than 2 bots is cancelled; a failed start is tried 3 times) and makes next week's, `weekly-<day>`, unless it is there: an open bracket of up to 32, seeded by rating, with a third-place match, under the main hill's rules (10 rounds, 80,000 cycles, 512 B), its matches placed from a seed of its day (`20261003`). It takes entries for six days, until the Friday 18:00 UTC before it. A championship has no owner; nobody may start one but the cron. Run it on `wrangler dev` with a request to `/cdn-cgi/handler/scheduled?cron=0+18+*+*+6` (`/__scheduled` is the SPA's: static assets answer it first).

## Verification model

ARCHITECTURE §7. A client may run anything locally, but standings change only from matches a Runner played itself, from bytes the server assembled when each bot version was saved (in R2 by their SHA-256). No result a client sends counts: `POST /api/replays` runs an uploaded replay again before it stores it, and a stored replay changes no standings.

Every match the server publishes has three records: its D1 row (the result the standings came from: points, survivors, the match's result hash, and each round's), its `match_key` (`matchHash` of the bots' names and bytes, the config, the seed, and the rounds), and its replay in R2 (the inputs, content-addressed by `replayKey`). The engine is deterministic (ISA §5.6), so anyone with the inputs gets the same result, and the web app checks the server in three places:

| Where | Inputs from | Checked against |
| --- | --- | --- |
| A replay page, `/arena/<key>` | `GET /api/replays/:key` | The replay's recorded round hashes |
| A live room (auto-watch) | `matchStarted` | The row `matchFinished` carries |
| `verify` on any published match | `GET /api/matches/:id/verify` | The match's D1 row |

Each check is the same: every bot's bytes against its SHA-256, the key the client computes against the one recorded (another bot, name, setting, or seed is a mismatch even if the result agrees), and each round's result hash; a row the launch seed stored has no rounds, so its one match hash is checked once the last round ends. The chip says `verified` or `mismatch` and why. The server takes no part in the check: it hands over what it ran.

What this does not cover: that a bot is the one a person wrote (names and sources are labels; the hash is of the bytes), and a match of another ISA version (a replay records `x16c-v1`, and the arena refuses others).

## Observability

**Logs.** Every line is one JSON object (`log` in `src/middleware.ts`): `level`, `msg`, and fields. `request` (method, path, status, ms, `requestId`, also the `X-Request-Id` header) for each request; `runner.start`, `runner.match` (kind, job, match, reused, bots, rounds, cycles, ms), `runner.finish`, `runner.cancel`, `runner.step` (a failure: warn while it tries again, error when it gives up), `runner.publish`; `cron`, `championship.start`, `championship.cancel`; `live.socket`, `rooms.count`, `admin.runner`, `analytics.match`; `unhandled` (a 500, with its stack). `observability.enabled` in `wrangler.jsonc` keeps them in Workers Logs.

Follow them live with `wrangler tail`, from `apps/api`:

```sh
./node_modules/.bin/wrangler tail                          # the deployed Worker, every line
./node_modules/.bin/wrangler tail --format pretty          # readable
./node_modules/.bin/wrangler tail --search runner.         # the Runners only
./node_modules/.bin/wrangler tail --status error           # failed requests
```

`wrangler dev` prints the same lines to its terminal. Durable Object logs (`runner.*`, `live.*`) come with the Worker's.

**Analytics Engine.** A Runner writes one data point per match it settles to the dataset `asmbots_matches` (binding `MATCH_ANALYTICS`, `src/analytics.ts`); a write that fails is logged, never the job's failure. Local dev keeps none.

| Column | Holds |
| --- | --- |
| `index1` | The kind: `hill`, `roundrobin`, `bracket`, `melee` (the sampling key) |
| `blob1` | The kind again |
| `blob2` | `played`, or `reused` (its result was stored already) |
| `blob3`, `blob4` | The job id and the match id |
| `double1` | 1: sum it (with `_sample_interval`) for the match count |
| `double2` | Wall time, ms, over all its alarms, storage included |
| `double3`, `double4`, `double5` | Bots, rounds, engine cycles in all |

Query it with the SQL API (`POST https://api.cloudflare.com/client/v4/accounts/<account id>/analytics_engine/sql`, an API token with Account Analytics read):

```sql
SELECT blob1 AS kind, SUM(_sample_interval * double1) AS matches, AVG(double2) AS ms,
  AVG(double3) AS bots
FROM asmbots_matches
WHERE timestamp > NOW() - INTERVAL '1' DAY AND blob2 = 'played'
GROUP BY kind
```

**Admin stats.** `GET /api/admin/stats`, signed in as a handle in `ADMIN_HANDLES`: the jobs by status, the queue with each Runner's report, and the Durable Object counts (see the routes).
