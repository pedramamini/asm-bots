import type { DisLine } from '@asmbots/asm'
import { type Battle, IP, type ProcRow } from '@asmbots/engine'
import { cx, hexAddress, hexByte, hueColor, Input, Panel, Toggle, vars } from '@asmbots/ui'
import { type KeyboardEvent, useRef, useState } from 'react'
import { useMotionReduced } from '../../../store/settings'
import { compileValue, evaluateValue } from './condition'
import { type BotImage, shortLabel } from './image'
import { FOLLOW_MARGIN, MEMORY_ROWS, ROWS_BEFORE, sweep, windowStart } from './memory'
import type { DebugState } from './session'

export interface MemoryPanelProps {
  state: DebugState | null
  battle: Battle | null
  /** The debugged bot: its labels name the rows. */
  image: BotImage | null
  /** Where the loaded bots' lines start: a row starts at each. */
  starts: ReadonlySet<number>
  /** A click on a row: sets or clears the breakpoint at its address. */
  onToggleBreakpoint: (addr: number) => void
  className?: string | undefined
}

/** How long a written byte's highlight fades, ms (PRODUCT_SPEC §3). */
export const WRITE_FADE_MS = 2000
const NO_LABELS: ReadonlyMap<string, number> = new Map()
/** The bytes a row shows; a longer instruction ends in `…`, its tooltip has them all. */
const SHOWN_BYTES = 4

/** The processes standing in the core: address to the bots whose processes stand there. */
function standing(battle: Battle): Map<number, number[]> {
  const at = new Map<number, number[]>()
  for (const bot of battle.bots) {
    const q = bot.queue
    for (let i = 0; i < q.size; i++) {
      const ip = (q.rows[q.at(i)] as ProcRow)[IP] as number
      const bots = at.get(ip)
      if (bots === undefined) at.set(ip, [bot.index])
      else if (!bots.includes(bot.index)) bots.push(bot.index)
    }
  }
  return at
}

/**
 * When each byte was last seen written, ms: from each move's writes, and from the bytes in view
 * that changed since the last state (a step back writes nothing, and a long run's writes are only
 * its newest). A byte's highlight fades from its write; one that comes into view after the write
 * starts part way through, and keeps that start however often the panel draws again.
 */
function useWriteTimes(state: DebugState | null, battle: Battle | null) {
  const times = useRef(new Map<number, number>())
  /** When each highlight (`address:write time`) was first drawn, ms. */
  const drawn = useRef(new Map<string, number>())
  const last = useRef<{
    writes: DebugState['lastWrites'] | null
    cycle: number
    battle: Battle | null
    shown: Map<number, number>
    stamp: number
  }>({ writes: null, cycle: -1, battle: null, shown: new Map(), stamp: 0 })
  const now = performance.now()
  const was = last.current
  if (
    state !== null &&
    battle !== null &&
    (state.lastWrites !== was.writes || state.cycle !== was.cycle)
  ) {
    for (const w of state.lastWrites) {
      for (let k = 0; k < w.len; k++) times.current.set((w.addr + k) & 0xffff, now)
    }
    // The bytes in view that changed: the same battle, or the one a step back put in its place.
    for (const [a, byte] of was.shown) {
      if (battle.core.bytes[a] !== byte) times.current.set(a, now)
    }
    for (const [a, t] of times.current) if (now - t >= WRITE_FADE_MS) times.current.delete(a)
    for (const [key, t] of drawn.current) if (now - t >= WRITE_FADE_MS) drawn.current.delete(key)
    last.current = { ...was, writes: state.lastWrites, cycle: state.cycle, battle, stamp: now }
  }
  return {
    /** When `a` was written, if its highlight still shows. */
    at: (a: number): number | undefined => {
      const t = times.current.get(a)
      return t !== undefined && now - t < WRITE_FADE_MS ? t : undefined
    },
    /** How far into its fade the highlight of `a`, written at `t`, started: ms, for its delay. */
    into: (a: number, t: number): number => {
      const key = `${a}:${t}`
      let first = drawn.current.get(key)
      if (first === undefined) {
        first = now
        drawn.current.set(key, now)
      }
      return Math.max(0, Math.round(first - t))
    },
    /** The time of the last state's writes. */
    stamp: last.current.stamp,
    /** What the rows showed: the next state tells what changed from it. */
    show: (shown: Map<number, number>) => {
      last.current.shown = shown
    },
  }
}

/**
 * The Memory panel (PRODUCT_SPEC §3): `MEMORY_ROWS` rows of the core, one instruction each, from
 * the disassembler: the address, the bytes over a stripe in their owner's hue, the debugged bot's
 * label, and the instruction. It follows the IP of the followed process, keeping its rows still
 * while the IP moves inside them; `goto` (an address, a label, `di + 4`) holds it at another
 * place until `follow ip` again. A written byte lights up and fades over 2 s. The followed
 * process's row is bright, other processes show as ticks in their bots' hues, and a click on a
 * row sets or clears a breakpoint there.
 */
export function MemoryPanel({
  state,
  battle,
  image,
  starts,
  onToggleBreakpoint,
  className,
}: MemoryPanelProps) {
  const reduced = useMotionReduced()
  const [follow, setFollow] = useState(true)
  const [target, setTarget] = useState<number | null>(null)
  const [gotoText, setGotoText] = useState('')
  const [gotoError, setGotoError] = useState<string | null>(null)
  const start = useRef<number | null>(null)
  const writes = useWriteTimes(state, battle)

  let rows: DisLine[] = []
  const anchor = state === null ? null : follow ? state.ip : target
  if (battle !== null && anchor !== null) {
    const core = battle.core.bytes
    const names = image?.names
    if (start.current !== null) rows = sweep(core, start.current, MEMORY_ROWS, names, starts)
    const row = rows.findIndex((line) => line.address === anchor)
    const settled = follow
      ? row >= FOLLOW_MARGIN && row < MEMORY_ROWS - FOLLOW_MARGIN
      : row >= 0 && start.current !== null
    if (!settled) {
      start.current = windowStart(core, anchor, ROWS_BEFORE, starts)
      rows = sweep(core, start.current, MEMORY_ROWS, names, starts)
    }
  }

  const ips = battle === null ? new Map<number, number[]>() : standing(battle)
  const breakpoints = new Map(state?.breakpoints.map((bp) => [bp.addr, bp.enabled]) ?? [])
  const shown = new Map<number, number>()

  const go = () => {
    if (state === null || battle === null) return
    const compiled = compileValue(gotoText)
    if (!compiled.ok) {
      setGotoError(compiled.error.message)
      return
    }
    const { bot, row } = state.selectedProc
    const regs = battle.bots[bot]?.queue.rows[row] as ProcRow
    const value = evaluateValue(compiled.compiled, regs, image?.labels ?? NO_LABELS)
    if (typeof value === 'string') {
      setGotoError(value)
      return
    }
    setGotoError(null)
    setTarget(value)
    setFollow(false)
    start.current = null
  }

  const onGotoKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    go()
  }

  const rowsView = rows.map((line) => {
    const { address } = line
    const bytes = battle?.core.bytes
    const owner = battle?.core.owner
    const here = state !== null && address === state.ip && state.selectedProc.index >= 0
    const others = (ips.get(address) ?? []).filter((b) => !(here && b === state?.selectedProc.bot))
    const bp = breakpoints.get(address)
    const label = image?.names.get(address)
    const cells = Array.from({ length: Math.min(line.length, SHOWN_BYTES) }, (_, k) => {
      const a = (address + k) & 0xffff
      const byte = bytes?.[a] ?? 0
      shown.set(a, byte)
      const tag = owner?.[a] ?? 0
      const at = writes.at(a)
      const lit = at !== undefined && (!reduced || at === writes.stamp)
      return (
        <span
          // A new write restarts the fade: a new element.
          key={`${k}:${at ?? 0}`}
          data-written={lit || undefined}
          className={cx(
            'border-b-2 px-px',
            tag === 0 ? 'border-transparent' : 'border-(--hue)',
            lit &&
              (reduced
                ? 'bg-accent-25 text-bright'
                : 'animate-[debug-write_2000ms_ease-out_forwards] [animation-delay:var(--into)]'),
          )}
          style={vars({
            ...(tag !== 0 && { '--hue': hueColor(tag - 1) }),
            ...(lit && !reduced && { '--into': `-${writes.into(a, at)}ms` }),
          })}
        >
          {hexByte(byte)}
        </span>
      )
    })
    return (
      <li key={address}>
        <button
          type="button"
          aria-current={here || undefined}
          title={
            bp === undefined
              ? `break at ${hexAddress(address)}`
              : `clear the breakpoint at ${hexAddress(address)}`
          }
          onClick={() => onToggleBreakpoint(address)}
          className={cx(
            'flex h-[18px] w-full min-w-0 items-center gap-2 pr-2 text-left text-data transition-colors duration-120 ease-out hover:bg-panel-2 focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-accent',
            here
              ? 'bg-accent-25 text-bright shadow-[inset_2px_0_0_var(--text-bright)]'
              : 'text-text',
          )}
        >
          <span
            aria-hidden="true"
            className="relative flex w-4 shrink-0 items-center justify-center"
          >
            {bp !== undefined && (
              <span className={cx('size-2 rounded-full border border-danger', bp && 'bg-danger')} />
            )}
            {here && (
              <span className="absolute left-1 border-y-4 border-l-[7px] border-y-transparent border-l-bright" />
            )}
            {!here && others.length > 0 && (
              <span className="absolute right-0 flex h-3 gap-px">
                {others.slice(0, 3).map((b) => (
                  <span
                    key={b}
                    className="w-0.5 bg-(--hue)"
                    style={vars({ '--hue': hueColor(b) })}
                  />
                ))}
              </span>
            )}
          </span>
          <span className="shrink-0 text-muted">{hexAddress(address)}</span>
          <span
            className="flex w-[13ch] shrink-0 gap-0.5 overflow-hidden text-muted"
            title={line.length > SHOWN_BYTES ? line.bytesHex : undefined}
          >
            {cells}
            {line.length > SHOWN_BYTES && <span>…</span>}
          </span>
          <span className="w-[7ch] shrink-0 truncate text-warn" title={label}>
            {label === undefined ? '' : `${shortLabel(label)}:`}
          </span>
          <span
            className={cx(
              'min-w-0 truncate',
              line.kind === 'dat' && 'text-dim',
              (line.kind === 'int3' || line.kind === 'hlt') && 'text-warn',
              line.kind === 'undefined' && 'text-danger',
            )}
          >
            {line.text}
          </span>
        </button>
      </li>
    )
  })
  writes.show(shown)

  // Following, the pressed `follow ip` says where the rows are; held, the status says it.
  const status = anchor === null || follow ? undefined : `at ${hexAddress(anchor)}`
  return (
    <Panel
      dense
      title="memory"
      status={status}
      actions={
        <>
          <Input
            aria-label="go to address"
            placeholder="goto"
            value={gotoText}
            onChange={(event) => {
              setGotoText(event.currentTarget.value)
              setGotoError(null)
            }}
            onKeyDown={onGotoKey}
            disabled={state === null}
            className="w-24"
          />
          <Toggle
            pressed={follow}
            onPressedChange={(on) => {
              setFollow(on)
              if (on) start.current = null
            }}
            disabled={state === null}
            title="keep the IP of the followed process in view"
          >
            follow ip
          </Toggle>
        </>
      }
      className={className}
    >
      {gotoError !== null && (
        <p role="alert" className="mb-1 text-data text-danger">
          {gotoError}
        </p>
      )}
      {state === null ? (
        <p className="text-data text-muted">load a bot to see the core.</p>
      ) : (
        <ol aria-label="memory" className="-mx-2">
          {rowsView}
        </ol>
      )}
    </Panel>
  )
}
