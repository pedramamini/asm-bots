import { describe, expect, it } from 'bun:test'
import { versionOf } from './version'

describe('versionOf', () => {
  it("is the commit's day and a, for the day's first release", () => {
    expect(versionOf('2026-10-03', [], [])).toBe('2026.10.03a')
    expect(versionOf('2026-10-03', ['v2026.10.02a', 'v0.0.0-foundation'], [])).toBe('2026.10.03a')
  })

  it("takes the letter after the day's last release, tagged with a v or without", () => {
    expect(versionOf('2026-10-03', ['v2026.10.03a'], [])).toBe('2026.10.03b')
    expect(versionOf('2026-10-03', ['2026.10.03a', 'v2026.10.03b', 'v2026.10.04a'], [])).toBe(
      '2026.10.03c',
    )
  })

  it('is the release a commit is tagged as', () => {
    expect(versionOf('2026-10-03', ['v2026.10.03a'], ['v2026.10.03a'])).toBe('2026.10.03a')
    expect(versionOf('2026-10-05', ['2026.10.03b'], ['latest', '2026.10.03b'])).toBe('2026.10.03b')
  })

  it('reads no other tag as a release', () => {
    expect(versionOf('2026-10-03', ['v2026.10.03', 'x2026.10.03a'], ['v1.0.0'])).toBe('2026.10.03a')
  })
})
