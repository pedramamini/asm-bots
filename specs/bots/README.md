# Bot Source Files

These are the bot programs that shipped with the prior prototype, copied
verbatim. They are the **conformance suite** for the rebuild — if your
new implementation can parse and run all of them, you're done.

See [`../11-bot-catalog.md`](../11-bot-catalog.md) for descriptions of
each bot's strategy and known issues.

## Files

### Combat bots (the headliners)

- `fortress.asm` — defensive perimeter with traps and patrol
- `hunter.asm` — active scanner with carpet-bombing fallback
- `vampire.asm` — replicator that spreads via SPL

### Visualization showcases

- `RandomWriter1.asm` — chaotic painter, lower memory, red pattern
- `RandomWriter2.asm` — chaotic painter, mid memory, different LCG

### Test bots

- `simplest.asm` — just `halt`
- `test1.asm`, `test2.asm` — minimal halts
- `multi_nop.asm` — five NOPs then halt
- `scanner.asm` — two NOPs then halt
- `simple.asm`, `simple_copy.asm` — register arithmetic
- `simple_test.asm` — infinite loop via jump-to-zero
- `simple_hunter.asm` — increment-forever loop
- `counter.asm` — count to 10 and halt
- `debug.asm` — count to 100 in a loop
- `infinite_loop.asm` — raw absolute jump targets
- `vampire_test.asm` — simplified vampire (no replication)
- `test_jumps.asm` — exercises JMP/CALL/RET
- `test_spl.asm` — exercises SPL
- `test-bot1.asm` — warrior writing 0x1234 in a loop
- `test-bot2.asm` — scanner overwriting non-empty cells with 0x5678

## Running them

In the new implementation, each bot should be loadable via:

```bash
your-cli battle bots/fortress.asm bots/hunter.asm
```

or

```bash
curl -X POST http://localhost:8080/api/bots \
  -H 'content-type: application/json' \
  -d "{\"name\":\"fortress\",\"code\":\"$(cat fortress.asm | jq -Rs .)\"}"
```

(Quoting is platform-specific; the example is illustrative.)
