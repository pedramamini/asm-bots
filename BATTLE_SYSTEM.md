# ASM-Bots Battle System

## Overview

The ASM-Bots Battle System is a Core Wars-inspired battle engine that allows assembly language programs to compete in a virtual memory space. The system simulates a battle between multiple bots, each represented by a small assembly program.

## Components

The battle system consists of several interconnected components:

### 1. BattleSystem

The main integration component that connects all parts of the system. It:
- Loads bot assembly code
- Creates processes for each bot
- Manages memory allocation
- Controls execution flow
- Orchestrates the battle

### 2. BattleController

Controls the high-level battle flow:
- Manages battle state (running, paused, completed)
- Controls turn-by-turn execution
- Determines victory conditions
- Tracks scores and statistics

### 3. ProcessManager

Handles process lifecycle and scheduling:
- Creates processes from bot code
- Schedules processes for execution
- Manages process state (ready, running, terminated)
- Tracks resource usage

### 4. Memory System

Manages the virtual memory space:
- Provides memory allocation
- Ensures memory protection
- Tracks memory access violations
- Supports circular addressing

### 5. CPU Components

Simulation of CPU execution:
- ExecutionUnit: Executes instructions
- InstructionDecoder: Decodes binary instructions

### 6. Parser Components

Handles bot assembly code:
- AssemblyParser: Parses assembly syntax
- CodeGenerator: Generates executable code

## Usage

### Command-Line Interface

Run a battle between two or more bots:

```bash
node dist/battle/BattleRunner.js path/to/bot1.asm path/to/bot2.asm [options]
```

Options:
- `-v, --verbose`: Show detailed battle information
- `--max-turns N`: Set maximum number of turns
- `--max-cycles N`: Set maximum cycles per turn

### Web API Integration

Use the provided API endpoints to create and run battles:

```
POST /api/battles
GET /api/battles/:id
POST /api/battles/:id/start
POST /api/battles/:id/turn
```

## Bot Language

Bots are written in a simple assembly language. Basic example:

```assembly
; Simple bot that halts immediately
start:
halt
```

More complex example:

```assembly
; Bot with a loop
start:
mov r0 0      ; Initialize counter
loop:
inc r0        ; Increment counter
cmp r0 10     ; Compare with limit
jnz loop      ; Jump if not reached limit
halt          ; Stop execution
```

## System Architecture

```
BattleSystem
  |
  ├── BattleController
  |     └── Battle State
  |
  ├── ProcessManager
  |     └── Process Scheduling
  |
  ├── Memory System
  |     └── Memory Management
  |
  ├── CPU Components
  |     ├── ExecutionUnit
  |     └── InstructionDecoder
  |
  └── Parser Components
        ├── AssemblyParser
        └── CodeGenerator
```

## Future Improvements

- Enhanced assembly language support
- More sophisticated instruction execution
- Memory visualization
- Additional battle modes
- Performance optimization
- Tournament support

## License

This project is open source and available under the ISC License.