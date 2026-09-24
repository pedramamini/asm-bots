import { Button, cx, Modal } from '@asmbots/ui'
import { RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { type BotVersion, useBotVersions } from '../../store/bot-versions'
import { type DiffOp, diffSequences } from './diff'

export interface VersionsModalProps {
  open: boolean
  /** The local bot whose saves to list; null for a bot never saved. */
  botId: string | null
  /** The editor's text now, which each save is compared with. */
  current: string
  onClose: () => void
  /** Puts a save's text in the editor. */
  onRestore: (version: BotVersion) => void
}

/** Unchanged lines shown on each side of a change; a longer run of them folds. */
export const DIFF_CONTEXT = 3

/** A row of the diff view: a line, or a fold of unchanged lines. */
export type DiffRow = DiffOp | { readonly op: 'fold'; readonly lines: number }

/** The diff of `before` and `after` by line, runs of unchanged lines folded past the context. */
export function diffRows(before: string, after: string, context = DIFF_CONTEXT): DiffRow[] {
  const ops = diffSequences(before.split('\n'), after.split('\n'))
  // No change: the save is the editor's text, shown whole.
  if (ops.every((op) => op.op === '=')) return ops
  const rows: DiffRow[] = []
  for (let i = 0; i < ops.length; ) {
    if ((ops[i] as DiffOp).op !== '=') {
      rows.push(ops[i++] as DiffOp)
      continue
    }
    let end = i
    while (end < ops.length && (ops[end] as DiffOp).op === '=') end++
    const keepStart = i === 0 ? 0 : context
    const keepEnd = end === ops.length ? 0 : context
    if (end - i > keepStart + keepEnd + 1) {
      rows.push(...ops.slice(i, i + keepStart))
      rows.push({ op: 'fold', lines: end - i - keepStart - keepEnd })
      rows.push(...ops.slice(end - keepEnd, end))
    } else {
      rows.push(...ops.slice(i, end))
    }
    i = end
  }
  return rows
}

const WHEN = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

/**
 * `versions` (PRODUCT_SPEC §3): the bot's last saves, newest first, and the line diff of the one
 * picked against the editor's text (`-` the save has, `+` the editor has). `restore` puts the
 * save's text back in the editor, as an edit that undo takes back.
 */
export function VersionsModal({ open, botId, current, onClose, onRestore }: VersionsModalProps) {
  const versions = useBotVersions(open ? botId : null)
  const [picked, setPicked] = useState(0)
  // Each opening starts on the newest save.
  useEffect(() => {
    if (open) setPicked(0)
  }, [open])
  const list = versions.data ?? []
  const version = list[Math.min(picked, list.length - 1)]
  const rows = version === undefined ? [] : diffRows(version.source, current)
  const added = rows.filter((row) => row.op === '+').length
  const removed = rows.filter((row) => row.op === '-').length
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="versions"
      size="lg"
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            close
          </Button>
          <Button
            variant="primary"
            icon={RotateCcw}
            disabled={version === undefined || version.source === current}
            onClick={() => {
              if (version === undefined) return
              onRestore(version)
              onClose()
            }}
          >
            restore
          </Button>
        </>
      }
    >
      {list.length === 0 ? (
        <p className="text-muted">
          {versions.isPending ? 'reading the saves…' : 'no saves yet: each save keeps a version.'}
        </p>
      ) : (
        <div className="flex max-h-[60vh] min-h-48 gap-3">
          <ol aria-label="saves" className="flex w-40 shrink-0 flex-col overflow-y-auto">
            {list.map((v, index) => (
              <li key={`${v.at}:${index}`}>
                <button
                  type="button"
                  aria-pressed={index === picked}
                  onClick={() => setPicked(index)}
                  className={cx(
                    'flex w-full flex-col rounded-sm px-2 py-1 text-left text-data transition-colors duration-120 ease-out focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-accent',
                    index === picked ? 'bg-accent-10 text-accent' : 'text-text hover:bg-panel-2',
                  )}
                >
                  <span>{WHEN.format(v.at)}</span>
                  <span className="truncate text-muted">
                    {v.name}
                    {v.source === current ? ' · now' : ''}
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <p className="text-data text-muted">
              {removed === 0 && added === 0
                ? 'the same as the editor'
                : `the editor has ${added} ${added === 1 ? 'line' : 'lines'} added, ${removed} removed`}
            </p>
            <section
              aria-label="diff"
              className="min-h-0 flex-1 overflow-auto rounded-sm border border-border bg-panel-2 py-1"
            >
              <pre className="text-code">
                {rows.map((row, index) => (
                  // A diff's rows have no identity but their place.
                  <DiffLine key={index} row={row} />
                ))}
              </pre>
            </section>
          </div>
        </div>
      )}
    </Modal>
  )
}

function DiffLine({ row }: { row: DiffRow }) {
  if (row.op === 'fold') {
    return (
      <div className="px-2 text-muted">
        ⋯ {row.lines} unchanged {row.lines === 1 ? 'line' : 'lines'}
      </div>
    )
  }
  const tone =
    row.op === '+' ? 'bg-accent-10 text-accent' : row.op === '-' ? 'bg-danger/10 text-danger' : ''
  return (
    <div className={cx('px-2 whitespace-pre', tone)}>
      <span aria-hidden="true" className="select-none text-muted">
        {row.op === '=' ? ' ' : row.op}{' '}
      </span>
      {row.text === '' ? ' ' : row.text}
    </div>
  )
}
