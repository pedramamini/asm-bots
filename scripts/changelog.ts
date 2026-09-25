/**
 * The releases of `CHANGELOG.md`, where release names live: each `##` heading that names one,
 * `## 2026.10.03a · "imp gate"`, and `## Unreleased · "imp gate"` for the release in the making.
 * The web build stamps its version with its release (`apps/web/vite.config.ts`: the status bar's
 * version chip), and `/docs/changelog` renders the file.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** The repository's changelog. */
export const CHANGELOG = fileURLToPath(new URL('../CHANGELOG.md', import.meta.url))

/** A release heading of the changelog. */
export interface Release {
  /** `2026.10.03a`; null for `Unreleased`, the release in the making. */
  readonly version: string | null
  /** `imp gate`; null when it has none yet. */
  readonly name: string | null
}

/** What a build is, as its version chip says: its release's name, and whether it is that release. */
export interface BuildRelease {
  readonly name: string | null
  /** False for a build ahead of every release named in the changelog: `Unreleased`'s. */
  readonly released: boolean
}

const HEADING = /^## (\d{4}\.\d{2}\.\d{2}[a-z]|Unreleased)(?: · "([^"\n]+)")?[ \t]*$/gm

/** The release headings of `markdown`, in the file's order (newest first); other headings are not. */
export function parseReleases(markdown: string): Release[] {
  return [...markdown.matchAll(HEADING)].map(([, version, name]) => ({
    version: version === 'Unreleased' ? null : (version as string),
    name: name ?? null,
  }))
}

/**
 * The release of a build of `version`: the release of that version, else the one in the making
 * (`Unreleased`, unnamed when the changelog has no such heading).
 */
export function releaseOf(version: string, releases: readonly Release[]): BuildRelease {
  const release = releases.find((r) => r.version === version)
  if (release !== undefined) return { name: release.name, released: true }
  return { name: releases.find((r) => r.version === null)?.name ?? null, released: false }
}

/** The changelog's releases, read from the file. */
export function readReleases(file = CHANGELOG): Release[] {
  return parseReleases(readFileSync(file, 'utf8'))
}
