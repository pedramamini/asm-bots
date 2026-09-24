import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

/**
 * The API's tests run inside workerd with the bindings from `wrangler.jsonc`, each test file on
 * fresh local D1, R2, and KV. Static assets come from a fixture, so the tests need no web build.
 */
export default defineConfig(async () => {
  const migrations = await readD1Migrations('src/db/migrations')
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            GITHUB_CLIENT_ID: 'test-client-id',
            GITHUB_CLIENT_SECRET: 'test-client-secret',
            SESSION_SECRET: 'test-session-secret',
          },
          assets: {
            directory: 'test/fixtures/site',
            binding: 'ASSETS',
            assetConfig: { not_found_handling: 'single-page-application' },
          },
        },
      }),
    ],
    test: {
      include: ['test/**/*.test.ts'],
      setupFiles: ['test/apply-migrations.ts'],
    },
  }
})
