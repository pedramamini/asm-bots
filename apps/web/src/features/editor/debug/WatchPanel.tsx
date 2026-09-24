import type { Battle, ProcRow } from '@asmbots/engine'
import { cx, Hex, IconButton, Input, Panel, Segmented } from '@asmbots/ui'
import { X } from 'lucide-react'
import { type KeyboardEvent, useRef, useState } from 'react'
import { type CompiledValue, compileValue, evaluateValue } from './condition'
import type { BotImage } from './image'
import type { DebugState } from './session'

/** A watch reads a byte or a little-endian word at its address. */
export type WatchSize = 'byte' | 'word'

/** One watch: an address, as an expression, and how much to read there. */
export interface Watch {
  readonly id: number
  readonly compiled: CompiledValue
  readonly size: WatchSize
}

export interface WatchPanelProps {
  state: DebugState | null
  battle: Battle | null
  image: BotImage | null
  className?: string | undefined
}

const NO_LABELS: ReadonlyMap<string, number> = new Map()

/** The byte or word at `addr`, wrapping at 64 KB. */
export function readAt(bytes: Uint8Array, addr: number, size: WatchSize): number {
  const lo = bytes[addr & 0xffff] as number
  return size === 'byte' ? lo : lo | ((bytes[(addr + 1) & 0xffff] as number) << 8)
}

/** Where a watch reads, and what: or why it cannot, for the process in `row`. */
function evaluateWatch(
  watch: Watch,
  battle: Battle,
  row: ProcRow,
  labels: ReadonlyMap<string, number>,
): { readonly addr: number; readonly value: number } | string {
  const addr = evaluateValue(watch.compiled, row, labels)
  if (typeof addr === 'string') return addr
  return { addr, value: readAt(battle.core.bytes, addr, watch.size) }
}

/**
 * The Watch panel (PRODUCT_SPEC §3): addresses to keep an eye on, each an expression of the
 * followed process's registers and the bot's labels (`bomb`, `di`, `bx + 0x10`), read as a byte
 * or a word. A value the last move changed is accent.
 */
export function WatchPanel({ state, battle, image, className }: WatchPanelProps) {
  const [watches, setWatches] = useState<readonly Watch[]>([])
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const nextId = useRef(1)
  // Each watch's value where the battle stood before, to mark what the last move changed.
  const track = useRef<{
    at: string
    current: Map<number, number>
    previous: Map<number, number>
  }>({ at: '', current: new Map(), previous: new Map() })

  const add = () => {
    const compiled = compileValue(text)
    if (!compiled.ok) {
      setError(compiled.error.message)
      return
    }
    setWatches((list) => [
      ...list,
      { id: nextId.current++, compiled: compiled.compiled, size: 'word' },
    ])
    setText('')
    setError(null)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || text.trim() === '') return
    event.preventDefault()
    add()
  }

  const row =
    state === null || battle === null
      ? null
      : (battle.bots[state.selectedProc.bot]?.queue.rows[state.selectedProc.row] ?? null)
  const labels = image?.labels ?? NO_LABELS
  const values = new Map<number, number>()
  const shown = watches.map((watch) => {
    const read = battle === null || row === null ? null : evaluateWatch(watch, battle, row, labels)
    if (read !== null && typeof read !== 'string') values.set(watch.id, read.value)
    return { watch, read }
  })
  const at = state === null ? '' : `${state.cycle}:${state.canStepBack}`
  if (at !== track.current.at) {
    track.current = { at, current: values, previous: track.current.current }
  } else {
    track.current.current = values
  }
  const was = track.current.previous

  return (
    <Panel
      dense
      title="watch"
      status={watches.length > 0 ? String(watches.length) : undefined}
      className={className}
    >
      <div className="flex flex-col gap-1">
        <Input
          aria-label="watch an address"
          placeholder="address, label, di + 4"
          value={text}
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
        {watches.length === 0 ? (
          <p className="text-data text-muted">type an address and press enter to watch it.</p>
        ) : (
          <ul aria-label="watches" className="-mx-2">
            {shown.map(({ watch, read }) => {
              const ok = read !== null && typeof read !== 'string'
              const changed = ok && was.has(watch.id) && was.get(watch.id) !== read.value
              return (
                <li key={watch.id} className="flex min-w-0 items-center gap-2 px-2 text-data">
                  <span className="min-w-0 flex-1 truncate text-text" title={watch.compiled.text}>
                    {watch.compiled.text}
                  </span>
                  {ok ? (
                    <>
                      <Hex value={read.addr} className="shrink-0 text-muted" />
                      <span
                        className={cx(
                          'w-12 shrink-0 text-right tabular-nums',
                          changed ? 'text-accent' : 'text-bright',
                        )}
                        title={`${read.value} decimal`}
                      >
                        {read.value
                          .toString(16)
                          .toUpperCase()
                          .padStart(watch.size === 'byte' ? 2 : 4, '0')}
                      </span>
                    </>
                  ) : (
                    <span className="shrink-0 truncate text-danger">{read ?? '—'}</span>
                  )}
                  <Segmented
                    label={`${watch.compiled.text}: read`}
                    options={[
                      { value: 'byte', label: 'b' },
                      { value: 'word', label: 'w' },
                    ]}
                    value={watch.size}
                    onValueChange={(size) =>
                      setWatches((list) =>
                        list.map((w) => (w.id === watch.id ? { ...w, size } : w)),
                      )
                    }
                    className="shrink-0"
                  />
                  <IconButton
                    icon={X}
                    size="sm"
                    label={`stop watching ${watch.compiled.text}`}
                    onClick={() => setWatches((list) => list.filter((w) => w.id !== watch.id))}
                  />
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Panel>
  )
}
