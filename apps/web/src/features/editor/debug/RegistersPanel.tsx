import { cx, Input, Panel } from '@asmbots/ui'
import { type KeyboardEvent, useRef, useState } from 'react'
import { parseWord, sameProcess, usePreviousState, word } from './hooks'
import type { DebugState, RegisterEdit, Registers } from './session'

export interface RegistersPanelProps {
  state: DebugState | null
  /** The battle's bot names. */
  names: readonly string[]
  onEdit: (edit: RegisterEdit) => void
  className?: string | undefined
}

/** The registers two to a row, as a debugger lays them out: the general ones, then the index ones. */
const PAIRS: readonly (readonly [keyof Registers, keyof Registers])[] = [
  ['ax', 'si'],
  ['bx', 'di'],
  ['cx', 'bp'],
  ['dx', 'sp'],
]

/** FLAGS's bits (ISA §1), `ODITSZAPC`. POPF writes the status flags and DF; not I or T. */
const FLAG_BITS: readonly { letter: string; bit: number; name: string; writable: boolean }[] = [
  { letter: 'O', bit: 11, name: 'overflow', writable: true },
  { letter: 'D', bit: 10, name: 'direction', writable: true },
  { letter: 'I', bit: 9, name: 'interrupt', writable: false },
  { letter: 'T', bit: 8, name: 'trap', writable: false },
  { letter: 'S', bit: 7, name: 'sign', writable: true },
  { letter: 'Z', bit: 6, name: 'zero', writable: true },
  { letter: 'A', bit: 4, name: 'auxiliary carry', writable: true },
  { letter: 'P', bit: 2, name: 'parity', writable: true },
  { letter: 'C', bit: 0, name: 'carry', writable: true },
]

/**
 * The Registers panel (PRODUCT_SPEC §3): the followed process's registers, IP, and FLAGS, each
 * a hex field to edit in place (Enter or leaving the field sets it, Esc puts it back), and FLAGS's
 * bits as `O D I T S Z A P C` toggles. A value the last move changed is accent. A dead process's
 * registers are its last, and read-only.
 */
export function RegistersPanel({ state, names, onEdit, className }: RegistersPanelProps) {
  const previous = usePreviousState(state)
  const before = sameProcess(state, previous) ? previous : null
  const dead = state === null || state.selectedProc.index < 0
  const status =
    state === null
      ? 'no process'
      : `${names[state.selectedProc.bot] ?? `bot ${state.selectedProc.bot}`} · ${
          dead ? 'dead' : `proc ${state.selectedProc.index}`
        }`
  const field = (name: keyof RegisterEdit, value: number, was: number | undefined) => (
    <WordField
      key={name}
      name={name}
      value={value}
      changed={was !== undefined && was !== value}
      disabled={dead}
      onCommit={(v) => onEdit({ [name]: v })}
    />
  )
  return (
    <Panel dense title="registers" status={status} className={className}>
      {state === null ? (
        <p className="text-data text-muted">load a bot to see its registers.</p>
      ) : (
        <div className="flex flex-col gap-1">
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            {PAIRS.map(([left, right]) => [
              field(left, state.regs[left], before?.regs[left]),
              field(right, state.regs[right], before?.regs[right]),
            ])}
            {field('ip', state.ip, before?.ip)}
            {field('flags', state.flags, before?.flags)}
          </div>
          <fieldset className="flex min-w-0 items-center gap-1" disabled={dead}>
            <legend className="sr-only">flags</legend>
            {FLAG_BITS.map(({ letter, bit, name, writable }) => {
              const on = ((state.flags >> bit) & 1) === 1
              const was = before === null ? on : ((before.flags >> bit) & 1) === 1
              return (
                <button
                  key={letter}
                  type="button"
                  aria-label={`${name} flag`}
                  aria-pressed={on}
                  title={
                    writable
                      ? `${name} flag: ${on ? 'set' : 'clear'}`
                      : `${name} flag: POPF cannot set it`
                  }
                  disabled={!writable}
                  onClick={() => onEdit({ flags: state.flags ^ (1 << bit) })}
                  className={cx(
                    'inline-flex size-5 shrink-0 items-center justify-center rounded-sm border text-data transition-colors duration-120 ease-out focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:cursor-not-allowed',
                    on
                      ? 'border-accent bg-accent-10 text-accent-fg'
                      : 'border-border text-muted not-disabled:hover:border-border-strong',
                    on !== was && 'ring-1 ring-accent-45 ring-offset-1 ring-offset-panel',
                    !writable && 'opacity-60',
                  )}
                >
                  {letter}
                </button>
              )
            })}
          </fieldset>
        </div>
      )}
    </Panel>
  )
}

interface WordFieldProps {
  name: keyof RegisterEdit
  value: number
  /** The last move changed it. */
  changed: boolean
  disabled: boolean
  onCommit: (value: number) => void
}

/** One register: its name, and its value as a hex field that sets it. */
function WordField({ name, value, changed, disabled, onCommit }: WordFieldProps) {
  /** The text being typed; null while the field shows the value. */
  const [draft, setDraft] = useState<string | null>(null)
  /** Esc: the blur that follows puts nothing back. */
  const cancelled = useRef(false)
  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false
      return
    }
    if (draft === null) return
    const next = parseWord(draft)
    setDraft(null)
    if (next !== null && next !== value) onCommit(next)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      cancelled.current = true
      setDraft(null)
      event.currentTarget.blur()
    }
  }
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span aria-hidden="true" className="w-10 shrink-0 text-panel-status text-muted">
        {name}
      </span>
      <Input
        mono
        prompt={null}
        aria-label={name}
        value={draft ?? word(value)}
        disabled={disabled}
        onFocus={(event) => {
          setDraft(word(value))
          event.currentTarget.select()
        }}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        className={cx('w-16', changed && '[&_input]:text-accent-fg')}
        data-changed={changed || undefined}
      />
    </div>
  )
}
