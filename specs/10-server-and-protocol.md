# 10 — Server & Protocol

The server is one process exposing both an HTTP REST API and a WebSocket
endpoint. The frontend uses both — REST for one-shot operations like
`GET /api/version`, WebSocket for the live battle feed.

In the reference prototype both run on **port 8080**.

## HTTP API

### `GET /api/version`

Returns build info.

```json
{
  "success": true,
  "data": {
    "version": "2025.07.12a",
    "date": "2025-07-12T00:00:00Z",
    "name": "Enhanced Battle System",
    "features": ["...", "..."]
  }
}
```

### `GET /api/bots`

List all bots in storage.

```json
{ "success": true, "data": [Bot, Bot, ...] }
```

### `GET /api/bots/:id`

Get one bot by ID.

```json
{ "success": true, "data": Bot }
```

### `POST /api/bots`

Create a bot.

Request:
```json
{ "name": "Hunter", "code": "...assembly...", "owner": "anon" }
```

Response (201):
```json
{ "success": true, "data": Bot }
```

### `DELETE /api/bots/:id`

Delete a bot. Returns 204 on success, 404 if not found.

### `POST /api/battles`

Create a battle.

Request:
```json
{ "bots": ["bot-id-1", "bot-id-2", "bot-id-3"] }
```

Validates that all referenced bots exist and there are ≥ 2 of them.
Creates a `BattleSystem`, parses each bot, places it, returns a `Battle`
object.

### `GET /api/battles/:id`

Get battle state by ID.

### `POST /api/battles/:id/start`

Start a created battle. Runs an initial 10-turn burst, then returns the
state. Subsequent turns can be requested via `/turn`.

### `POST /api/battles/:id/turn`

Body: `{ "turns": N }` (default 1). Run N more turns. Returns the
updated state.

### `GET /health`

Returns "OK". Used by container health checks.

## REST data shapes

```ts
type Bot = {
  id: string                 // UUID
  name: string
  code: string               // raw .asm text
  owner: string
  created: string            // ISO date
  updated: string
  // runtime fields (server-side only):
  memory: Uint8Array
  pc: number
  cyclesExecuted: number
  color: string              // hex
  currentInstruction: string
}

type Battle = {
  id: string                 // UUID
  bots: string[]             // bot IDs
  status: 'pending' | 'running' | 'paused' | 'completed'
  winner?: string
  startTime?: string
  endTime?: string
  events: BattleEvent[]
  memorySize: number
  // ...
}

type ApiResponse<T> = {
  success: boolean
  data?: T
  error?: string
}
```

## WebSocket Protocol

Endpoint: `ws://host:8080/ws`

JSON messages, both directions, of the form:

```json
{ "type": "...", "data": { ... } }
```

### Client → Server

| Type | Data | Effect |
|---|---|---|
| `subscribe` | `{ events: ['battle', 'memory', 'process'] }` | Subscribe to all-event firehose |
| `battle.create` | `{ bots: [{ name, code, owner }, ...] }` | Create + parse + place bots |
| `battle.start` | `{ battleId }` | Begin auto-stepping at 20 Hz |
| `battle.pause` | `{ battleId }` | Stop the auto-step interval |
| `battle.reset` | `{ battleId }` | Reset the controller |
| `battle.step` | `{ battleId, steps }` | Manually step N times |

### Server → Client

| Type | Data | When |
|---|---|---|
| `battle.created` | `{ battleId, processes: [{ id, name, owner }, ...] }` | After `battle.create` succeeds |
| `battle.started` | `{ battleId }` | After `battle.start` |
| `battle.paused` | `{ battleId }` | After `battle.pause` |
| `battle.reset` | `{ battleId }` | After `battle.reset` |
| `battle.update` | `{ turn, metrics: { cyclesPerSecond, memoryUsage, battleProgress } }` | Every tick during run |
| `battle.ended` | `{ battleId, winner, reason, stats, totalTurns }` | When victory detected |
| `memory.update` | `{ updates: [{ address, value, owner }, ...], ranges?: [{ start, data, owner }, ...] }` | After bot placement and after every tick (delta or full) |
| `memory.access` | `{ address, type: 'execute', processId }` | After every executed instruction |
| `process.created` | `{ id, name, owner }` | After `SPL` spawns a child |
| `process.update` | `{ id, pc, state, cycles, instruction, memoryFootprint }` | Every tick per process |
| `process.terminated` | `{ id, reason }` | When a process halts/bombs/errors |
| `error` | `{ message }` | On any failure (parse error, etc.) |

### Event semantics

- The server pushes `memory.update` after each loaded bot during
  `battle.create`, with the bot's just-placed code bytes.
- During `running`, the server's tick interval (50 ms = 20 Hz) executes
  one instruction and emits `memory.update`, `memory.access`, and per-
  process `process.update`. This may emit a LOT of messages — the
  frontend should batch / throttle rendering.
- `memory.update` may use either `updates` (sparse list) or `ranges`
  (contiguous ranges). The prototype mostly uses sparse `updates`.
- `battle.ended` includes `stats` for the winning process so the
  frontend can populate the modal.

### Subscription model

A client subscribes to **all events**. Per-battle subscription is
supported by client subscriptions including a battle ID, but in
practice the prototype's `'all'` subscription is the simpler default —
all clients see all battles.

For multi-battle support, the rebuild should use per-battle
subscriptions: `subscribe { battleId }` joins a room, and broadcasts
filter by room.

### Client lifecycle

1. Connect → `subscribe` with desired events
2. Send `battle.create`
3. Receive `battle.created` → enable Start button
4. Send `battle.start`
5. Receive `battle.started`
6. Receive a stream of `memory.update`, `process.update`, `battle.update`
7. Eventually receive `battle.ended`
8. Show the winner modal

## Ports & deployment

- Reference prototype: single Node process on port **8080**.
- Static files served from `dist/web/` (built copy of `src/web/`).
- Suitable for a single-host Docker container.

For production:
- Reverse-proxy through nginx for TLS termination and WebSocket upgrade.
- Sticky sessions (or shared state) if you horizontally scale — but the
  battle engine is stateful per battle, so it's easiest to keep one
  battle's lifetime tied to one server.

## Auth (optional, post-MVP)

The prototype has stubs for JWT auth and SQLite-backed users — none of
it is wired up. For v1, treat all clients as anonymous. For later phases:

- `POST /api/auth/register` { username, email, password }
- `POST /api/auth/login` { username, password } → JWT
- `Authorization: Bearer <jwt>` on subsequent requests
- WebSocket auth via initial subscribe message including a token

## Persistence (optional, post-MVP)

In-memory `Map`s are fine for v1. SQLite-backed storage when you want
bots, battles, and leaderboards to survive restarts.

Schema sketch:

```sql
CREATE TABLE bots (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  owner TEXT NOT NULL,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

CREATE TABLE battles (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  winner TEXT,
  bots TEXT NOT NULL,            -- JSON array of bot IDs
  result_json TEXT,              -- final stats
  started_at TIMESTAMP,
  ended_at TIMESTAMP
);
```

## Error responses

REST: HTTP status + `{ success: false, error: "message" }`.
WebSocket: `{ type: "error", data: { message: "..." } }`.
