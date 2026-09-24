/** The docs' small blocks: `Keys`, the `Note` and `Warn` callouts, and `Fig`. */
import { cx, Kbd } from '@asmbots/ui'
import { Fragment, type ReactNode } from 'react'
import { FIGURES } from './figures'
import { textOf } from './text'

/**
 * Keys as the key help draws them: `<Keys>g a</Keys>` is a chord (one key, then the other),
 * `<Keys>ctrl+enter</Keys>` a combination (held together).
 */
export function Keys({ children }: { children?: ReactNode }) {
  const sequence = textOf(children).trim().split(/\s+/).filter(Boolean)
  return (
    <span className="inline-flex items-center gap-1 align-text-bottom">
      {sequence.map((combo, at) => (
        <Fragment key={at}>
          {combo.split(/\+(?=.)/).map((key, k) => (
            <Fragment key={k}>
              {k > 0 && <span className="text-dim">+</span>}
              <Kbd>{key}</Kbd>
            </Fragment>
          ))}
        </Fragment>
      ))}
    </span>
  )
}

const CALLOUT = {
  note: { label: 'NOTE', rule: 'border-accent-45', text: 'text-accent' },
  warn: { label: 'WARN', rule: 'border-warn', text: 'text-warn' },
} as const

function Callout({ kind, children }: { kind: keyof typeof CALLOUT; children?: ReactNode }) {
  const { label, rule, text } = CALLOUT[kind]
  return (
    <aside
      aria-label={kind === 'note' ? 'note' : 'warning'}
      className={cx('my-3 border-l-2 bg-panel-2 px-3 py-2 [&_p]:my-1', rule)}
    >
      <p className={cx('text-panel-status', text)}>{label}</p>
      {children}
    </aside>
  )
}

/** A side remark: worth knowing, safe to skip. */
export function Note({ children }: { children?: ReactNode }) {
  return <Callout kind="note">{children}</Callout>
}

/** A trap: what kills a bot, or reads one way and runs another. */
export function Warn({ children }: { children?: ReactNode }) {
  return <Callout kind="warn">{children}</Callout>
}

/**
 * A figure of `src/docs/figures/`: `<Fig src="modrm" alt="…">caption</Fig>`. The SVG is drawn
 * inline, so its `var(--accent)` colors follow the theme.
 */
export function Fig({ src, alt, children }: { src: string; alt: string; children?: ReactNode }) {
  const svg = FIGURES[src]
  if (svg === undefined) {
    throw new Error(
      `no figure "${src}" in src/docs/figures: try ${Object.keys(FIGURES).join(', ')}`,
    )
  }
  return (
    <figure className="my-4">
      <div
        role="img"
        aria-label={alt}
        className="overflow-x-auto [&>svg]:h-auto [&>svg]:max-w-full"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      {children !== undefined && (
        <figcaption className="mt-1 text-data text-muted">{children}</figcaption>
      )}
    </figure>
  )
}
