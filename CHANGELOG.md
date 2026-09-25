<!--
How to write a release. Its heading is its version and its name: `## 2026.10.03a · "imp gate"`.
The release in the making is `## Unreleased · "<name>"`. scripts/changelog.ts reads the headings:
the web build's version chip names the release of the build's version, or, for a build ahead of
every release, the one in the making and `unreleased`. To cut one, tag it with `bun run version`'s
stamp (`v2026.10.03a`) and put the stamp in place of `Unreleased`. /docs/changelog renders this
file; this comment shows in neither place.
-->

# Changelog

Every release of ASM BOTS, newest first. A release is named by its date, `YYYY.MM.DD`, with a letter for each release of that day (`2026.10.03a`), and has a name of its own from Core War lore. The version chip in the status bar is the build you run: point at it for its release. The instruction set has its own version, which changes far less often: see [ISA versions](https://asmbots.io/docs/isa-versions).

## Unreleased · "imp gate"

ASM BOTS v3 is a new build from the ground up. Its instruction set, x16c, is real 8086 machine code, and the arena, the editor, the debugger, and local tournaments run in your browser.

**The machine**

- x16c v1: a 64 KB core of bytes, one flat address space, 8086 encoding with three documented divergences (DAT, SPL, no segments). One codec encodes and decodes every instruction, so the assembler, the disassembler, the engine, and the debugger cannot disagree about an instruction.
- The engine: processes, `spl`, the process cap, `rep` one iteration a cycle, owner tags for every byte, and a determinism contract. A battle is a pure function of its bots, its config, and its seed, with a result hash and an event hash to prove it.
- The assembler: NASM syntax, local labels, `equ` and `%define`, `times`, expressions, and diagnostics that name the fix. A disassembler whose output assembles back to the same bytes, a formatter, and a linter.

**The roster**

- 14 fighters and painters in six classic families (imp, dwarf, stone, paper, scanner, vampire) and a painter family of its own, plus 8 test bots. Each fighter's header records its fights, and 152 golden rounds pin what the roster does.

**Tournaments**

- Rounds, matches, round robins, melees of up to 16 bots, single-elimination brackets, King of the Hill, pMARS scoring, and Glicko-2 ratings, in one package that the browser, the CLI, and the server share.

**The app**

- The arena: up to 16 bots, WebGL2 with a 2D fallback, a transport with step back, the events log, the victory, share links, and replays with the `verified` chip.
- The editor: the x16c mode with the listing gutter, lint as you type, format, `test vs`, versions, and a debugger with registers, processes, memory, watches, breakpoints, a trace, 256 steps back, and an arena strip.
- Local tournaments: brackets, round robins, and melees, saved after every match, with exports and snapshot links.
- Five themes, a keyboard for everything, and these docs: the machine, a language reference generated from the opcode table, the strategy guide, and every code block runnable.
- The `asmbots` CLI: `asm`, `dis`, `fight`, `tourney`, and `bench`.

**The server**

- Sign in with GitHub: a handle, cloud bots with versions, and a profile.
- Hills: submit a bot, and the server fights it against every entry, ranks the field, and rates it with Glicko-2. The board keeps the best, and its feed says what each challenge did.
- Server tournaments and the weekly championship, watched live, with every published match verifiable in your browser.
- Share cards for replays, bots, hills, and tournaments; the arena as an embed; and an API.

**Polish**

- Opt-in sound, the arena tour and a guided intro, empty and error states, and an offline banner.
- Accessibility: no axe violation in any theme, every flow by keyboard alone, and a live region for the arena. Budgets for the cold load and the frame rate.
- Details that come with age: release names on the version chip, an fps chip that names the fix when frames drop, arena screenshots signed with their bots, seed, cycle, and site, first seen and fights on a bot's page, the king's reign on a hill, uptime in `/api/health`, and an imp on the 404 page and in `robots.txt`.

## Before v3

ASM BOTS v1 (2025) and v2 (April 2026) were earlier tries at the same game with a made-up instruction set. Their bots never truly ran, and v3 keeps only their look and their ideas.
