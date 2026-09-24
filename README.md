# ASM Bots v3

ASM Bots is a deterministic x86-16 assembler debugger and competitive hill-climbing arena, implemented as a pure TypeScript monorepo that runs identically in Bun, the browser, Web Workers, and Cloudflare Workers. The engine powers interactive learning, live debugging, and a serverless tournament system where bots compete in real-time battles.

## Quick Start

```sh
bun install
bun run check       # typecheck, lint, contrast, test
bun run contrast    # WCAG contrast of the text tokens in all five themes
bun run golden      # the roster goldens; --update writes packages/bots/goldens/results.json
bun run opcodes     # writes docs/opcodes.json (the editor's cards) and the docs' language reference
bun run docs-index  # writes the /docs search index from the MDX pages
bun run dev         # the web app on :5173 with /api proxied to wrangler dev on :8787
bun run build       # web app, then the Worker bundle
```

The Worker (API, D1, R2, KV, local migrations and seed): [apps/api/README.md](./apps/api/README.md).

## Optional Dependencies

- **nasm** — The Netwide Assembler is used for codec cross-checks. Install with `brew install nasm`. Tests gracefully skip nasm-dependent checks if not available.

## Branch Protection

The `main` branch requires that the `CI` workflow passes before merging. Configure this in GitHub repository settings:

- Require status checks to pass before merging
- Require the `check` job from the `CI` workflow to succeed
- Dismiss stale pull request approvals when new commits are pushed

## Documentation

- [Architecture](./docs/ARCHITECTURE.md) — Repository layout, engine design, test strategy
- [ISA Specification](./docs/ISA_SPEC.md) — x86-16 instruction set and execution model
- [Product Spec](./docs/PRODUCT_SPEC.md) — Features and user flows
- [Design System](./docs/DESIGN_SYSTEM.md) — UI patterns and component library
- [UI kit](./packages/ui/README.md): tokens, themes, the 32 primitives, and the `/_gallery` review page
- [Research Brief](./docs/RESEARCH_BRIEF.md) — Background and prior art
