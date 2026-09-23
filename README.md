# ASM Bots v3

ASM Bots is a deterministic x86-16 assembler debugger and competitive hill-climbing arena, implemented as a pure TypeScript monorepo that runs identically in Bun, the browser, Web Workers, and Cloudflare Workers. The engine powers interactive learning, live debugging, and a serverless tournament system where bots compete in real-time battles.

## Quick Start

```sh
bun install
bun run check       # typecheck, lint, contrast, test
bun run contrast    # WCAG contrast of the text tokens in all five themes
bun run golden      # the roster goldens; --update writes packages/bots/goldens/results.json
```

## Optional Dependencies

- **nasm** — The Netwide Assembler is used for codec cross-checks. Install with `brew install nasm`. Tests gracefully skip nasm-dependent checks if not available.

## Documentation

- [Architecture](./docs/ARCHITECTURE.md) — Repository layout, engine design, test strategy
- [ISA Specification](./docs/ISA_SPEC.md) — x86-16 instruction set and execution model
- [Product Spec](./docs/PRODUCT_SPEC.md) — Features and user flows
- [Design System](./docs/DESIGN_SYSTEM.md) — UI patterns and component library
- [Research Brief](./docs/RESEARCH_BRIEF.md) — Background and prior art
