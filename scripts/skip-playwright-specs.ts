/**
 * Test preload (bunfig.toml). `bun test` takes `*.spec.ts` files for its own, but the specs in an
 * `e2e/` folder are Playwright's: they import `@playwright/test` and run only in its runner. Bun
 * loads each of them as one skipped test instead, named after the file, so the run stays green and
 * still says where they are.
 */
import { plugin } from 'bun'

plugin({
  name: 'skip playwright specs',
  setup(build) {
    build.onLoad({ filter: /[\\/]e2e[\\/].+\.spec\.[cm]?[jt]sx?$/ }, ({ path }) => {
      const name = `playwright: ${path.split(/[\\/]/).pop()}`
      return {
        loader: 'ts',
        contents: `import { test } from 'bun:test'\ntest.skip(${JSON.stringify(name)}, () => {})\n`,
      }
    })
  },
})
