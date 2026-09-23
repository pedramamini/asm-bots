---
type: reference
title: ASM Bots Design System
created: 2026-09-21
tags:
  - asm-bots
  - design
  - themes
related:
  - '[[PRODUCT_SPEC]]'
  - '[[ARCHITECTURE]]'
---

# ASM Bots Design System

Reference: [atxsentinel.com](https://atxsentinel.com), measured 2026-09-21 (screenshots in `docs/ref-atxsentinel-*.png`). The feel: a mission-control console that has been running for years. Dense, monospace, quiet, every pixel earning its place. Data glows; chrome does not.

## 1. Principles

1. **Monospace everywhere.** JetBrains Mono 300..700, self-hosted (woff2 subset), no sans-serif anywhere. Tabular numerals on.
2. **Hex is the native unit.** Addresses are `0x0A1F` (4 uppercase digits). Bytes are `FF`. Never decimal for an address.
3. **Color = identity, brightness = recency, white = now.** Bot hues identify; glow decays with age; the current IP is white. Nothing else competes.
4. **Uppercase, letter-spaced labels; lowercase, calm controls.** Panel titles and nav shout quietly (`0.08em` tracking, 11 px); inputs and selects whisper.
5. **Borders, not shadows.** 1 px hairlines in the border token. No drop shadows except the modal overlay.
6. **The arena is always black.** Regardless of theme, the memory map background is `#000`. It is an instrument.
7. **Motion is information.** 120 ms ease-out for state changes; nothing decorative moves. Reduced-motion respected.

## 2. Tokens

CSS variables on `:root[data-theme="…"]`. Tailwind 4 `@theme` maps them to utilities. The shader receives the same palette as a uniform.

| Token | sentinel | amber | pedurple | ice | paper |
|---|---|---|---|---|---|
| `--bg` | `#0A0F0A` | `#0F0A00` | `#0B0810` | `#050A0F` | `#F4F1EA` |
| `--panel` | `#111A11` | `#1A1200` | `#141020` | `#0A141C` | `#FFFFFF` |
| `--panel-2` | `#0D140D` | `#140E00` | `#100C1A` | `#081018` | `#EEEBE3` |
| `--border` | `#1A2F1A` | `#33260A` | `#2A1F45` | `#123040` | `#D8D3C6` |
| `--border-strong` | `#2A4A2A` | `#4D3A10` | `#3F2F66` | `#1C4A60` | `#B8B2A2` |
| `--text` | `#A0C0A0` | `#D6B070` | `#B8A8D8` | `#A0C8DC` | `#1F2A1F` |
| `--text-muted` | `#6A8C6A` | `#8F7A4A` | `#7A6C9A` | `#5E8A9E` | `#5C665C` |
| `--text-dim` | `#4A6A4A` | `#5E5030` | `#4E4466` | `#3C5A6A` | `#9AA39A` |
| `--text-bright` | `#D0F0D0` | `#FFE0A0` | `#E8DCFF` | `#D8F4FF` | `#000000` |
| `--accent` | `#00FF88` | `#FFB000` | `#9146FF` | `#00E5FF` | `#0A7A4A` |
| `--accent-2` | `#00C46A` | `#E09800` | `#7A30E0` | `#00B8CC` | `#08603A` |
| `--warn` | `#FB923C` | `#FF6A00` | `#FF4FA3` | `#FFB74D` | `#B45309` |
| `--danger` | `#FF4444` | `#FF3333` | `#FF3355` | `#FF5A5A` | `#B91C1C` |
| `--info` | `#FFAA00` | `#FFD166` | `#FFAA00` | `#FFD166` | `#92400E` |
| `--arena-bg` | `#000000` | `#000000` | `#000000` | `#000000` | `#000000` |
| `--arena-lattice` | `#0E160E` | `#160F00` | `#120C1C` | `#081218` | `#111111` |
| `--arena-ruler` | `#3A5A3A` | `#5A4620` | `#4A3A6A` | `#2A5A6A` | `#666666` |
| `--arena-ip` | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` |
| `--arena-exec` | `#FFEB3B` | `#FFEB3B` | `#FFEB3B` | `#FFEB3B` | `#FFEB3B` |
| `--arena-write` | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` |

Accent alphas used as fills: `--accent-10` (0.10), `--accent-25`, `--accent-45`, `--accent-80`. Theme persists in `localStorage.theme`; `prefers-color-scheme: light` defaults to `paper` on first visit, otherwise `sentinel`.

Bot palette (12 hues, per theme file; sentinel shown). Chosen for ≥ 3:1 contrast on black and mutual distinguishability at 4 px cells:

```
#FF5C5C  #FF9F43  #FFD93D  #7CFC00  #00FF88  #2DE2E6
#4CC9F0  #7B7BFF  #B57BFF  #FF6BD6  #FF8FA3  #E0E0E0
```

Bot 13+ wraps with a hatched marker in the roster so two bots never share an unmarked hue.

## 3. Type scale

| Role | Size / line | Weight | Tracking | Case |
|---|---|---|---|---|
| Ticker | 11 / 16 | 500 | 0.04em | as written |
| Brand | 13 / 16 | 700 | 0.12em | UPPER |
| Nav button | 11 / 14 | 500 | 0.08em | UPPER |
| Panel title | 11 / 14 | 600 | 0.10em | UPPER |
| Panel status | 10 / 14 | 400 | 0.10em | UPPER, muted |
| Body | 13 / 20 | 400 | 0 | as written |
| Data cell | 12 / 18 | 400 | 0 | tabular |
| Code | 13 / 20 | 400 | 0 | as written |
| Stat number | 24 / 28 | 300 | -0.01em | tabular |
| Modal title | 18 / 24 | 600 | 0.06em | UPPER |

## 4. Layout grammar (from atxsentinel)

```
┌ ticker ─────────────────────────────────────────────────────────────┐  24 px, --panel, hairline bottom
│ ▍LIVE · HILL "MAIN" · dwarf-v3 took #1 · 12,480 cycles →             │
├ header ─────────────────────────────────────────────────────────────┤  40 px
│ ASM BOTS // ARENA      8 bots · 41 procs · cycle 12,480    [ARENA][EDITOR][TOURNAMENTS][HILLS][DOCS]  ◐ ◉ │
├ toolbar ────────────────────────────────────────────────────────────┤  36 px, optional per route
│ > search bots...   [all hills ▾] [any size ▾] [public ▾]   clear     │
├ content ────────────────────────────────────────────────────────────┤
│  panels on a 12-col grid, 12 px gutters, 12 px page padding          │
└ status ─────────────────────────────────────────────────────────────┘  22 px chips: bottom-left status, bottom-center attribution, bottom-right version + fps
```

- **Panel**: `--panel` fill, 1 px `--border`, radius 4, padding 12. Title row: title left (accent), status right (muted). Hairline under the title row.
- **Nav button**: 1 px `--border`, radius 3, padding 4 10, icon 12 px + label. Active: `--accent` border + text + `--accent-10` fill. Hover: `--border-strong`.
- **Segmented control**: bordered pills, 2 px gap, active pill accent-bordered.
- **Input**: `--panel-2` fill, `--border`, `> ` prompt glyph in `--text-dim`, no focus ring, focus = accent border.
- **Chip**: 10 px UPPER, `--panel`, hairline, radius 3, padding 2 8. Semantic variants tint text only.
- **Table**: hairline row separators only, header muted UPPER 10 px, right-align numerics, row hover `--panel-2`.
- **Modal**: centered, `--panel`, `--border-strong`, radius 6, overlay `rgba(0,0,0,0.7)`, Esc and overlay-click dismiss, focus trapped.
- **Toast**: bottom-right stack, 5 s, semantic left stripe 2 px.
- **Skeleton**: `--panel-2` blocks; long loads show the radar-sweep modal (SVG, accent, 2 s rotation).
- **Empty state**: one muted sentence + one accent action. Never an illustration.

## 5. Arena rendering spec

- Grid 256 x 256, cell = 1 byte. Cell size auto-fits the panel; zoom 1x..16x with wheel, pan with drag, `0` resets. Minimap bottom-right of the arena when zoomed.
- Cell fill: `owner == 0 → --arena-bg`. Else bot hue at 0.55 alpha if the byte is non-zero, 0.22 alpha if the byte is zero (owned-but-DAT reads as dim territory, matching "color = identity"). Lattice 1 px `--arena-lattice` at zoom ≥ 4x.
- Write flash: `--arena-write` blended by `exp(-age/220ms)`. Exec trail: `--arena-exec` by `exp(-age/600ms)`. IP: 1 px `--arena-ip` outline plus 2 px glow, one per live process; the front-of-queue process is brighter.
- Death: 300 ms ring ripple in the bot's hue at the death address, then the process outline vanishes. Bot death: the bot's territory desaturates 40% over 800 ms (it stays visible; the dead own what they wrote).
- Spawn: 200 ms outward pulse at the child address.
- Bloom: quarter-res two-pass Gaussian on the emissive channel (IP, trails, flashes only), strength per theme. Scanline + vignette: sentinel/amber/pedurple/ice on, paper off; user toggle in settings.
- Ruler: hex every 0x800 in `--arena-ruler`, bold every 0x1000, left margin 44 px; column ruler top every 0x10 at zoom ≥ 4x.
- Hover: crosshair + tooltip `0x1A2F  7B  add bx, 4  · owned by dwarf-v3 · written 412 cycles ago`.
- 60 fps at 8 bots and 2,000 cycles/frame on an M1 in Chrome; degrade cycles/frame before frame rate.

## 6. Iconography

Lucide icons, 12 px in nav/chips, 16 px in toolbars, stroke 1.75. Semantic set: arena `grid-2x2`, editor `code-2`, tournaments `trophy`, hills `mountain`, docs `book-open`, play `play`, pause `pause`, step `step-forward`, step-back `step-back`, seek `gauge`, theme `palette`, keys `keyboard`, share `link`, verified `shield-check`. No emoji in UI chrome. Bot avatars are 8x8 identicons generated from the bot's bytes hash in its hue.

## 7. Sound (opt-in, default off, persisted)

Tiny synthesized cues via WebAudio, no samples: tick per cycle at low speeds, soft click on write bursts, a low thud on process death, a short falling tone on bot death, a rising three-note on victory. Master volume in settings; `m` mutes.

## 8. Accessibility

WCAG AA contrast for all text tokens on their panels (verified by a script in CI over all five themes). Full keyboard operation; visible focus (accent border). Arena has an ARIA live region summarizing state every 2 s when playing ("cycle 12,480; 3 bots alive; dwarf-v3 leads footprint"). Reduced motion disables bloom pulses, ripples, and the ticker scroll.

## 9. Voice

Terse, technical, lowercase in controls, uppercase in labels. "8 bots · 41 procs" not "There are 8 bots with 41 processes." Errors name the fix: "jump out of range (+142); use `jmp near` or invert the branch." Empty hill: "no entrants yet. submit a bot →".
