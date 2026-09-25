import type { Battle, ProcRow } from '@asmbots/engine'
import { cx, EmptyState, Hex, IconButton, Input, Panel } from '@asmbots/ui'
import { X } from 'lucide-react'
import { type KeyboardEvent, useState } from 'react'
import { compileCondition, compileValue, evaluateValue } from './condition'
import { type BotImage, inImage, labelOf } from './image'
import type { Breakpoint, DebugState } from './session'

export interface BreakpointsPanelProps {
  state: DebugState | null
  battle: Battle | null
  image: BotImage | null
  names: readonly string[]
  /** The editor's line of an address in the debugged bot, or null. */
  lineOf: (addr: number) => number | null
  onSet: (addr: number, options: { condition?: string; enabled?: boolean }) => void
  onRemove: (addr: number) => void
  /** F9's work: a breakpoint on the editor cursor's line. */
  onBreakAtCursor: () => void
  className?: string | undefined
}

const NO_LABELS: ReadonlyMap<string, number> = new Map()

/** Where a breakpoint is: `lap+3 · line 22` in the debugged bot, else whose bytes it is on. */
function whereOf(
  addr: number,
  battle: Battle | null,
  image: BotImage | null,
  names: readonly string[],
  lineOf: (addr: number) => number | null,
): string {
  if (image !== null && inImage(image, addr)) {
    const line = lineOf(addr)
    return [labelOf(image, addr), line === null ? null : `line ${line}`].filter(Boolean).join(' · ')
  }
  const tag = battle?.core.owner[addr] ?? 0
  return tag === 0 ? 'empty core' : `in ${names[tag - 1] ?? `bot ${tag}`}`
}

/**
 * The Breakpoints panel (PRODUCT_SPEC §3): each breakpoint's address and place, whether it is on,
 * its condition on the registers (`ax == 0x10 && cx < 3`: Enter sets it, and a condition that does
 * not read is not set), and its hits since the battle started. A new one takes an address or a
 * label. Breakpoints are the engine's checks, never bytes in the core.
 */
export function BreakpointsPanel({
  state,
  battle,
  image,
  names,
  lineOf,
  onSet,
  onRemove,
  onBreakAtCursor,
  className,
}: BreakpointsPanelProps) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const breakpoints = state?.breakpoints ?? []

  const add = () => {
    if (state === null || battle === null) return
    const compiled = compileValue(text)
    if (!compiled.ok) {
      setError(compiled.error.message)
      return
    }
    const { bot, row } = state.selectedProc
    const regs = battle.bots[bot]?.queue.rows[row] as ProcRow
    const addr = evaluateValue(compiled.compiled, regs, image?.labels ?? NO_LABELS)
    if (typeof addr === 'string') {
      setError(addr)
      return
    }
    onSet(addr, {})
    setText('')
    setError(null)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || text.trim() === '') return
    event.preventDefault()
    add()
  }

  return (
    <Panel
      dense
      title="breakpoints"
      status={breakpoints.length > 0 ? String(breakpoints.length) : undefined}
      className={className}
    >
      <div className="flex flex-col gap-1">
        <Input
          aria-label="break at an address"
          placeholder="address or label"
          value={text}
          disabled={state === null}
          onChange={(event) => {
            setText(event.currentTarget.value)
            setError(null)
          }}
          onKeyDown={onKeyDown}
          className="w-full"
        />
        {error !== null && (
          <p role="alert" className="text-data text-danger">
            {error}
          </p>
        )}
        {breakpoints.length === 0 ? (
          <EmptyState
            dense
            action={{
              label: "break on the cursor's line",
              disabled: state === null,
              onClick: onBreakAtCursor,
            }}
          >
            no breakpoints yet: press the gutter left of a line, F9, or
          </EmptyState>
        ) : (
          <ul aria-label="breakpoints" className="-mx-2">
            {breakpoints.map((bp) => (
              <BreakpointRow
                key={bp.addr}
                bp={bp}
                where={whereOf(bp.addr, battle, image, names, lineOf)}
                onSet={onSet}
                onRemove={onRemove}
              />
            ))}
          </ul>
        )}
      </div>
    </Panel>
  )
}

interface BreakpointRowProps {
  bp: Breakpoint
  where: string
  onSet: BreakpointsPanelProps['onSet']
  onRemove: BreakpointsPanelProps['onRemove']
}

function BreakpointRow({ bp, where, onSet, onRemove }: BreakpointRowProps) {
  /** The condition being typed; null while the field shows the breakpoint's. */
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const name = `breakpoint at 0x${bp.addr.toString(16).toUpperCase().padStart(4, '0')}`

  const commit = () => {
    if (draft === null || draft === bp.condition) {
      setDraft(null)
      return
    }
    if (draft.trim() !== '') {
      const compiled = compileCondition(draft)
      if (!compiled.ok) {
        setError(`column ${compiled.error.col}: ${compiled.error.message}`)
        return
      }
    }
    setError(null)
    setDraft(null)
    onSet(bp.addr, { condition: draft })
  }

  return (
    <li className="flex flex-col gap-0.5 border-b border-border px-2 pb-1 last:border-b-0">
      <div className="flex min-w-0 items-center gap-2 text-data">
        <input
          type="checkbox"
          aria-label={`${name}: on`}
          checked={bp.enabled}
          onChange={(event) => onSet(bp.addr, { enabled: event.currentTarget.checked })}
          className="size-3 shrink-0 accent-(--danger)"
        />
        <Hex value={bp.addr} className={cx('shrink-0', bp.enabled ? 'text-text' : 'text-dim')} />
        <span className="min-w-0 flex-1 truncate text-muted" title={where}>
          {where}
        </span>
        <span className="shrink-0 text-muted tabular-nums" title="stops it made">
          {bp.hits.toLocaleString('en-US')} {bp.hits === 1 ? 'hit' : 'hits'}
        </span>
        <IconButton
          icon={X}
          size="sm"
          label={`remove the ${name}`}
          onClick={() => onRemove(bp.addr)}
        />
      </div>
      <Input
        aria-label={`${name}: condition`}
        prompt="if"
        placeholder="always"
        value={draft ?? bp.condition}
        aria-invalid={error !== null || undefined}
        onChange={(event) => {
          setDraft(event.currentTarget.value)
          setError(null)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            setDraft(null)
            setError(null)
          }
        }}
        onBlur={commit}
        className="w-full"
      />
      {error !== null && <p className="text-data text-danger">{error}</p>}
    </li>
  )
}
