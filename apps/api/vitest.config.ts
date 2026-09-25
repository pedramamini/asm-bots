import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'
import { textImport } from '../../scripts/text-import'

/**
 * The API's tests run inside workerd with the bindings from `wrangler.jsonc`, each test file on
 * fresh local D1, R2, and KV. Static assets come from a fixture, so the tests need no web build.
 */
export default defineConfig(async () => {
  const migrations = await readD1Migrations('src/db/migrations')
  return {
    plugins: [
      // The roster's `.asm` sources, for the goldens (`test/goldens.test.ts`).
      textImport(),
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        // Never a remote binding: a binding marked `remote` would run the tests on production data.
        remoteBindings: false,
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            GITHUB_CLIENT_ID: 'test-client-id',
            GITHUB_CLIENT_SECRET: 'test-client-secret',
            SESSION_SECRET: 'test-session-secret',
            // No Runner alarm fires on its own: the tests step them (`runDurableObjectAlarm`).
            RUNNER_ALARM_DELAY_MS: String(60 * 60 * 1000),
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
