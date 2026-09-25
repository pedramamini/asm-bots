/**
 * The build's version stamp and its release (`scripts/version.ts`, and the release names of
 * CHANGELOG.md, `scripts/changelog.ts`): what the status bar's version chip says, and its tooltip.
 */

/** A build's release: its name in the changelog, and whether the build is that release. */
export interface AppRelease {
  readonly name: string | null
  /** False for a build ahead of every release: it has the name of the release in the making. */
  readonly released: boolean
}

/** The build's version, `2026.10.03a`; `dev` where Vite did not define it (the unit tests). */
export const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'

/** The build's release; null where Vite did not define it. */
export const RELEASE: AppRelease | null =
  typeof __APP_RELEASE__ === 'object' ? __APP_RELEASE__ : null

/**
 * The version with its release: `2026.10.03a · "imp gate"`, and for a build ahead of the latest
 * release, `2026.09.25a · "imp gate" · unreleased`.
 */
export function versionTitle(version: string, release: AppRelease | null): string {
  const parts = [version]
  if (release?.name) parts.push(`"${release.name}"`)
  if (release?.released === false) parts.push('unreleased')
  return parts.join(' · ')
}
