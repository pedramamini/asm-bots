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
| `ASSETS` | Static assets | `../web/dist` | The SPA; unknown paths get `index.html`, except `/api/*` (`run_worker_first`) |
| `DB` | D1 | `asmbots` | Users, bots, versions, hills, tournaments, matches (`src/db/migrations`) |
| `REPLAYS` | R2 | `asmbots-replays` | Replays at `replays/<key>.json`, bot binaries; content-addressed |
| `KV` | KV | `asmbots-kv` | Sessions (`sess:<id>`, 30 days), rate-limit counters, OG image cache (`og:<key>`, 1 day) |
| `RUNNER` | Durable Object | `Runner` | Tournament and hill runs (stub until EXEC 3.3) |
| `LIVE_ROOM` | Durable Object | `LiveRoom` | Live match WebSocket room (stub until EXEC 3.3) |
| `ISA_VERSION` | var | `x16c-v1` | The ISA the hills run |
| `APP_VERSION` | var | `dev` | Build stamp; deploy passes `--var APP_VERSION:<bun run version>` |
| `APP_ORIGIN` | var | `http://localhost:5173` | The one origin CORS lets in (the Vite dev server) |

Cron: `0 18 * * 6` (Saturdays 18:00 UTC), the weekly championship; `src/cron.ts` only logs until EXEC 3.3. The D1 and KV ids are placeholders that work locally; the deploy playbook fills in the real ones.

## Migrations and seed

Run from `apps/api`:

| Script | Does |
| --- | --- |
| `bun run migrate:local` / `migrate:remote` | `wrangler d1 migrations apply asmbots` on local or production D1 |
| `bun run seed:local` / `seed:remote` | The launch seed: the roster's bots (less test bots) into D1 and R2; showcase bots enter the melee hill. Migrate first; running it again adds nothing. |

A new migration is the next `src/db/migrations/NNNN_name.sql`; never edit one that has shipped. Queries are typed prepared statements in `src/db/queries.ts` (no ORM).

## Routes

Every error is the protocol shape `{ error: { code, message } }` with an `X-Request-Id` header. Write routes (`POST`, `PUT`, `PATCH`, `DELETE`) are rate limited to 60 requests a minute per IP (KV).

### Sign-in and sessions (`src/auth`)

GitHub OAuth through `arctic`. The redirect URI is the OAuth app's registered callback, so the dev app's is `http://localhost:5173/api/auth/github/callback` and production's is the site's. A session is a random id in the signed cookie `__Host-session` (HttpOnly, Secure, SameSite=Lax, 30 days) and `{ userId, createdAt, ua }` in KV at `sess:<id>` with the same TTL. A route that needs someone uses the `requireUser` middleware; `viewerId(c)` is the signed-in user or null.

CSRF: no token. SameSite=Lax keeps the cookie off every cross-site request but a top-level GET, and no GET changes state. A write whose `Origin` is neither the site nor `APP_ORIGIN` is 403. A write with no `Origin` (the CLI, scripts) is allowed, but its cookie counts for nothing, since every browser sends `Origin` on a write. The reasoning is in `src/auth/session.ts`.

In dev, sign in from a browser that keeps a Secure cookie on `http://localhost` (Chrome, Firefox).

| Method and path | Answers |
| --- | --- |
| `GET /api/health` | `{ ok, version, isa }`; touches no binding |
| `GET /api/auth/github?returnTo=/path` | 302 to GitHub, with the state (and `returnTo`, a local path) in 10-minute cookies |
| `GET /api/auth/github/callback` | Checks the state, trades the code, makes or refreshes the user by `github_id` (first handle: the login, else login plus a suffix), starts a session, 302 to `returnTo` or `/?signed-in=1`; 400 on a bad state or code |
| `POST /api/auth/logout` | Ends the session (KV and cookie); 204 |
| `GET /api/me` | `{ user }` for the signed-in user; 401 otherwise |
| `GET /api/version` | `{ version, isa, live }` (`live`: the `LiveRoom` protocol version) |
| `POST /api/assemble` | `{ source }` → `{ bytes, size, diagnostics, sha256 }`; `bytes: null` when the source has errors |
| `GET /api/bots/:id` | The bot, its owner, its versions (no sources), and its hill places; a private bot is 404 to others |
| `GET /api/bots/:id/versions/:v` | One version, with its source when the bot is public or the reader's |
| `GET /api/hills` | Every hill, its entrant count, and its king |
| `GET /api/hills/:slug` | The hill and its standings |
| `GET /api/hills/:slug/matches?bot=&limit=` | Its finished matches, newest first |
| `GET /api/tournaments` | Running first, then by start time |
| `GET /api/tournaments/:id` | The tournament, its entrants, and its matches; a draft is 404 to all but its owner |
| `GET /api/users/:handle` | The user (any case) and their public bots; all of them for the user themself |
| `POST /api/replays` | `{ replay }`: re-simulated (≤ 16 bots, ≤ 10 rounds, ≤ 200k cycles, else 413), result hash checked (422 on a mismatch), stored in R2 → `{ key, url }` |
| `GET /api/replays/:key` | The stored protocol `Replay` |
| `GET /api/replays/:key/og.svg` | The replay's Open Graph image (SVG), cached a day in KV |
| any other `/api/*` | 404 `not_found` |
| anything else | The SPA from `ASSETS` |
