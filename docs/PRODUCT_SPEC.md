---
type: reference
title: ASM Bots Product Specification
created: 2026-09-21
tags:
  - asm-bots
  - product
  - ux
related:
  - '[[DESIGN_SYSTEM]]'
  - '[[ARCHITECTURE]]'
  - '[[ISA_SPEC]]'
---

# ASM Bots Product Specification

Every screen, every interaction, every state. The playbooks implement this; the e2e tests assert it.

## 1. Home `/`

- Ticker: latest hill event, latest tournament result, next scheduled championship countdown.
- Overview: `ASM BOTS`, one line ("Write 8086 assembly. Fight for 64 KB."), then a card for each part of the site (arena, editor, hills, tournaments, docs, for agents): its nav icon, its name as a link, and one or two sentences on what it is. The arena's card also links the intro fight (`/arena?intro=true`). Nothing on the page moves.
- How it works: the core, write, fight, climb, each with its art (DESIGN_SYSTEM §10) and a screenshot, then `take the tour`.
- Three panels: **Main hill** top 10 (rank, bot, author, score, rating, age); **Recent matches** (10 rows, click → replay); **Championship** (next event, entrants so far, `enter` button).
- The site footer (every page that scrolls): the hills as a dither range, and the site's links.
- Footer status: version stamp (its release's name in a tooltip, from `CHANGELOG.md`; a link to the changelog), ISA version, `made with maestro` attribution chip center.

## 2. Arena `/arena`

The soul. Layout: arena panel 8/12 columns, right rail 4/12.

**Setup state** (no battle loaded):
- Roster picker: grid of bot cards (identicon, name, author, size, hill rating, `+` to add). Filters: roster / mine / hill / search. Drop zone accepts `.asm` files (multi). Paste box for raw source.
- Config: rounds (1..10), max cycles (10k..1M, default 100k), seed (random / fixed), process cap, spacing. Preset chips: `duel`, `melee 8`, `melee 16`, `hill rules`.
- `fight` button self-narrates: "add 1 more bot" → "fight · 4 bots · 1 round".

**Battle state**:
- Arena canvas (DESIGN_SYSTEM §5). Overlay HUD top-left: `cycle 12,480 / 100,000`, speed, fps. Top-right: zoom, minimap toggle, fullscreen (`f`), screenshot (`s`, saves PNG with theme and HUD, and a footer stamp: bots, seed, cycle, site URL), video (`v`, records the same frame to MP4/WebM in real time until `v` again or the match ends; `share ▾` → `export video` records the round from cycle 0).
- Transport bar under the canvas: `⏮ step-back · ▶/⏸ · step ▶| · speed slider (1 cycle/frame … max) · scrub bar with death markers in bot hues · round N/K`.
- Right rail:
  - **Bots** table: hue swatch, name, procs (live count with sparkline), footprint (bytes owned), writes, status (`alive` / `dead @ cycle`). Click a row to isolate that bot's territory (others dim); shift-click to add.
  - **Events** log: filtered to spawns, deaths, first-blood, bot deaths, round ends; each line timestamped by cycle; click jumps the scrub bar there.
  - **Standings** (multi-round): running pMARS points per bot.
- End state: victory overlay (`WINNER · dwarf-v3 · last bot standing · cycle 41,203`), stats table, actions: `rematch`, `new seed`, `share` (copies URL that encodes bots by id/hash + config + seed), `open in debugger`, `download replay`.

**Replay** `/arena/:replayId`: same UI, bots and seed loaded from the server (or from a `#` URL fragment for local shares). Shows a `verified` chip after the local simulation matches the recorded result hash.

Keyboard: `space` play/pause, `.` step, `,` step back, `[`/`]` speed, `0` reset zoom, `1..9` isolate bot N, `f` fullscreen, `s` screenshot, `v` video, `?` key help.

## 3. Editor and debugger `/editor`, `/editor/:botId`

Tiled workspace, default: library and editor left, debugger right, arena strip and trace bottom. Every panel (source, problems, library, debug controls, registers, processes, memory, watch, breakpoints, trace, arena strip) is a tile: drag its title row to dock it beside another panel, swap with it, or dock it along the page's edge; drag or arrow-key the dividers to size; hide from its grip menu (the source stays); `layout ▾` shows hidden panels and offers presets (`default`, `writing`, `debugging`). The layout persists in `localStorage`; a moved or hidden panel keeps its state.

**Editor**:
- CodeMirror 6, x16c mode, theme-matched. Listing gutter (address, bytes) updated on every successful assemble. Diagnostics inline (squiggle + gutter mark + problems panel). Hover on a mnemonic: opcode doc card (encoding, flags, one example). Autocomplete for mnemonics, registers, labels, `%` directives.
- Toolbar: file name, `%name` badge, size `142 / 512 B`, `assemble` (auto on idle 300 ms), `format`, `lint`, `save` (local always; cloud when signed in), `versions`, `share`, `test vs ▾` (pick a roster bot, runs 10 rounds headless in the Worker, shows W/T/L instantly).
- Templates menu: `blank`, `imp`, `dwarf`, `scanner skeleton`, `replicator skeleton`, `position-independent base` snippet.
- Bot library sidebar (`b`): my bots, roster (read-only, `fork` copies), recent.

**Debugger**:
- Load: current bot alone, or current bot + opponents (picker). Placement seed field.
- Panels: **Registers** (AX..SP, IP, FLAGS as `ODITSZAPC` bits with on/off styling; edit in place), **Processes** (per bot queue; the running one highlighted; click to select and follow), **Memory** (hex + disassembly window, 32 rows, follows IP by default, `goto` input, owner hue stripe per byte, write highlighting), **Watch** (addresses/expressions, byte/word), **Breakpoints** (address, condition on registers, hit count), **Trace** (last 200 instructions of the selected process).
- Transport: `run`, `pause`, `step`, `step over` (call), `step out`, `run to cursor`, `run until death`, `run N cycles`, `step back` (256-deep), `reset`. Current line highlighted in the editor; clicking a gutter sets a breakpoint (INT3 is not written into the core; breakpoints are engine-side).
- Arena strip: the same renderer, small, following the selected process with a viewport lock toggle.

## 4. Tournaments `/tournaments`, `/tournaments/:id`

- List: cards for scheduled, running, finished. Kinds: `round robin`, `bracket`, `melee`. Filter and search.
- Create (signed in): name, kind, entrant source (my bots / roster / open entry with deadline), rounds per match, config preset, start now or schedule.
- **Bracket view**: SVG bracket, 4..32 entrants, byes, third-place match, live-updating; click a node → match panel (rounds, seeds, per-round survivors, `watch` → arena replay).
- **Round robin view**: results matrix (entrants × entrants, cell = points, hue-tinted), standings table with W/T/L and points, sortable.
- **Melee view**: standings with survival cycle histograms across rounds; `watch round N`.
- **Live mode**: when the runner is executing, a `LIVE` chip pulses and the next match auto-opens in the arena for spectators, simulating locally from the inputs pushed over the WebSocket. Spectator count shown.
- Export: `results.json`, `bracket.svg`, standings CSV.

## 5. Hills `/hills`, `/hills/:slug`

- Hill list: name, size, rules (rounds, cycles, max bytes), entrants, king (top bot), your best rank.
- Hill page: standings table (rank, bot, author, score, rating ± RD, W/T/L, age in submissions, `challenge` to fight it locally), the king's card (its reign in submissions), recent submissions feed with deltas ("+3 rank"), and a `submit` button (signed in; picks one of my bots; server assembles and queues a `Runner`).
- Submission flow: progress panel ("fighting 24 of 32 entrants"), then result card (score, rank, matches list with `watch`). If it did not make the hill: "scored 112, needed 131. closest fight: vs paper-v2 (lost 2–8)."
- Default hills seeded at launch: `main` (size 32, 10 rounds, 512 B), `tiny` (size 16, 256 B, 50k cycles), `melee` (8-bot melee scoring).

## 6. Bots and profiles `/bots/:id`, `/u/:handle`

- Bot page: name, author, strategy blurb, identicon, size, first seen, fights, versions (diff between versions), hill placements, rating history sparkline, recent matches, source (if public), `fork`, `challenge`, `share`.
- Profile: handle, avatar, bots, best hill ranks, championship results, join date.

## 7. Docs `/docs/*`

In-app MDX, same theme, sidebar navigation, search (`/`):

1. **Start here**: what ASM Bots is, the 60-second tour, write your first bot (imp), fight it.
2. **The machine**: memory, registers, flags, processes, cycles, death (ISA_SPEC §1, §5 in plain words with diagrams).
3. **Language reference**: every instruction with encoding, flags, cycles, example; directives; expressions; the position-independence idiom.
4. **Strategy guide**: imp, dwarf, stone, paper, scanners, vampires, imp gates, decoys, SPL tactics, stack tricks; each with a runnable example (`open in arena` button that loads it against a roster opponent).
5. **Tournaments and hills**: formats, scoring, ratings, how verification works.
6. **Tools**: CLI reference, replay format, share links, API.
7. **Changelog** and **ISA versions**.

Every code block has `copy` and `open in editor`.

## 8. Settings `/settings`

Theme (five swatches, live preview), arena effects (bloom, scanlines, vignette, reduced motion), sound, keyboard map (view), account (GitHub link/unlink, handle), data (export my bots as a zip, delete account).

## 9. Auth and onboarding

- Anonymous: everything local works (arena, editor, debugger, local tournaments, roster). Local bots persist in IndexedDB.
- Sign in with GitHub: cloud bots, hill submissions, tournament creation, profile. First sign-in asks for a handle (prefilled from GitHub), then offers to import local bots.
- Boot screen: every load of `/` boots the core first (never on a deep link). The logo and a boot log sit on a panel over a core dump that zeroes, loads four bots, and runs them; under it, two equal buttons: `take tour` (Enter) and `enter site` (Escape). A browser a script drives skips it unless the URL has `?boot=1`.
- Welcome tour: `take tour` opens six steps (the core, a bot, turns and processes, death, winning, where everything is), then `watch the first battle` starts the arena's guided intro (Dwarf vs Imp, first blood, then `pick bots`). `enter site` on the boot screen, or `skip the tour` in the tour, marks it seen; the home page's `take the tour` opens it again.
- First visit to the arena: a 3-step coach mark (roster → fight → watch), dismissible, never shown again.
- Every main page explains itself: a lead line and an `ⓘ` dialog (how it works, key terms, a docs link) on the arena setup, the hills and each hill, the tournaments and each tournament, and a bot's page; the editor has the `ⓘ` in its toolbar. The home page has `how it works` (write, fight, climb).

## 10. Share and social

- Share links encode `isa, config, seed, bots` (by server id, or by inline bytes for local bots ≤ 512 B each, base64url in the fragment). OG image per replay rendered server-side as SVG: arena thumbnail (owner map at end state) + winner line.
- `download replay` writes `*.asmreplay.json` (protocol schema, includes sources when the sharer allows).
- Every page's head carries its title, description, canonical link, and Open Graph and Twitter (`summary_large_image`) tags, written by the Worker from the web build's manifest or from the page's data. Share cards (1200 × 630, sentinel theme) are drawn as SVG and rendered to PNG at the edge: a replay's owner map and winner, a bot's identicon card, a hill's standings, a tournament's bracket thumbnail (or points), and a card for every other page.
- `share ▾` on the arena, replays, bots, hills, and tournaments: `copy link`, `copy embed` (an `<iframe>` of `/embed/arena…`: the arena alone, autoplaying, play/pause and restart, and a `watch on asmbots` chip), `download png`.
- `robots.txt` and `sitemap.xml` (the app's pages, the docs, the hills, the public bots); the embeds and the settings say `noindex`.

## 11. Quality bars (release gates)

- Lighthouse ≥ 95 on performance, accessibility, best practices, SEO for `/`, `/arena`, `/docs`.
- 60 fps arena at 8 bots × 2,000 cycles/frame, Chrome, M1.
- Cold load ≤ 250 KB JS gzipped on `/arena` (engine + renderer + shell; editor lazy).
- Zero console errors on every route in Playwright.
- Every roster bot assembles, formats idempotently, and has a golden.
- All five themes pass the contrast script.
- `bun run golden` reproduces identical results in Bun, Chrome, and Miniflare.
