import { cx } from '@asmbots/ui'
import { Link } from '@tanstack/react-router'
import type { MDXComponents } from 'mdx/types'
import type { ComponentProps } from 'react'

/** Keyboard focus on a link: the kit's 1 px accent outline. */
const FOCUS = 'focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent'

const LINK = cx('text-accent underline-offset-2 hover:underline', FOCUS)

/** A docs link: an app path goes through the router (no reload); anything else leaves the app. */
function DocLink({ href = '', children }: ComponentProps<'a'>) {
  if (href.startsWith('/')) {
    return (
      <Link to={href} className={LINK}>
        {children}
      </Link>
    )
  }
  return (
    <a href={href} target="_blank" rel="noreferrer" className={LINK}>
      {children}
    </a>
  )
}

/**
 * How a docs page draws its Markdown, in the kit's type (DESIGN_SYSTEM §3): body text at 13 px,
 * headings as panel titles, code in `--panel-2`. EXEC 2.6 adds `copy` and `open in editor` to
 * each code block.
 */
export const MDX_COMPONENTS: MDXComponents = {
  h1: (props) => <h1 {...props} className="mb-4 text-modal-title text-bright" />,
  h2: (props) => (
    <h2 {...props} className="mt-6 mb-2 border-b border-border pb-1 text-panel-title text-accent" />
  ),
  h3: (props) => <h3 {...props} className="mt-4 mb-2 text-nav text-text" />,
  p: (props) => <p {...props} className="my-3 text-body text-text" />,
  a: DocLink,
  ul: (props) => <ul {...props} className="my-3 list-disc pl-5 text-body marker:text-dim" />,
  ol: (props) => <ol {...props} className="my-3 list-decimal pl-6 text-body marker:text-dim" />,
  li: (props) => <li {...props} className="my-1" />,
  strong: (props) => <strong {...props} className="font-semibold text-bright" />,
  blockquote: (props) => (
    <blockquote {...props} className="my-3 border-l-2 border-accent-45 pl-3 text-muted" />
  ),
  pre: (props) => (
    <pre
      {...props}
      className="my-3 overflow-x-auto rounded-sm border border-border bg-panel-2 p-3 text-code text-text [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-text"
    />
  ),
  code: (props) => <code {...props} className="rounded-sm bg-panel-2 px-1 text-code text-bright" />,
  hr: (props) => <hr {...props} className="my-6 border-border" />,
}
