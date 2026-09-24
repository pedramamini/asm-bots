import type { D1Migration } from 'cloudflare:test'

declare global {
  namespace Cloudflare {
    interface GlobalProps {
      /** Types `exports.default` from `cloudflare:workers`. */
      mainModule: typeof import('../src/index')
    }
    interface Env {
      /** `vitest.config.ts` reads them from `src/db/migrations`. */
      TEST_MIGRATIONS: D1Migration[]
    }
  }
}
