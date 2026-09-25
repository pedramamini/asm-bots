/**
 * The files the build writes for AI agents (`scripts/agent-docs.ts`): the docs as Markdown, the
 * `llms.txt` index, and the downloadable skill. They are static files, not app routes, so a docs
 * link to one leaves the router (`components.tsx`), and `scripts/check-docs-links.ts` accepts them.
 */

/** The index of the docs for agents (https://llmstxt.org). */
export const LLMS_TXT = '/llms.txt'

/** Every docs page as Markdown, in reading order, in one file. */
export const LLMS_FULL_TXT = '/llms-full.txt'

/** The skill's instructions, readable on their own. */
export const SKILL_MD = '/skill/SKILL.md'

/** The whole skill as a zip: `asm-bots/` with SKILL.md, references, examples, and the CLI. */
export const SKILL_ZIP = '/skill/asm-bots.zip'

/** The fixed files, in the order the docs list them. */
export const AGENT_FILES: readonly string[] = [LLMS_TXT, LLMS_FULL_TXT, SKILL_MD, SKILL_ZIP]

/** The Markdown file of the docs page at `slug`: `strategy/imps` is `/docs/strategy/imps.md`. */
export function docMarkdownPath(slug: string): string {
  return `/docs/${slug}.md`
}

/**
 * The docs slug of a page's Markdown file, `/docs/strategy/imps.md` → `strategy/imps`, or null for
 * any other path.
 */
export function markdownSlug(path: string): string | null {
  const match = /^\/docs\/(.+)\.md$/.exec(path)
  return match === null ? null : (match[1] as string)
}

/** True for a path the build writes for agents: a fixed file, or a page's `.md`. */
export function isAgentFile(path: string): boolean {
  return AGENT_FILES.includes(path) || markdownSlug(path) !== null
}
