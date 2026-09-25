/** The pieces an intro's dialog is made of: numbered steps, and terms with what they mean. */
import type { ReactNode } from 'react'

const STEPS = 'flex list-decimal flex-col gap-1 pl-7 marker:text-muted'
const TERMS = 'grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1'

export function Steps({ children }: { children: ReactNode }) {
  return <ol className={STEPS}>{children}</ol>
}

/** A term and what it means, in a two-column list. */
export function Terms({
  items,
}: {
  items: readonly (readonly [term: string, meaning: ReactNode])[]
}) {
  return (
    <dl className={TERMS}>
      {items.map(([term, meaning]) => (
        <div key={term} className="contents">
          <dt className="text-bright">{term}</dt>
          <dd className="text-muted">{meaning}</dd>
        </div>
      ))}
    </dl>
  )
}
