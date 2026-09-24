import { IconButton, Panel, useToast } from '@asmbots/ui'
import { Copy } from 'lucide-react'
import { useLayoutEffect, useRef } from 'react'
import type { DebugSession, DebugState } from './session'
import { TRACE_DEPTH, TRACE_HEADER, type TraceEntry, traceLine, traceText } from './trace'

export interface TracePanelProps {
  state: DebugState | null
  session: DebugSession | null
  className?: string | undefined
}

/** Texts by address and bytes: a trace repeats its loops, so most lines are known already. */
const texts = new Map<string, string>()
const MAX_TEXTS = 4096

function lineOf(entry: TraceEntry): string {
  const key = `${entry.addr}:${entry.bytes.join(',')}`
  let text = texts.get(key)
  if (text === undefined) {
    if (texts.size >= MAX_TEXTS) texts.clear()
    text = traceText(entry)
    texts.set(key, text)
  }
  return traceLine(entry, text)
}

/**
 * The Trace panel (PRODUCT_SPEC §3): the last `TRACE_DEPTH` instructions of the followed process,
 * oldest first, in the CLI's trace format (`asmbots fight --trace`): each with the registers and
 * flags it found. It keeps to the newest line unless scrolled up; `copy` takes the lines as text.
 */
export function TracePanel({ state, session, className }: TracePanelProps) {
  const { toast } = useToast()
  const box = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const entries = state === null || session === null ? [] : session.trace(state.selectedProc)
  const lines = entries.map(lineOf)

  // To the newest line after each change, while the reader is at the bottom.
  useLayoutEffect(() => {
    const node = box.current
    if (node !== null && pinned.current) node.scrollTop = node.scrollHeight
  })

  const copy = () => {
    const text = [TRACE_HEADER, ...lines].join('\n')
    void navigator.clipboard?.writeText(`${text}\n`).then(
      () => toast(`copied ${lines.length} ${lines.length === 1 ? 'line' : 'lines'} of trace.`),
      () => toast('could not copy the trace.', { variant: 'danger' }),
    )
  }

  return (
    <Panel
      dense
      title="trace"
      status={state === null ? undefined : `${entries.length} / ${TRACE_DEPTH}`}
      actions={
        <IconButton
          icon={Copy}
          size="sm"
          label="copy the trace"
          disabled={lines.length === 0}
          onClick={copy}
        />
      }
      className={className}
    >
      {lines.length === 0 ? (
        <p className="text-data text-muted">
          {state === null
            ? 'load a bot to trace it.'
            : 'the followed process has run nothing yet: step or run.'}
        </p>
      ) : (
        <div
          ref={box}
          role="log"
          aria-label="trace"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll box the keyboard reads.
          tabIndex={0}
          onScroll={(event) => {
            const node = event.currentTarget
            pinned.current = node.scrollTop + node.clientHeight >= node.scrollHeight - 4
          }}
          className="-mx-2 max-h-48 overflow-auto px-2 focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-accent"
        >
          <pre className="w-max text-data text-muted">{TRACE_HEADER}</pre>
          {lines.map((line, i) => (
            <pre
              // A trace line is its cycle and process: unique in one trace.
              key={`${entries[i]?.cycle}:${entries[i]?.addr}`}
              className={
                i === lines.length - 1 ? 'w-max text-data text-bright' : 'w-max text-data text-text'
              }
            >
              {line}
            </pre>
          ))}
        </div>
      )}
    </Panel>
  )
}
