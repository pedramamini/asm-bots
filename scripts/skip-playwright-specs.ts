/**
 * Test preload (bunfig.toml). `bun test` takes `*.spec.ts` files for its own, but the specs in an
 * `e2e/` folder are Playwright's: they import `@playwright/test` and run only in its runner. The
 * tests in `apps/api/test/` are Vitest's, inside workerd (`cloudflare:test`): `bun run test:api`
 * runs them. Bun loads each of these files as one skipped test instead, named after the file, so
 * the run stays green and still says where they are.
 */
import { plugin } from 'bun'

const FOREIGN = [
  { runner: 'playwright', filter: /[\\/]e2e[\\/].+\.spec\.[cm]?[jt]sx?$/ },
  { runner: 'vitest (workerd)', filter: /[\\/]apps[\\/]api[\\/]test[\\/].+\.test\.[cm]?[jt]sx?$/ },
]

plugin({
  name: 'skip foreign tests',
  setup(build) {
    for (const { runner, filter } of FOREIGN) {
      build.onLoad({ filter }, ({ path }) => {
        const name = `${runner}: ${path.split(/[\\/]/).pop()}`
        return {
          loader: 'ts',
          contents: `import { test } from 'bun:test'\ntest.skip(${JSON.stringify(name)}, () => {})\n`,
        }
      })
    }
  },
})
