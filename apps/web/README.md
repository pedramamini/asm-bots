# @asmbots/web

The ASM BOTS web app: Vite 6, React 19, TanStack Router (file routes under `src/routes/`) and
Query, Zustand, and the `@asmbots/ui` kit.

| Script | What it does |
| --- | --- |
| `bun run --filter @asmbots/web dev` | Dev server on http://localhost:5173 |
| `bun run --filter @asmbots/web build` | `tsc -b`, then the production build in `dist/` |
| `bun run --filter @asmbots/web preview` | Serves `dist/` on http://localhost:4173 |
| `bun run --filter @asmbots/web test` | Unit and component tests (`test/`), the arena Worker in Bun's real `Worker` |
| `bun run --filter @asmbots/web e2e` | Playwright (`e2e/`): the build, and the dev server for `/_gallery` and the arena Worker |

Docs pages are MDX in `src/docs/`, listed in `src/docs/index.ts`. The arena lives in
`src/features/arena/`: `worker/protocol.ts` has the Worker's messages, `worker/session.ts` the
battle and its keyframes, and `worker/client.ts` the `ArenaClient` and the `useArena` store.
`ArenaCanvas.tsx` draws a client's frames: `render/scene.ts` keeps the core mirror and the glows,
`render/gl.ts` and `render/shaders.ts` draw it with WebGL2 (bloom, scanlines, and vignette from
`render/post.ts`), `render/canvas2d.ts` is the 2D fallback, `render/camera.ts` zooms and pans, and
`render/overlay.ts` draws the rulers.

`/arena` is `ArenaPage.tsx`: `ArenaSetup.tsx` until the fight button, then `ArenaBattle.tsx`. The
URL holds the setup, `?b=roster:dwarf,local:<id>&seed=42&cycles=100000&rounds=3&procs=64&spacing=1024`
(`setup/url.ts`; no `seed` is a random seed each battle), and a share link carries its local bots'
sources in `#src=` (deflated JSON, base64url). `setup/search.ts`, the route's `validateSearch`,
imports nothing, since it rides the entry chunk. `setup/config.ts` has the limits and the presets,
and `setup/bots.ts` the roster, the local and shared bots, dropped files, and the fight button's
words. `vite.config.ts` loads the roster's `.asm` imports as text (`asmText`).

`ArenaBattle.tsx` is the battle, its parts in `battle/`: `Hud.tsx` (a band over the core that the
camera keeps clear), `Transport.tsx` (the scrub bar marks keyframes and bot deaths), the rail's
`BotsPanel.tsx`, `EventsPanel.tsx`, and `StandingsPanel.tsx`, `Victory.tsx`, the hover tooltip
`HoverTip.tsx`, and the keys (`space . , [ ] 0 1-9 f s`) in `keys.ts`. `log.ts` turns the Worker's
messages into the round's timeline, `view.ts` holds what the player picked (isolated bots, the
minimap, autoplay), `screenshot.ts` and `replay.ts` write the PNG and the `.asmreplay.json`. A load
is a match: the Worker plays round i with `@asmbots/tourney`'s `roundOrder` and `roundSeed` and
scores it with `withRound`, so the arena's match equals `runMatch`'s. Frames name bots by their
place in the load, whatever order a round fights them in.

The renderer's Playwright specs drive `e2e/harness/arena.html`, a page only the dev server serves.
`e2e/arena-perf.spec.ts` (16 roster bots at 2,000 cycles a frame, p95 frame gap at most 20 ms) is
its own project and runs after the rest: `bunx playwright test --project perf --no-deps` runs it
alone.

## Lighthouse

Lighthouse 12.8.2 on `/` from `preview`, Chromium 1243 (Playwright's), headless, 2026-09-23.

| Run | Performance | Accessibility | Best practices | SEO |
| --- | ---: | ---: | ---: | ---: |
| Mobile (default throttling) | 94 | 100 | 96 | 100 |
| Desktop (`--preset=desktop`) | 100 | 100 | 100 | 100 |

Mobile: FCP 2.3 s, LCP 2.6 s, TBT 0 ms, CLS 0. Desktop: FCP 0.5 s, LCP 0.6 s.

Fixed in this pass: the missing favicon (a 404 in the console, best practices 93) and the missing
`robots.txt` (the SPA fallback served HTML, SEO 91).

Open items. None is under 90, so they wait for the release gate (PRODUCT_SPEC §11: 95 or more):

- Mobile performance: the stylesheet blocks render (about 450 ms on a throttled link), and the
  `vendor` chunk carries about 60 KiB that `/` does not run.
- Mobile best practices, `font-size`: most text is under 12 px. The type scale (DESIGN_SYSTEM §3)
  sets this on purpose, for a dense desktop layout.

Reproduce:

```sh
bun run --filter @asmbots/web build && bun run --filter @asmbots/web preview &
CHROME_PATH="$HOME/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" \
  bunx lighthouse@12 http://localhost:4173/ --chrome-flags="--headless=new" --view
```
