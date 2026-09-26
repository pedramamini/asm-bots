# @asmbots/ui

The UI kit of ASM Bots: the tokens of [DESIGN_SYSTEM §2](../../docs/DESIGN_SYSTEM.md#2-tokens) in seven themes, the type scale of §3, and 32 primitives on React 19 and Tailwind 4. There is no component library: each primitive is ours, one file in `src/primitives/`. The gallery shows every primitive in every state, in each theme, beside the three reference layouts of §4.

## Use it

```css
/* The app's one stylesheet: Tailwind, the font, the tokens, and the kit's utilities. */
@import "@asmbots/ui/tailwind.css";
```

```tsx
import { initTheme, Panel, Stat } from '@asmbots/ui'

initTheme() // the stored theme, else paper for a light system, else sentinel
```

| Import | Holds |
|---|---|
| `@asmbots/ui` | The primitives, the theme functions, and the helpers: `cx`, `vars`, `hueColor`, `hexAddress`, `hexByte`, `maskHex`, `contrastRatio`, `blend`, `useReducedMotion`, `applyMotion`. |
| `@asmbots/ui/tailwind.css` | Tailwind 4, the vendored JetBrains Mono, the tokens, and the utilities that read them. |
| `@asmbots/ui/tokens.css` | The tokens alone: a `:root[data-theme="…"]` block for each theme. |
| `@asmbots/ui/themes` | `THEMES`, `applyTheme`, `initTheme`, `getPaletteFloat32`, and the palettes, without React: for Workers, scripts, and the Playwright spec. |
| `@asmbots/ui/gallery` | `Gallery`, the review page. Import it lazily, in development only. |
| `@asmbots/ui/fonts/*` | The woff2 files, for `<link rel="preload">`. |

Every primitive has a named export and typed props. `className`, the HTML attributes, and `ref` pass through; the doc comment of each says to which element (a field with a glyph, such as `Input`, puts `className` on its box and the rest on the native element). The only inline style is a CSS variable, set with `vars()`. Icons are lucide at 12 or 16 px, stroke 1.75.

## Tokens

`<html data-theme="…">` picks the theme. Each token is a CSS variable and a utility, so a utility changes with the theme. The values of each theme are in DESIGN_SYSTEM §2 and `src/tokens.css`; the gallery's token sheet shows them as the browser resolves them, with the contrast of each text token on each surface.

| Token | Utilities | For |
|---|---|---|
| `--bg` | `bg-bg` | The page. |
| `--panel` | `bg-panel` | Panels, chips, tooltips, menus, toasts, the modal. |
| `--panel-2` | `bg-panel-2` | Fields, keycaps, skeletons, the hovered table row. |
| `--border` | `border-border` | Every hairline. |
| `--border-strong` | `border-border-strong` | A control under the pointer; the edge of a modal, menu, tooltip, or toast. |
| `--text` | `text-text` | Body and data. At least 4.5:1 on each surface. |
| `--text-muted` | `text-muted` | Labels, panel status, idle controls. At least 4.5:1, on the `--accent-10` fill too. |
| `--text-dim` | `text-dim`, `placeholder:text-dim`, `marker:text-dim` | The `>` prompt glyph, placeholders, list markers: never content. No floor. |
| `--text-bright` | `text-bright` | Names, numbers that matter, modal titles, and any text on an `--accent-25` or `--accent-45` fill. At least 4.5:1 on all of them. |
| `--accent` | `border-accent`, `outline-accent`, `bg-accent` | The focus ring (3:1 or more), the active control's border, the fills. Not text: see `--accent-fg`. |
| `--accent-fg` | `text-accent-fg` | The accent as text: panel titles, the brand, the active control's label, links. The accent itself where that reads at 4.5:1; a lighter violet in pedurple, paper's darker green. |
| `--accent-10`, `-25`, `-45`, `-80` | `bg-accent-10`, … | The accent as a fill: 10% under an active control. Mixed from `--accent`. |
| `--accent-2` | `text-accent-2`, … | A second accent (the editor's directives). At least 4.5:1 as text. |
| `--warn`, `--danger`, `--info` | `text-warn`, `text-danger`, `text-info`, … | Chip variants, toast stripes, deltas. At least 4.5:1 as text. |
| `--arena-bg`, `--arena-lattice`, `--arena-ruler`, `--arena-ip`, `--arena-exec`, `--arena-write` | `bg-arena-bg`, `text-arena-ruler`, … | The arena, black in every theme. The renderer takes the same colors from `getPaletteFloat32(theme)`. |
| `--bot-0` … `--bot-11` | `bg-bot-0`, …, or `hueColor(bot)` | The 12 bot hues, the same in every theme. Bot 12 and up wraps and is hatched. |

| Scale | Values | Utilities |
|---|---|---|
| Space | 4, 8, 12, 16, 24, 32 px (`--space-1` … `--space-8`) | `p-1` … `p-8`, `gap-3`, `m-2`, …: a step is 4 px. |
| Radius | 3, 4, 6 px | `rounded-sm` (controls, chips), `rounded-md` (panels), `rounded-lg` (the modal). |
| Layer | ticker 10, header 20, toast 40, modal 50 | `z-ticker`, `z-header`, `z-toast`, `z-modal`. |
| Type | The 10 roles of §3, each with its size, line, weight, tracking, and case | `text-ticker`, `text-brand`, `text-nav`, `text-panel-title`, `text-panel-status`, `text-body`, `text-data`, `text-code`, `text-stat`, `text-modal-title`. |

Tailwind's own palette, font stacks, radii, and type sizes are off: a color, a radius, or a type size is a token or it does not exist.

Two utilities of the kit's own besides the type roles and the animations: `truncate-ring`, a `truncate` that clips 2 px out so a focus ring inside still shows (a table cell, a line that holds a link; a flex item needs `min-w-0` too, since `overflow: clip` makes no scroll container), and the `motion-reduce:` and `motion-safe:` variants, which read the app's override on `<html data-motion>` (`applyMotion('reduce' | 'full' | 'system')`) before the system's `prefers-reduced-motion`, as `useReducedMotion()` does.

## Primitives

| Layout | Usage |
|---|---|
| `Panel` | `<Panel title="standings" status="32 entrants" actions={<Button>export</Button>}>…</Panel>`; `dense` for rails. |
| `PanelGrid` | `<PanelGrid><Panel className="col-span-8" /><Panel className="col-span-4" /></PanelGrid>`: 12 columns, 12 px gutters. |
| `Ticker` | `<Ticker items={[<b>▍LIVE</b>, 'dwarf-v3 took #1']} link={{ href: '/hills/main', label: 'open the main hill' }} />`: a marquee when it overflows. |
| `Header` | `<Header brand="ASM BOTS" stat="8 bots · 41 procs" nav={navButtons} right={iconButtons} />`: 40 px. |
| `Toolbar` | `<Toolbar aria-label="filters"><Input … /><Select … /></Toolbar>`: 36 px; the arrow keys move between its controls. |
| `StatusBar` | `<StatusBar left={<Chip>live</Chip>} center={<Chip>made with maestro</Chip>} right={<Chip>60 fps</Chip>} />`: 22 px, over the page or the arena. |
| `SplitPane` | `<SplitPane label="editor width" storageKey="editor"><Editor /><Debugger /></SplitPane>`; `direction="column"` stacks them; `collapsed` folds the second pane to its own size and hides the divider, both panes staying mounted. |

| Controls | Usage |
|---|---|
| `NavButton` | `<NavButton href="/arena" icon={Grid2x2} active>arena</NavButton>` |
| `Button` | `<Button variant="primary" icon={Swords} loading={busy}>fight</Button>`: `default`, `primary`, `ghost`, `danger`; `sm`, `md`. |
| `IconButton` | `<IconButton icon={StepBack} label="step back" shortcut="," />`: the label is its name and its tooltip; `pressed` makes it a toggle. |
| `Segmented` | `<Segmented label="range" options={['week', 'month']} value={range} onValueChange={setRange} />` |
| `Toggle` | `<Toggle pressed={bloom} onPressedChange={setBloom}>bloom</Toggle>` |
| `Input` | `<Input placeholder="search bots..." />`; `<Input mono digits={4} />` is the hex field. |
| `Select` | `<Select aria-label="hill"><option>all hills</option></Select>` |
| `Slider` | `<Slider aria-label="speed" min={1} max={10_000} scale="log" format={perFrame} showValue />` |
| `Chip` | `<Chip variant="accent" icon={ShieldCheck}>verified</Chip>`: `neutral`, `accent`, `warn`, `danger`, `info`. |
| `Kbd` | `<Kbd>space</Kbd>` |
| `Tooltip` | `<Tooltip content="the replay matches its hash"><Chip tabIndex={0}>verified</Chip></Tooltip>` |
| `Menu` | `<Menu trigger={<Button>templates ▾</Button>} items={[{ label: 'dwarf', onSelect }, 'separator', …]} />` |

| Data display and feedback | Usage |
|---|---|
| `Table` | `<Table columns={columns} rows={rows} rowKey={(row) => row.id} defaultSort={{ column: 'score', direction: 'desc' }} />`: it draws only the rows in view past 200. |
| `Stat` | `<Stat label="cycles" value="12,480" delta={1204} note="vs last round"><Sparkline … /></Stat>`; `invert`, `loading`. |
| `Sparkline` | `<Sparkline values={procs} hue={bot} width={64} height={16} />`; `bars` for a histogram. |
| `Identicon` | `<Identicon value={bytes} hue={bot} size={32} />`: 8 × 8 cells from a hash of the bytes. |
| `HueSwatch` | `<HueSwatch hue={bot} />` |
| `Hex` | `<Hex value={0x1a2f} />` shows `0x1A2F`; `<Hex byte value={255} />` shows `FF`. |
| `Modal` | `<Modal open={open} onClose={close} title="submit to hill" actions={buttons}>…</Modal>`: `sm`, `md`, `lg`. |
| `Toast` | `const { toast } = useToast(); toast('link copied', { variant: 'accent' })`, under one `<ToastProvider>` at the root. |
| `Skeleton` | `<Skeleton className="h-2.5 w-24" />`; `<Skeleton rows={5} />` holds a table's place. |
| `RadarLoader` | `<RadarLoader framed label="loading dashboard" detail="6 sections remaining" />` |
| `EmptyState` | `<EmptyState action={{ label: 'submit a bot', href: '/hills/main' }}>no entrants yet.</EmptyState>`; `dense` for a dense panel's list; a button action can be `disabled`. |
| `CoachMark` | `<span className="relative flex"><IconButton icon={Play} label="run" /><CoachMark onDismiss={dismiss}>press <Kbd>F5</Kbd> to debug.</CoachMark></span>`: a first-visit hint in its control's `relative` box, under it by default (`placement`: `bottom-start`, `bottom-end`, `top-start`, `top-end`, or `inline`, in the flow under a panel's title); the page stores `got it`. A tour's step: `step="2/3"`, `dismissLabel="skip the tour"`, and an `action={{ label: 'next', onClick }}` beside it. |
| `KeyHelp` | `<KeyHelp bindings={[{ keys: ['g', 'a'], description: 'go to arena', group: 'global' }]} />` |

## Themes

| Export | Does |
|---|---|
| `THEMES` | `sentinel`, `amber`, `pedurple`, `ice`, `paper`. |
| `applyTheme(theme, { persist })` | Sets `<html data-theme>`, and stores the choice in `localStorage.theme` unless `persist` is false. |
| `initTheme()` | Applies the stored theme, else paper when the system prefers light, else sentinel. It stores nothing, so the page follows the system until the user picks. |
| `getPaletteFloat32(theme)` | The 18 RGBA rows of the arena shader's palette: the 12 bot hues, then the arena colors (`PALETTE_INDEX`). |
| `BOT_HUES`, `ARENA_COLORS` | The same colors as hex strings. |

### Add a theme

1. **One CSS block.** In `src/tokens.css`, copy a `:root[data-theme="…"]` block, then name it and set its values: `color-scheme`, the 20 tokens of §2, and `--bot-0` … `--bot-11`. Keep the 12 hues: the arena is black in every theme.
2. **One palette entry.** In `src/themes.ts`, add the name to `THEMES`, and a row to `BOT_HUES` and to `ARENA_COLORS`. These feed the arena renderer; a test holds them equal to the CSS block.
3. **Run contrast.** `bun run contrast` measures each text token on `--bg`, `--panel`, and `--panel-2`, and fails under 4.5:1 for `--text` and `--text-bright` or 3:1 for `--text-muted`. Change the block until it passes.

Then add the theme's column to the §2 table in `docs/DESIGN_SYSTEM.md` (the token tests read their expected values from it) and to the list in `test/themes.test.ts`, and run `bun test packages/ui`. The gallery's switcher and the Playwright spec take their list from `THEMES`: review the theme at `/_gallery?theme=<name>`.

## Gallery

`src/gallery/Gallery.tsx` is the page. The web app mounts it at `/_gallery` in development (EXEC 2.2). `?theme=<name>` picks the theme and the switcher at the top keeps the query in step; the gallery does not store the theme, and it puts the stored theme back when it unmounts.

| Section | Shows |
|---|---|
| Reference layouts | The three layouts of §4 in 780 px frames, with placeholder data: the arena in battle (hold it against `docs/ref-atxsentinel-map.png`), a hill under the filter row, and a tournament that is loading (hold it against `docs/ref-atxsentinel-stats.png`). The arena is `ArenaMock`, a canvas still of a frozen battle, until the renderer (EXEC 2.3) replaces it. |
| Tokens | Every token as the browser resolves it; each text token on each surface with its ratio; the arena colors in a zoomed patch of the core; the scales; each type role with its computed metrics. |
| Layout, controls, data display and feedback | Each primitive on a sheet named after it (`<Specimen name="Button">`), in each state that changes how it looks. |

A state that needs the pointer or the focus carries `data-force="hover"` or `data-force="focus focus-visible"`, and `data-force-target` when a descendant takes it. `apps/web/e2e/gallery.spec.ts` forces them through the DevTools protocol, opens the menu and a tooltip, and writes `gallery-<theme>.png` (the whole page, 1440 px wide at 2x) and `modal-<theme>.png` (the modal over three toasts) to `apps/web/e2e/__screenshots__/`. The gallery is a development route, so the spec runs against the dev server (`GALLERY_URL`, default `http://localhost:5173`).

A new primitive needs a sheet: `test/gallery.test.tsx` fails until each file in `src/primitives/` has one.

## Tests

`bun test packages/ui` runs the kit's tests in jsdom (`test/dom/preload.ts` says how). The token tests read their expected values from DESIGN_SYSTEM §2 and §3. `test/primitives/classes.test.tsx` and `test/gallery.test.tsx` compile every class the primitives and the gallery use, because Tailwind ignores a mistyped class without a word. `bun run contrast` gates the text tokens in every theme.
