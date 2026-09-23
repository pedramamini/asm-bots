---
type: report
title: ASM Bots v3 Research Brief
created: 2026-09-16
tags:
  - asm-bots
  - research
  - vision
  - isa
related:
  - '[[ISA_SPEC]]'
---

# ASM Bots v3 Research Brief

Distilled from a full read of v1 (2025, Roo + Claude, 28 commits), v2 (April 2026, Maestro playbooks, 8 commits), and outside research. This is the input to the v3 playbook set.

## 1. The vision (Pedram, 2026-09-16)

- Many bots per battle, not two. Rounds, championships, brackets. Other people bring bots.
- The live fight visualization is the soul of the product. Must be beautiful.
- A beautiful bot editing and debugging platform is part of the MVP.
- Theme: top-notch, hacker-esque, on point.
- Language: IA32-ish, a simplified x86, not Redcode.
- Dazzling MVP. No "rough demo first."

## 2. Why v1 and v2 died

| Cause | Evidence |
|---|---|
| Operand encoding could not distinguish register from immediate | `mov r0, 1` assembled as `mov r0, r1`; `[r3]` marker destroyed by byte split (v1 `CodeGenerator.layout`) |
| Three disagreeing size models | Parser counts 1 unit per instruction, encoder emits 1 to 5 bytes, fetcher always reads 3. Every label jump landed mid-instruction |
| `cmp` wrote its result into `r0` | No flags register; the compare destroyed the value being tested |
| Half the ISA silently no-op'd | Fetcher only decoded operands for mov/arith/jumps; `cmp inc dec and or xor push pop` executed as NOPs |
| `si` aliased `bx`, `word` was a register | Vampire's copy loop copied onto itself |
| Bots never actually ran | Instrumented v1 engine: both RandomWriters die after ~15 instructions with zero memory writes. The pretty canvas was the renderer coloring the initial code load |
| Wire protocol resent the full 64 KB of owned bytes every 50 ms tick, one instruction per tick | Capped battles at 20 instr/sec |
| v2 stopped after memory/parser/scheduler | Phase 2 playbooks authored but never launched; index never reconciled; no execution unit, server, or UI |

Lesson: the instruction encoding must be self-describing from the opcode word alone, and the engine must be verified with golden tests before any UI work.

## 3. What to keep from v1/v2

**Visual language (v1 canvas), keep all of it:**
- 256 x 256 grid, one cell per address, hex ruler down the left (bold every 0x1000, light every 0x800), addresses always `0x0A1F` style.
- Memory view is always black regardless of theme. It is an instrument, not a document.
- Color = identity (bot hue, ~70% alpha), brightness = recency (white write flash, yellow `#FFEB3B` PC trail fading over 1 s with a 0.3 floor), PC = crisp white 1 px outline. Three orthogonal channels.
- 1 px gutter between cells so the lattice shows.
- Two fonts only: system sans for chrome, monospace for anything that is data.
- Self-narrating buttons ("Need 1 more bot" -> "Create Battle with 3 Bots").
- Terminology: Battle Arena, Memory Map, Battle Log, Bot, Process, Cycle, IPS, Memory Footprint, Last Bot Standing.
- Timestamped level-prefixed log lines, filtered to interesting events only.

**Intended but never shipped (v1 dead components), build for real:**
- Debugger transport: run, step, reset, run-to-breakpoint, 100 ms human-readable free-run.
- Hex inspector: address input, cell value, owner, disassembly; hover tooltip on the canvas.
- Replay deck: record, play, pause, scrub, speed 0.5x/1x/2x/4x, export/import JSON.
- Leaderboard with win/loss, streaks, quick-win bonus.
- Replicator/painter bots that make the canvas spectacular (LCG + bounded scatter window + walk + rare teleport + complementary patterns).

**v2 spec bundle:** module DAG, protocol shapes, bot catalog, do/don't list. Reuse the structure, replace the ISA.

## 4. Outside research

- **Core War tournaments** ([corewar.co.uk hills](https://corewar.co.uk/hills.htm), [guide](https://corewar.co.uk/manley/guide.htm)): the canonical format is King of the Hill. A hill holds N warriors; a submission fights everyone on the hill over many rounds with different random placements; score = 3 per win, 1 per tie, 0 per loss (pMARS `W*3 + T`); lowest scorer is pushed off. Also round-robin and melee (all warriors in the core at once). We need all three plus single-elimination brackets.
- **Existing web Core War** ([corewar.io](https://github.com/corewar/corewar-ui), [Core-War-Reimagined](https://github.com/Coltosaur/Core-War-Reimagined) with Wasm engine + Monaco): all Redcode, all 1v1, all utilitarian UI. There is no polished multi-bot x86-flavored arena. The niche is open.
- **Editor**: [CodeMirror 6](https://www.pkgpulse.com/guides/monaco-editor-vs-codemirror-6-vs-sandpack-in-browser-2026) over Monaco. ~50 KB, tree-shakeable, custom language via Lezer or stream parser, gutter markers for breakpoints, inline diagnostics via the lint extension, themeable to the pixel. Monaco is 2 to 5 MB and fights custom theming.
- **Rendering**: [WebGL instancing](https://webglfundamentals.org/webgl/lessons/webgl-instanced-drawing.html) or a data-texture fragment shader trivially handles 65,536 cells at 60 fps ([Quadratic renders millions](https://www.quadratichq.com/blog/building-a-high-performance-spreadsheet-renderer-why-we-chose-webgl-over-html)). Upload three 256x256 textures per frame (owner, write-age, exec-age); the shader does color, glow, fade. Post-process bloom and subtle scanlines are cheap.
- **Simplified x86 precedent**: [ihmels asmsimulator](https://ihmels.github.io/asmsimulator/instruction-set.html), [x86sim](https://github.com/suatata2121-lang/x86sim): NASM-style syntax, real flags (ZF SF CF OF), Jcc family, small memory. Confirms the shape.

## 5. Proposed design

### 5.1 ISA: "x16c" (working name), 8086-flavored, byte-addressable 64 KB

Decision 2026-09-21 (Pedram): replicate a real 16-bit machine. 64 KB of bytes is huge for Core War (classic core is 8,000 cells) and that is the point: more room, more bots, longer hunts, more fun.

- Memory: 65,536 bytes (256 x 256 grid, one byte per cell). Addresses wrap mod 65536. Registers and values are 16-bit, wrap mod 65536. Little-endian words.
- Registers: `ax bx cx dx si di bp sp ip flags`. Byte halves `al ah bl bh cl ch dl dh`. Flags: ZF SF CF OF. Segments do not exist; the whole core is one flat 64 KB segment.
- Variable-length instructions, real x86 style: `[opcode][modrm?][disp8|disp16?][imm8|imm16?]`, 1 to 5 bytes. One shared `codec` module is the single source of truth for both encoding and decoding, so the assembler, disassembler, and fetcher cannot disagree (the v1 killer). Misaligned execution decodes whatever bytes are there. Walking into an enemy's data and executing it as garbage is a feature.
- Operand modes via a ModR/M-lite byte: `mod:2 reg:3 rm:3` with mod 00 = `[rm]`, 01 = `[rm+disp8]`, 10 = `[rm+disp16]`, 11 = register. `rm=110` under mod 00 = direct `[disp16]`. Operand size bit in the opcode (byte vs word), so `mov byte [bx], 0` and `mov word [bx], 0` both exist and matter.
- Opcode `0x00` = `DAT`. Zeroed core is a minefield. Executing DAT kills the process. `mov word [bx], 0` is the classic bomb. `int 3` (`0xCC`) is a second breakpoint/kill byte.
- Instructions: `mov xchg lea add adc sub sbb inc dec neg mul imul div and or xor not shl shr sar rol ror cmp test jmp jcc(je jne jz jnz jl jge jle jg jb jae jbe ja js jns jo jno) call ret push pop pusha popa loop loopz loopnz nop hlt spl dat int3`, plus the string ops `movsb movsw stosb stosw lodsb lodsw cmpsb scasb` with `rep`/`repe`/`repne`. String ops are what make x86 replicators elegant: `rep movsw` copies a bot in one instruction (but one cycle per byte, so it is fair).
- `jmp`/`jcc`/`call`/`loop` use rel8/rel16 (ip-relative). Data access through `[bx]`, `[si]`, `[bp+disp]`, or `[disp16]`. Bots that need position independence use `call $+3 / pop bx` style tricks, exactly like real shellcode. No relocation pass. The assembler emits absolute `[disp16]` only when the programmer writes it; the loader places bots at random offsets and does not patch anything.
- Division by zero kills the process. Unknown opcodes kill the process (real x86 `#UD`), unlike v1's "unknown = NOP" which made garbage walks invincible.
- Syntax: NASM flavor. `mov ax, [bx+4]`, `mov word [di], 0`, `jnz .loop`, `db`/`dw`/`times`, `equ`, `$`, `$$`, label arithmetic (`end - start`), local labels, `%define`, `.name/.author/.strategy` metadata, `;` comments.
- Bot size cap: 512 bytes default, configurable per hill.
- Process model (pMARS fairness): each bot owns a process queue. One cycle = every living bot executes one instruction from the head of its queue. `spl target` enqueues a child (own registers copied, own esp). Per-bot process cap (default 64). A bot dies when its queue is empty.
- Battle: N bots placed at random non-overlapping offsets with minimum spacing; seeded RNG; deterministic given (bots, seed, config). Max cycles default 80,000. Victory: last bot standing; otherwise tie among survivors (pMARS scoring), with memory footprint shown as a stat, not as the winner rule.
- Round: one battle. Match: K rounds with different seeds. Tournament: round-robin, single-elimination bracket, melee, or hill, all built on matches.

### 5.2 Architecture

```
packages/engine    deterministic VM, zero deps, runs in Bun, Node, browser, Worker
packages/asm       assembler + disassembler + diagnostics + listing
packages/bots      roster of .asm warriors + golden results
packages/tourney   round/match/tournament logic, scoring, brackets, hill
apps/cli           bun cli fight|tourney|bench|asm
apps/web           Vite + React 19 + Tailwind 4; WebGL2 arena; CodeMirror 6 editor; engine in a Worker
apps/server        Bun + Hono + bun:sqlite + WebSocket: users, bots, hills, tournaments, spectate
```

- Engine runs client-side. Spectating a live server match sends only (bots, seed, config); every client simulates in lockstep. Zero bandwidth for the fight itself, perfect replays for free.
- Server exists for the social layer: accounts (or magic-link), bot submission, persistent hills, scheduled championships, brackets, leaderboard, share links.

### 5.3 UI surfaces (MVP)

1. **Arena**: full-bleed WebGL memory map with glow, PC pulses, bomb ripples, death bursts; minimap; zoom/pan; hover inspector; bot roster with live footprint/processes/cycles; transport (play, pause, step, speed slider, scrub bar); event log; winner overlay.
2. **Editor + Debugger**: CodeMirror 6 with syntax highlighting, inline errors, assembler listing pane (address, encoded word, source), breakpoints in the gutter, registers + flags panel, process list, hex/disassembly window around eip, watch cells, step/over/run-to-cursor, "Test vs" quick match against any roster bot.
3. **Tournament**: create round-robin, bracket, melee, or hill; pick roster + uploaded bots; watch matches auto-play with a results grid, bracket view, and standings; export results.
4. **Hill / Leaderboard** (server): submit a bot to a hill, see standings, see history, spectate live matches.
5. **Theme system**: multiple themes, switchable at runtime, persisted. Reference design is [atxsentinel.com](https://atxsentinel.com) (Pedram's own site; screenshots in `docs/ref-atxsentinel-map.png` and `docs/ref-atxsentinel-stats.png`). See 5.5.

### 5.5 Visual system (from atxsentinel.com)

Measured tokens from the live site:

| Token | Value | Use |
|---|---|---|
| bg | `#0A0F0A` | page background, green-tinted near-black |
| panel | `#111A11` | cards, panels |
| border | `#1A2F1A` | 1 px panel and button borders |
| text | `#A0C0A0` | body text |
| text-muted | `#6A8C6A` | labels, secondary |
| text-dim | `#4A6A4A` | placeholders, disabled |
| text-bright | `#D0F0D0` | emphasized values |
| accent | `#00FF88` | active nav, titles, glow dots, primary action; used at alphas 0.1 / 0.45 / 0.55 / 0.8 for fills, rings, glows |
| warning | `#FB923C` | orange diamonds, alerts |
| danger | `#FF4444` | critical |
| amber | `#FFAA00` | secondary alert |
| font | JetBrains Mono 300..700 | everything, no sans anywhere |

Structural idioms to copy:
- Top ticker bar (one line, bold prefix, `·` separators, `→` link). In ASM Bots: live hill/tournament ticker.
- Header: `ASM BOTS // ARENA` in accent, letter-spaced caps, with a centered live stat (`1,088 / 1,296 cameras (83%)` becomes `8 bots · 41 processes · cycle 12,480`) and a right-aligned row of small bordered nav buttons with an icon and uppercase label; the active one has an accent border and accent text.
- Filter row: `> search...` prompt-style input, lowercase `<select>` chips, a `clear` link.
- Panels: `#111A11` fill, 1 px `#1A2F1A` border, small radius, uppercase letter-spaced accent title top-left, status word (`LOADING`, `LIVE`) top-right in muted text, hairline divider under the title.
- Segmented controls (`WEEK MONTH QUARTER YEAR`) as bordered pills, active pill accent-bordered.
- Status chip bottom-left (`3 ACTIVE · 2 MAJOR`), attribution chip bottom-center, corner utility button bottom-right.
- Data as glowing dots on black: the map is exactly the arena feel. Cells should glow like those camera dots.
- Loading states are skeleton blocks in the panel color plus a centered radar-sweep modal.

Themes to ship (all sharing the same token names, only values change):

| Theme | Character |
|---|---|
| `sentinel` (default) | the atxsentinel palette above, phosphor green |
| `amber` | amber CRT: `#FFB000` accent on `#0F0A00` |
| `pedurple` | `#9146FF` accent on `#0B0810`, magenta warning |
| `ice` | cyan `#00E5FF` on `#050A0F` |
| `paper` | light mode: `#F4F1EA` bg, ink text, accent `#0A7A4A`, for daylight demos |

The arena canvas takes its bot palette from the theme too (12 hues chosen to sit on the theme background), while the empty-core color stays black in every dark theme.

Keyboard-first: space play/pause, `.` step, `,` step back (replay), `[`/`]` speed, `/` search, `t` theme cycle, `?` key help. Version stamp bottom-right, `YYYY.MM.DD[letter]` style like v1.

### 5.4 Roster (ship with at least 12 real warriors)

Ported and fixed: fortress, hunter, vampire, RandomWriter1/2. New classic ports: imp, dwarf, stone, paper, scanner, vampire-pit, silk-style replicator, plus 2 to 3 "painter" showcase bots. Every roster bot has a golden test (bots, seed) -> expected outcome.

## 6. Playbook shape

Match the Maestro conventions already used in v2 (flat `.maestro/playbooks/`, `EXEC_<phase>_<step>_<TOPIC>.md`, one task per module, `- [ ]` only, absolute paths, never let agents tick their own boxes). Skip PLAN playbooks: the ISA spec is written by hand with Pedram's sign-off, then EXEC playbooks run against a fixed spec.

| Playbook | Delivers | Gate |
|---|---|---|
| `EXEC_0_1_SKELETON` | Bun monorepo, lint, test, CI | `bun test` green |
| `EXEC_1_1_ENGINE` | VM: memory, decode, ALU, flags, processes, scheduler, spl/dat | opcode unit tests |
| `EXEC_1_2_ASSEMBLER` | lexer, parser, expressions, diagnostics, listing, disassembler | round-trip tests |
| `EXEC_1_3_ROSTER` | 12+ bots, golden matchups | goldens green |
| `EXEC_1_4_CLI` | fight, tourney, bench | headless tournament runs |
| `EXEC_2_1_ARENA` | WebGL arena renderer + worker bridge | 60 fps, 8-bot melee |
| `EXEC_2_2_SHELL` | app shell, theme, routing, panels | screenshot review |
| `EXEC_2_3_EDITOR_DEBUGGER` | CodeMirror language, debugger panels | step-through demo |
| `EXEC_2_4_TOURNAMENTS_LOCAL` | round-robin, bracket, melee, standings UI | full bracket auto-plays |
| `EXEC_3_1_SERVER` | accounts, bots, hills, spectate | two browsers watch one hill match |
| `EXEC_3_2_POLISH` | sound, share links, onboarding, docs | Pedram sign-off |
