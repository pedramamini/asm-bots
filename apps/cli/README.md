# @asmbots/cli

Command-line interface for ASM Bots v3. Assemble x16c source, disassemble binaries, run battles, and manage tournaments.

## Installation

Link the CLI to your PATH:

```bash
bun link
```

This exposes the `asmbots` command globally. Alternatively, run commands via:

```bash
bun run asmbots -- <command> [options]
```

## Commands

### `asm <file.asm> [options]`

Assemble x16c source into a binary. Diagnostics use editor-clickable format (`file:line:col`).

**Options:**

| Flag | Description |
|------|-------------|
| `--listing` | Print instruction listing table with addresses, bytes, and source |
| `--bin <file>` | Write binary output to file (default: no output file) |
| `--max-bytes <N>` | Fail if binary exceeds N bytes |
| `--json` | Machine-readable JSON output |
| `--help` | Show command help |

**Examples:**

```bash
# Assemble and show diagnostics
asmbots asm bots/dwarf.asm

# Assemble with listing
asmbots asm bots/dwarf.asm --listing

# Assemble and write binary
asmbots asm bots/dwarf.asm --bin dwarf.bin

# Enforce size limit
asmbots asm bots/dwarf.asm --bin dwarf.bin --max-bytes 8192
```

### `dis <file.bin> [options]`

Disassemble a binary file. Displays address, bytes (hex), and disassembled text columns.

**Options:**

| Flag | Description |
|------|-------------|
| `--base <addr>` | Base address for display (hex, default: 0x0000) |
| `--json` | Machine-readable JSON output |
| `--help` | Show command help |

**Examples:**

```bash
# Disassemble a binary
asmbots dis dwarf.bin

# Disassemble with custom base address
asmbots dis dwarf.bin --base 0x1000
```

### `fight <bot1> <bot2> [more...] [options]`

Run a battle between bots. Accepts roster slugs (`roster:dwarf`) or paths to `.asm` or `.bin` files.

**Options:**

| Flag | Description |
|------|-------------|
| `--seed <N>` | Random seed for placement (default: random) |
| `--rounds <K>` | Number of rounds to run (default: 1) |
| `--cycles <N>` | Maximum cycles per round (default: 100000) |
| `--procs <N>` | Maximum processes per bot (default: 64) |
| `--spacing <N>` | Minimum bytes between bot placements (default: 1024) |
| `--trace` | Print execution trace (instruction-level debug output) |
| `--trace-bot <NAME>` | Print trace only for specified bot |
| `--json` | Machine-readable JSON output |
| `--no-color` | Disable colored output |
| `--help` | Show command help |

**Examples:**

```bash
# Fight two roster bots
asmbots fight roster:dwarf roster:imp

# Fight with custom seed for reproducibility
asmbots fight dwarf.asm imp.asm --seed 42 --rounds 3

# Fight with execution trace
asmbots fight dwarf.asm imp.asm --trace

# Trace only one bot
asmbots fight dwarf.asm imp.asm imp.bin --trace --trace-bot "Imp"

# JSON output for machine consumption
asmbots fight dwarf.asm imp.asm --json
```

**Trace Format**

When using `--trace`, each instruction produces one line:

```
    cycle bot proc    addr   bytes                           text | ax   bx   cx   dx   si   di   bp   sp | ODITSZAPC
        10   0   0 0x0000 b8 00 00 00 00                      ??? | 0000 0000 0000 0000 0000 0000 0000 0000 | oditszapc
        11   0   0 0x0005 89 c3                               ??? | 0000 0000 0000 0000 0000 0000 0000 0000 | oditszapc
        12   0   0 0x0007 ff c3                               ??? | 0001 0000 0000 0000 0000 0000 0000 0000 | Oditszapc
```

Columns:
- **cycle**: Simulation cycle number
- **bot**: Bot index (0-based)
- **proc**: Process queue index for this bot
- **addr**: Current instruction pointer (hex)
- **bytes**: Raw instruction bytes (hex)
- **text**: Disassembled instruction (currently placeholder `???`)
- **Registers**: ax, bx, cx, dx, si, di, bp, sp (hex)
- **Flags**: ODITSZAPC (uppercase=set, lowercase=clear)

### `tourney <format> <bot1> <bot2> [more...] [options]`

Run a tournament. Format can be `roundrobin`, `bracket`, or `melee`.

**Formats:**

- `roundrobin`: Every bot fights every other bot once
- `bracket`: Single-elimination bracket tournament
- `melee`: Free-for-all battle format

**Options:**

| Flag | Description |
|------|-------------|
| `--rounds <K>` | Number of rounds per match (default: 1) |
| `--out <file>` | Write results to JSON file |
| `--json` | Machine-readable JSON output |
| `--help` | Show command help |

**Examples:**

```bash
# Round-robin tournament
asmbots tourney roundrobin roster:dwarf roster:imp roster:redcode

# Bracket tournament
asmbots tourney bracket dwarf.asm imp.asm scanner.asm replicator.asm

# Melee format
asmbots tourney melee roster:* --rounds 3

# Save results
asmbots tourney roundrobin dwarf.asm imp.asm --out results.json
```

### `hill submit <hill.json> <bot.asm> [options]`

Submit a bot to a local King of the Hill. Manages offline play with a hill file.

**Options:**

| Flag | Description |
|------|-------------|
| `--out <file>` | Write updated hill to file (default: overwrite input) |
| `--json` | Machine-readable JSON output |
| `--help` | Show command help |

**Examples:**

```bash
# Initialize a new hill and submit a bot
asmbots hill submit hill.json dwarf.asm

# Submit to existing hill, save updated state
asmbots hill submit hill.json new-bot.asm --out hill.json
```

### `bench [options]`

Benchmark the battle engine. Measures instructions executed per second.

**Options:**

| Flag | Description |
|------|-------------|
| `--seconds <N>` | Duration to run benchmark (default: 5) |
| `--help` | Show command help |

**Examples:**

```bash
# Default 5-second benchmark
asmbots bench

# 10-second benchmark
asmbots bench --seconds 10
```

### `golden [options]`

Verify or update golden test data. Delegates to `scripts/golden.ts`.

**Options:**

| Flag | Description |
|------|-------------|
| `--update` | Update golden results file |
| `--help` | Show command help |

**Examples:**

```bash
# Verify golden tests
asmbots golden

# Update golden results
asmbots golden --update
```

## Global Options

| Flag | Description |
|------|-------------|
| `--json` | Machine-readable JSON output (command-specific) |
| `--no-color` | Disable colored output (respected for all commands) |
| `--help` | Show command-specific help |

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Usage error (e.g., missing required argument) |
| 2 | Assembly error (e.g., syntax error in `.asm` file) |
| 3 | Runtime error (e.g., file not found, engine failure) |

## Output Formatting

By default, colored output is enabled when stdout is a TTY. Colors are automatically disabled when:

- Using `--json` flag
- Using `--no-color` flag
- The environment variable `NO_COLOR` is set
- stdout is piped or redirected

## Examples Walkthrough

### Assemble and Fight

```bash
# Assemble two bots
asmbots asm bots/dwarf.asm --bin dwarf.bin
asmbots asm bots/imp.asm --bin imp.bin

# Fight with reproducible seed
asmbots fight dwarf.bin imp.bin --seed 42 --rounds 5

# Fight with trace output
asmbots fight dwarf.asm imp.asm --trace --cycles 1000
```

### Run a Tournament

```bash
# Round-robin between all roster bots
asmbots tourney roundrobin roster:dwarf roster:imp roster:redcode roster:replicator

# Save results
asmbots tourney bracket dwarf.asm imp.asm scanner.asm --out results.json

# View results
cat results.json | jq '.results.standings'
```

### Development Workflow

```bash
# Update golden tests after changes
asmbots golden --update

# Benchmark performance
asmbots bench --seconds 10

# Debug a specific bot with trace
asmbots fight problematic.asm working.asm --trace --trace-bot "Problematic"
```
