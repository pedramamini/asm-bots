import type { Diag } from '@asmbots/asm'

export interface DiagnosticsProps {
  /** The source the diagnostics point into. */
  source: string
  diagnostics: readonly Diag[]
  /** The most to list; the rest are counted. */
  max?: number | undefined
}

/**
 * Assembler errors as a compiler prints them: `3:9 error` and the message, then the source line
 * with a caret under the columns it names.
 */
export function Diagnostics({ source, diagnostics, max = 8 }: DiagnosticsProps) {
  const lines = source.split(/\r?\n/)
  const shown = diagnostics.slice(0, max)
  return (
    <ol className="flex flex-col gap-2">
      {shown.map((d) => {
        // A tab is one column (Diag.col), so it shows as one space and the caret lines up.
        const line = lines[d.line - 1]?.replace(/\t/g, ' ')
        return (
          <li key={`${d.line}:${d.col}:${d.code}`} className="flex min-w-0 flex-col gap-1">
            <p className="text-data">
              <span className="text-muted">
                {d.line}:{d.col}
              </span>{' '}
              <span className="text-danger">{d.severity}</span> {d.message}
            </p>
            {line !== undefined && line.trim() !== '' && (
              <pre
                // biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll box the keyboard reads.
                tabIndex={0}
                className="overflow-x-auto rounded-sm border border-border bg-panel-2 px-2 py-1 text-data text-muted focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-accent"
              >
                {line}
                {'\n'}
                <span className="text-danger">
                  {' '.repeat(Math.max(0, d.col - 1))}
                  {'^'.repeat(Math.max(1, d.len))}
                </span>
              </pre>
            )}
          </li>
        )
      })}
      {diagnostics.length > shown.length && (
        <li className="text-data text-muted">and {diagnostics.length - shown.length} more</li>
      )}
    </ol>
  )
}
