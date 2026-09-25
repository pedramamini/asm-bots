/**
 * The goldens in workerd (Miniflare), the Miniflare leg of CI's determinism matrix (PRODUCT_SPEC
 * §11, ISA §5.6): every golden round played here, assembled from the roster's sources, comes to
 * the results `bun run golden` checks in Bun and `apps/web/e2e/goldens.spec.ts` in Chromium. Each
 * leg checks the one committed file, so the three hash sets are the same set.
 */
import { diffGoldens, formatGoldens, parseGoldens, playGoldens } from '@asmbots/bots'
import { describe, expect, it } from 'vitest'
import RESULTS from '../../../packages/bots/goldens/results.json'

describe('the goldens in workerd', () => {
  it('play to packages/bots/goldens/results.json, hash for hash', () => {
    const got = playGoldens()
    expect(diffGoldens(parseGoldens(RESULTS), got)).toEqual([])
    expect(formatGoldens(got)).toBe(formatGoldens(parseGoldens(RESULTS)))
  }, 60_000)
})
