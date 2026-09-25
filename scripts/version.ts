import { execSync } from 'node:child_process'

/** A release tag: its version, `YYYY.MM.DD` and a letter, with or without a leading `v`. */
const RELEASE_TAG = /^v?(\d{4}\.\d{2}\.\d{2}[a-z])$/

/**
 * The version of a build of a commit made on `day` (`YYYY-MM-DD`): the release the commit is
 * tagged as, when `headTags` has one (`v2026.10.03a` is `2026.10.03a`); else the commit's day and
 * the letter after the last release of that day among `tags` (`a` for the day's first).
 */
export function versionOf(
  day: string,
  tags: readonly string[],
  headTags: readonly string[],
): string {
  const own = headTags
    .map((tag) => RELEASE_TAG.exec(tag.trim())?.[1])
    .filter((version) => version !== undefined)
    .sort()
  if (own.length > 0) return own[own.length - 1] as string
  const base = day.replaceAll('-', '.')
  const letters = tags
    .map((tag) => RELEASE_TAG.exec(tag.trim())?.[1])
    .filter((version) => version?.slice(0, -1) === base)
    .map((version) => (version as string).slice(-1))
    .sort()
  const last = letters[letters.length - 1]
  return `${base}${last === undefined ? 'a' : String.fromCharCode(last.charCodeAt(0) + 1)}`
}

const lines = (command: string) =>
  execSync(command, { encoding: 'utf-8' })
    .split('\n')
    .filter((line) => line.trim() !== '')

export function getVersion(): string {
  try {
    // The latest commit's date: YYYY-MM-DD.
    const day = execSync('git log -1 --format=%ci', { encoding: 'utf-8' }).trim().split(' ')[0]
    if (!day) {
      throw new Error('Could not get commit date')
    }
    return versionOf(day, lines('git tag -l'), lines('git tag --points-at HEAD'))
  } catch {
    // Fallback for repos without git history
    const today = new Date()
    const year = today.getFullYear()
    const month = String(today.getMonth() + 1).padStart(2, '0')
    const date = String(today.getDate()).padStart(2, '0')
    return `${year}.${month}.${date}a`
  }
}

// Print version if run directly via `bun run version`
if (process.argv[1]?.endsWith('version.ts')) {
  console.log(getVersion())
}
