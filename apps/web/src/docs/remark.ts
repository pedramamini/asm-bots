/**
 * How the docs' MDX is read: GitHub's Markdown (tables, strikethrough, task lists), and a fenced
 * block's meta kept. `vite.config.ts`, the docs tests, and `scripts/gen-docs-index.ts` all
 * compile with `REMARK_PLUGINS`, so a page reads the same everywhere.
 */
import type { CompileOptions } from '@mdx-js/mdx'
import remarkGfm from 'remark-gfm'

interface MdNode {
  type: string
  meta?: string | null
  data?: { hProperties?: Record<string, unknown> }
  children?: MdNode[]
}

function visit(node: MdNode): void {
  if (node.type === 'code' && typeof node.meta === 'string' && node.meta !== '') {
    node.data = {
      ...node.data,
      hProperties: { ...node.data?.hProperties, 'data-meta': node.meta },
    }
  }
  for (const child of node.children ?? []) visit(child)
}

/**
 * Keeps a fenced block's meta: the `run="vs=imp"` of ```` ```asm run="vs=imp" ````. MDX drops
 * it; this puts it on the `<code>` as `data-meta`, where the docs' `pre` (components.tsx) reads it.
 */
export function remarkCodeMeta() {
  return (tree: MdNode) => visit(tree)
}

export const REMARK_PLUGINS: NonNullable<CompileOptions['remarkPlugins']> = [
  remarkGfm,
  remarkCodeMeta,
]
