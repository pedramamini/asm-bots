import { describe, expect, it } from 'bun:test'
import { parseReleases, readReleases, releaseOf } from './changelog'

const CHANGELOG = [
  '# Changelog',
  '',
  'A heading in prose: ## 2026.01.01a · "not one".',
  '',
  '## Unreleased · "stone"',
  '',
  '## 2026.10.10a',
  '',
  '### 2026.10.09a · "a note, not a release"',
  '',
  '## 2026.10.03b · "imp gate" ',
  '',
  '## 2026.10.03a · "imp"',
  '',
  '## Before v3',
  '',
].join('\n')

describe('parseReleases', () => {
  it('reads each release heading in order: its version, or Unreleased, and its name', () => {
    expect(parseReleases(CHANGELOG)).toEqual([
      { version: null, name: 'stone' },
      { version: '2026.10.10a', name: null },
      { version: '2026.10.03b', name: 'imp gate' },
      { version: '2026.10.03a', name: 'imp' },
    ])
  })
})

describe('releaseOf', () => {
  const releases = parseReleases(CHANGELOG)

  it('names a build of a release by that release', () => {
    expect(releaseOf('2026.10.03b', releases)).toEqual({ name: 'imp gate', released: true })
    expect(releaseOf('2026.10.10a', releases)).toEqual({ name: null, released: true })
  })

  it('names any other build by the release in the making', () => {
    expect(releaseOf('2026.10.11a', releases)).toEqual({ name: 'stone', released: false })
    expect(releaseOf('2026.10.11a', releases.slice(1))).toEqual({ name: null, released: false })
    expect(releaseOf('dev', [])).toEqual({ name: null, released: false })
  })
})

describe('CHANGELOG.md', () => {
  it('names every release it lists, newest first, the one in the making (if any) at the top', () => {
    const releases = readReleases()
    expect(releases.length).toBeGreaterThan(0)
    const making = releases.filter((r) => r.version === null)
    expect(making.length).toBeLessThanOrEqual(1)
    if (making.length === 1) expect(releases[0]?.version).toBeNull()
    const cut = releases.map((r) => r.version).filter((v) => v !== null)
    expect(cut).toEqual([...cut].sort().reverse())
    for (const release of releases) expect(release.name).toMatch(/^[a-z0-9][a-z0-9 -]*$/)
  })
})
