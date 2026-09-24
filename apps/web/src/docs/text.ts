/**
 * The text of a docs heading, and its anchor. `scripts/gen-docs-index.ts` names each section of
 * the search index with `headingId` of the heading's Markdown text; the MDX headings take the same
 * id from their rendered text, so a search hit and the page's contents land on the heading.
 */
import { isValidElement, type ReactNode } from 'react'

/** A heading's anchor: `Why spl before rep movsw?` is `why-spl-before-rep-movsw`. */
export function headingId(text: string): string {
  const id = text
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
  return id === '' ? 'section' : id
}

/** The text a React node shows: its strings and numbers, through elements' children. */
export function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children)
  return ''
}
