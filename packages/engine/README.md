# @asmbots/engine

The deterministic x16c v1 arena VM: the 64 KB core and its owner map, processes and their queues, the CPU, battles, events, snapshots, and hashes. The contract is [ISA_SPEC](../../docs/ISA_SPEC.md) §1, §4, and §5. The only dependency is `@asmbots/codec`. The engine runs unchanged in Bun, browsers, Web Workers, and Cloudflare Workers: no Node APIs, no clock, no `Math.random`.

## API

| Export | Does |
|---|---|
| `new Battle(bots, config?, events?)` | Places and loads the bots (ISA §5.5). `step()` runs one cycle, `run(n?)` runs up to `n` cycles, and `result()` gives the survivors, the pMARS points, and each bot's stats. |
| `simulate(bots, config?)` | A whole battle as a pure function (ISA §5.6). |
| `snapshot(battle)`, `restore(s, bots, config?, events?)` | A battle's state between cycles, safe for `structuredClone`, and a battle rebuilt from it. |
| `resultHash(result)`, `HashSink`, `eventHash(sink)`, `fnv1a64(bytes)` | FNV-1a 64 hashes for the determinism goldens. |
| `NullSink`, `RingSink` | Event sinks: one that keeps nothing, and typed-array rings that the arena Worker drains. |
| `Core`, `ProcQueue`, `Pcg32` | The core and its owner map, a bot's process queue, and the placement PRNG. |
| `Fetcher`, `run`, `execOne` | The fetch and execute stages, for tests and tools. |
| `flagsAdd` … `flagsRcr` | The flag arithmetic of ISA §4. |

## How an instruction runs

The codec decodes an instruction into objects. The engine compiles each decoded instruction once, into 8 int32 fields: its handler, its length, its data size, its REP prefix, and each operand as a kind and a value. A register is a register number, and a memory operand is its base and index registers plus the displacement. `Fetcher.compiled(addr)` keeps one compiled instruction per address in `Fetcher.code`, 2 MB per battle. On every fetch it compares the instruction's bytes with the core, so the next fetch sees any change to them: a bot's store, a debugger's poke, or a direct store to `core.bytes`. A decoded instruction depends only on its own bytes, because a relative target counts from the instruction, so the same bytes always compile to the same thing. Undefined bytes are never kept, since only the decoder knows how many bytes it read. `run` calls the handler for the compiled op, and `execOne` compiles a decoded `Instr` and runs it the same way. `Battle.step` runs each turn inline.

## Tests and benchmark

| Command | Runs |
|---|---|
| `bun test` | Every instruction family, the process queue, placement, the battle loop against a plain model of ISA §5.2, snapshots, and the determinism goldens (also in a Worker). `test/compiled.test.ts` checks the cache: a change to any byte of an instruction, at every place across the wrap, and 50,000 random steps against `execOne` while random stores rewrite the code. |
| `bun run bench` | `bench/ips.ts`: the bench battle of `bench/workload.ts` for 2,000,000 cycles with a `NullSink`. It runs once to warm up, then prints instructions and cycles per second for five runs and their median. |
| `CI=true bun test` | Also times the bench battle in a Worker and fails under 15 M instructions/s, the CI floor of ARCHITECTURE §9. GitHub Actions sets `CI=true`. |

The bench battle is eight bots that never die, so each cycle runs 8 instructions: a `rep stosw` painter, an `inc bx` / `jmp` spinner, a replicator whose processes each start a child and then die (about 12 processes, one spawn and one death every 11 cycles), a scanner (`add` / `cmp word [di], 0` / `jz`), and four `movsb` / `jmp` imps. `test/ips.test.ts` checks that mix.

## Speed

On 2026-09-23 (Apple M5 Max, Bun 1.3.6), `bun run bench` measured **55 M instructions/s** (6.9 M cycles/s), the median of five runs, against a target of 25 M. In a Worker, the CI floor test measured 56 M.

| Version | M instructions/s |
|---|---|
| A decode for every instruction, the handler looked up by mnemonic | 37 |
| The compiled-instruction cache | 51 |
| The turn inline in `Battle.step`, with the fields it reads in locals | 55 |

These gave nothing, or 5% at most, and were left out: a `switch` in place of the handler array, `jmp`, `loop`, and `jz` run inline in `run`, flag arithmetic without branches, a fixed 16-bit path for ADD and SUB, a shorter byte check for short instructions, and a cheaper write hook. A `nop` costs about 10 ns in the battle and `add ax, bx` about 19 ns. The time is spread over the turn: the byte check, a call through the handler array that JSC cannot inline, the queue rotation, and the write hook.

The floor has less room than the target does. A GitHub runner core is probably 2 to 3 times slower than an M5 Max core, which puts CI at about 18 to 28 M. In the test process, after the other tests have trained the JIT on their own code, the bench runs about 15% slower, so the floor test times the battle in a Worker.
