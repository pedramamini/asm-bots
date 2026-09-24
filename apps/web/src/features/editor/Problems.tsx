import { cx, Panel } from '@asmbots/ui'
import type { AsmResult } from './asm/protocol'
import type { Problem } from './cm/diagnostics'

export interface ProblemsProps {
  /** The editor's findings, where it has them now. */
  problems: readonly Problem[]
  /** The latest assemble, or null before the first. */
  result: AsmResult | null
  /** The source changed since `result`: a new assemble is on its way. */
  pending: boolean
  /** A click on a finding: put the cursor there. */
  onJump: (problem: Problem) => void
  className?: string | undefined
}

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

/**
 * The problems panel under the editor (PRODUCT_SPEC §3): the errors and the lint warnings, each
 * with its line and column, its message, and its code; the fix, where there is one, in its
 * tooltip. A click puts the cursor on the finding. With none, it says how the assemble went.
 */
export function Problems({ problems, result, pending, onJump, className }: ProblemsProps) {
  const errors = problems.filter((p) => p.severity === 'error').length
  const warnings = problems.length - errors
  const status =
    result === null
      ? 'assembling'
      : problems.length === 0
        ? `ok · ${result.ms < 1 ? '<1' : Math.round(result.ms)} ms`
        : [errors > 0 && count(errors, 'error'), warnings > 0 && count(warnings, 'warning')]
            .filter(Boolean)
            .join(' · ')
  return (
    <Panel
      dense
      title="problems"
      status={status}
      aria-busy={pending || undefined}
      className={cx('max-h-44 shrink-0', className)}
    >
      {problems.length === 0 ? (
        <p className="text-data text-muted">
          {result === null ? 'assembling…' : 'no problems: the bot assembles clean.'}
        </p>
      ) : (
        <ol aria-label="problems" className="-mx-2 -mb-1 max-h-32 overflow-y-auto">
          {problems.map((problem) => (
            <li key={`${problem.from}:${problem.code}:${problem.message}`}>
              <button
                type="button"
                title={problem.fix}
                onClick={() => onJump(problem)}
                className="flex w-full min-w-0 items-baseline gap-3 px-2 py-0.5 text-left text-data transition-colors duration-120 ease-out hover:bg-panel-2 focus-visible:bg-panel-2 focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-accent"
              >
                <span
                  className={cx(
                    'w-14 shrink-0',
                    problem.severity === 'error' ? 'text-danger' : 'text-warn',
                  )}
                >
                  {problem.severity === 'error' ? 'error' : 'warning'}
                </span>
                <span className="w-12 shrink-0 text-muted tabular-nums">
                  {problem.line}:{problem.col}
                </span>
                <span className="min-w-0 flex-1 truncate text-text">{problem.message}</span>
                <span className="shrink-0 text-muted">{problem.code}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  )
}
