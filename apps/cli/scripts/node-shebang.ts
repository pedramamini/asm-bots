/**
 * Makes the bundled CLI (`bun run bundle`) start with `#!/usr/bin/env node`, in place of the
 * `#!/usr/bin/env bun` that `bun build` keeps from `src/main.ts`, and marks it executable, so
 * `./asmbots.js` runs under plain Node.
 */
import { chmodSync, readFileSync, writeFileSync } from 'node:fs'

const file = process.argv[2]
if (file === undefined) throw new Error('usage: bun scripts/node-shebang.ts <file.js>')
const text = readFileSync(file, 'utf8').replace(/^#!.*\n/, '')
writeFileSync(file, `#!/usr/bin/env node\n${text}`)
chmodSync(file, 0o755)
