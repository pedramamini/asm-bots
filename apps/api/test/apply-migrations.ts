import { applyD1Migrations } from 'cloudflare:test'
import { env } from 'cloudflare:workers'

// Runs before each test file, on its own D1; applying is idempotent.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
