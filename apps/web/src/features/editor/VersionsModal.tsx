import { Button, cx, EmptyState, Modal } from '@asmbots/ui'
import { useQuery } from '@tanstack/react-query'
import { RotateCcw } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { botQuery, useBotVersion } from '../../api/queries'
import { LoadFailure } from '../../app/LoadFailure'
import { useBotVersions } from '../../store/bot-versions'
import { type DiffOp, diffSequences } from './diff'

/** A version's text, to put back in the editor, and how the toast names it. */
export interface RestoredText {
  readonly name: string
  readonly source: string
  /** `the save of 24 Sep, 12:00`, `v3 of your account`. */
  readonly label: string
}

export interface VersionsModalProps {
  open: boolean
  /** The local bot whose saves to list; null for a bot never saved. */
  botId: string | null
  /** The account bot it is linked to, whose versions to list too; null for none. */
  cloudId: string | null
  /** The editor's text now, which each version is compared with. */
  current: string
  onClose: () => void
  /** Puts a version's text in the editor. */
  onRestore: (version: RestoredText) => void
  /** `save now`, when there are none yet: the editor's save, which keeps the first. */
  onSave: () => void
}

/** The version picked: a save of this browser, or a version in the account, by number. */
type Picked =
  | { readonly from: 'local'; readonly index: number }
  | { readonly from: 'cloud'; readonly version: number }

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
 * `versions` (PRODUCT_SPEC §3): the bot's last saves in this browser, newest first, then its
 * versions in the account when it is kept there; and the line diff of the one picked against the
 * editor's text (`-` the version has, `+` the editor has). An account version's source is fetched
 * when it is picked. `restore` puts the version's text back in the editor, as an edit that undo
 * takes back.
 */
export function VersionsModal({
  open,
  botId,
  cloudId,
  current,
  onClose,
  onRestore,
  onSave,
}: VersionsModalProps) {
  const versions = useBotVersions(open ? botId : null)
  const cloud = useQuery({ ...botQuery(cloudId ?? ''), enabled: open && cloudId !== null })
  const [picked, setPicked] = useState<Picked>({ from: 'local', index: 0 })
  const list = versions.data ?? []
  const cloudList = cloudId === null ? [] : (cloud.data?.versions ?? [])
  // Each opening starts on the newest save, or the newest account version when there is none.
  const firstCloud = cloudList[0]?.version
  useEffect(() => {
    if (!open) return
    setPicked(
      list.length === 0 && firstCloud !== undefined
        ? { from: 'cloud', version: firstCloud }
        : { from: 'local', index: 0 },
    )
  }, [open, list.length, firstCloud])
  const cloudSource = useBotVersion(
    cloudId ?? '',
    open && cloudId !== null && picked.from === 'cloud' ? picked.version : null,
  )
  let version: RestoredText | undefined
  if (picked.from === 'local') {
    const save = list[Math.min(picked.index, list.length - 1)]
    if (save !== undefined) {
      version = { ...save, label: `the save of ${new Date(save.at).toLocaleString()}` }
    }
  } else {
    const text = cloudSource.data?.version.source
    const name = cloud.data?.bot.name ?? ''
    if (text !== undefined) {
      version = { name, source: text, label: `v${picked.version} of your account` }
    }
  }
  const rows = version === undefined ? [] : diffRows(version.source, current)
  const added = rows.filter((row) => row.op === '+').length
  const removed = rows.filter((row) => row.op === '-').length
  const empty = list.length === 0 && cloudList.length === 0
  // A read that is off (no bot saved, none in the account) waits on nothing.
  const reading = (botId !== null && versions.isPending) || (cloudId !== null && cloud.isPending)
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
      {cloud.error !== null && cloudList.length === 0 && (
        <LoadFailure read={cloud} what="your account's versions" dense />
      )}
      {empty ? (
        reading ? (
          <p className="text-muted">reading the saves…</p>
        ) : (
          <EmptyState action={{ label: 'save now', onClick: onSave }}>
            no saves yet: each save keeps a version to compare and restore.
          </EmptyState>
        )
      ) : (
        <div className="flex max-h-[60vh] min-h-48 gap-3">
          <div className="flex w-40 shrink-0 flex-col gap-2 overflow-y-auto">
            {list.length > 0 && (
              <ol aria-label="saves" className="flex flex-col">
                {list.map((v, index) => (
                  <li key={`${v.at}:${index}`}>
                    <VersionButton
                      picked={picked.from === 'local' && index === picked.index}
                      onPick={() => setPicked({ from: 'local', index })}
                      detail={`${v.name}${v.source === current ? ' · now' : ''}`}
                    >
                      {WHEN.format(v.at)}
                    </VersionButton>
                  </li>
                ))}
              </ol>
            )}
            {cloudList.length > 0 && (
              <section aria-label="account" className="flex flex-col">
                <h3 className="px-2 text-panel-status text-muted">account</h3>
                <ol aria-label="account versions" className="flex flex-col">
                  {cloudList.map((v) => (
                    <li key={v.id}>
                      <VersionButton
                        picked={picked.from === 'cloud' && v.version === picked.version}
                        onPick={() => setPicked({ from: 'cloud', version: v.version })}
                        detail={`${v.size} B · ${WHEN.format(new Date(v.createdAt))}`}
                      >
                        v{v.version}
                      </VersionButton>
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <p className="text-data text-muted">
              {version === undefined
                ? 'reading the version…'
                : removed === 0 && added === 0
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

function VersionButton({
  picked,
  onPick,
  detail,
  children,
}: {
  picked: boolean
  onPick: () => void
  detail: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={picked}
      onClick={onPick}
      className={cx(
        'flex w-full flex-col rounded-sm px-2 py-1 text-left text-data transition-colors duration-120 ease-out focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-accent',
        picked ? 'bg-accent-10 text-accent' : 'text-text hover:bg-panel-2',
      )}
    >
      <span>{children}</span>
      <span className="truncate text-muted">{detail}</span>
    </button>
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
