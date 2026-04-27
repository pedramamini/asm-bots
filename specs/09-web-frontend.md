# 09 — Web Frontend

The browser experience is the soul of the game. Three components:

1. **MemoryVisualization** — a canvas grid showing every byte of core,
   colored by ownership and animated with PC trails.
2. **Dashboard** — the bot list, metrics, execution log.
3. **BattleClient** — the WebSocket plumbing.

Plus an upload zone and a winner modal.

## Layout

```
┌────────────────────────────────────────────────────────────────┐
│  [theme toggle]                                                │
│                                                                │
│  ┌──────────────────────────┐  ┌───────────────────────────┐  │
│  │ Memory Visualization     │  │ Battle Arena              │  │
│  │                          │  │                           │  │
│  │  ┌────────────────────┐  │  │  [Start] [Pause] [Reset]  │  │
│  │  │ canvas (256×256ish │  │  │                           │  │
│  │  │  cells, hex addrs  │  │  │  Bot list with state,     │  │
│  │  │  on left edge)     │  │  │  PC, cycles, memory       │  │
│  │  └────────────────────┘  │  │                           │  │
│  │                          │  │  Metrics:                 │  │
│  │  Pixel size: [slider]    │  │   - Execution speed (IPS) │  │
│  │                          │  │   - Memory efficiency %   │  │
│  │  Memory map legend:      │  │   - Battle progress %     │  │
│  │   ■ Bot 1 (Player)       │  │                           │  │
│  │   ■ Bot 2 (Player)       │  │  Execution log (recent)   │  │
│  │   ■ Instruction Pointer  │  │                           │  │
│  └──────────────────────────┘  └───────────────────────────┘  │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Upload Bots                                              │  │
│  │  [drag-and-drop zone for .asm/.txt]                      │  │
│  │  [list of uploaded bot cards with × buttons]             │  │
│  │  Manual entry: [name input] [code textarea] [Add Bot]    │  │
│  │  [Create Battle (disabled until ≥ 2 bots)]  [Clear All]  │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘

(plus a streaming battle log textarea below the dashboard,
 and a winner modal that pops up on battle.ended)
```

## MemoryVisualization

Renders a `256 × N` grid of cells onto a `<canvas>`. For 64 KB memory and
the default cell size of 8 px, that's `256 cols × 256 rows`. Cells are
1-byte-per-cell.

### Bot color palette

8 distinct colors, cycled by registration order:

```js
const BOT_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
  '#FFEAA7', '#DDA0DD', '#98D8C8', '#F8B500'
]
```

Bot 1 is red, bot 2 teal, bot 3 blue, etc.

### State

- `memory: Uint8Array(memorySize)` — last known byte values.
- `owners: Uint8Array(memorySize)` — last known owners.
- `processMap: Map<pid, { name, color, pc, active }>` — registered
  processes.
- `accessMap: Map<address, { time, type: 'execute'|'write' }>` — recent
  accesses for animation; entries older than 1 second are evicted on each
  render.

### Render loop

`requestAnimationFrame` drives a render at the browser's rate (~60 fps).
For each cell:

1. Default color: very dark gray (`#1a1a1a` dark mode, `#111111` light).
2. If `memory[i] != 0` AND owner has a registered color, use that color
   at 70% alpha.
3. If a recent `write` access at this address: white flash, opacity fades
   over 1 second.
4. If a recent `execute` access at this address: bright yellow flash,
   opacity fades — this is the **PC trail**.
5. If any active process's PC is currently at this cell: white outline.

Grid lines are drawn at every cell boundary in light mode (so the grid
is visible) — slightly more transparent in dark mode.

Hex address labels are drawn down the left margin every 8 rows (and bold
every 16 rows).

### Cell size slider

The user can resize cells from 2 px to 16 px. The grid layout (256
columns) stays fixed; only cell pixel size changes. Canvas is resized on
each cell-size change.

## Dashboard

Lists each registered process in a card:

```
[colored left border]
Hunter                              [state: Running/Ready/Terminated]
Owner: Player 1
PC: 0x12FE
Cycles: 4231
Memory: 432 bytes
```

Three metric tiles:
- **Execution Speed** — instructions per second (computed from a moving
  window).
- **Memory Efficiency** — % of memory cells that are non-zero.
- **Battle Progress** — turn / maxTurns × 100, capped at 100.

Plus an **Execution Log** scrolling list of the most recent 20 executed
instructions in the form `[BotName] 0x12FE: mov r0, r1`.

Three control buttons:
- **Start** — sends `battle.start`. Disabled while running. Becomes
  "Resume" while paused.
- **Pause** — sends `battle.pause`. Disabled while not running.
- **Reset** — sends `battle.reset`. Disabled until a battle exists.

## Streaming log

A `<textarea readonly>` below the dashboard. Important events
(`battle.created`, `battle.started`, `battle.ended`, errors, plus key
instruction types like `jmp/call/spl/halt/mov`) are appended in
chronological order with timestamps:

```
14:32:18 [INFO] Battle created with ID: abc123
14:32:18 [INFO] Processes: Hunter (ID: 1), Vampire (ID: 2)
14:32:19 [INFO] Battle STARTED! Execution beginning...
14:32:25 [INFO] Bot 2 executed spl @ 0x4123
14:32:31 [INFO] Process 1 TERMINATED: DAT bomb executed
14:32:31 [INFO] BATTLE ENDED! Winner: Process 2
```

It does NOT show every instruction; only "interesting" ones. Otherwise it
overwhelms the user.

## Upload zone

- Drag-and-drop accepts `.asm` and `.txt` files.
- Click on the zone (or a "Choose Files" label) opens the file picker.
- Each successfully parsed file becomes a "bot card" with the filename
  (sans extension) as the name and a × to remove it.
- Manual entry: name + textarea, "Add Bot" button.
- "Create Battle" is disabled until ≥ 2 bots are uploaded. When clicked,
  sends `battle.create` over WebSocket with the array of `{ name, code,
  owner }` and clears the upload list.
- "Clear All Bots" wipes the upload list.

## Winner modal

Triggered by `battle.ended`. A centered modal with overlay:

```
🏆 Battle Complete!
Winner: Hunter (Player 1)

Memory Footprint: 1 432 bytes
Cycles Executed:  4 231
Final PC:         0x12FE
Total Battle Turns: 1 000
Victory Method:   Largest Memory Footprint
```

A "Close" button dismisses it.

## Theme toggle

Top-right floating button. Light/dark CSS variables. Persists via
`localStorage.theme`.

## Wire-up details

The frontend uses ES modules (`<script type="module">`), no framework.
Three modules: `MemoryVisualization.js`, `BattleClient.js`,
`Dashboard.js`. `app.js` wires them together at `DOMContentLoaded`.

Connection retry: exponential backoff up to 5 attempts. On final
disconnect, show "Connection lost. Please refresh the page."

## Performance

Naive per-cell rendering at 60 fps for 65 536 cells works fine on modern
machines but is wasteful — most cells don't change between frames. Two
easy optimizations the prototype does NOT do:

1. **Dirty-cell tracking.** Only redraw cells that changed (or had recent
   access). The full background can be drawn once into an offscreen
   canvas and blitted.
2. **Throttle to update rate.** Render only when an update arrives or
   the access map changes, not at full 60 fps.

Implement these in the rebuild if you want to scale to larger memories.

## Optional polish

- Step / Step-N controls (the protocol supports `battle.step`).
- Replay/scrub bar (the prototype has stub `ReplaySystem.ts` but it's
  not wired up).
- Bot editor with syntax highlighting (Monaco or CodeMirror).
- Speed slider (frame skip).
- Sound effects on bomb hits and process death.
