import type { ComponentProps, KeyboardEvent } from 'react'
import { FOCUS_RING } from '../control'
import { useControllable } from '../hooks/useControllable'
import { cx, vars } from '../style'

/** A log slider's native range runs over this many positions, mapped onto min..max by ratio. */
const RESOLUTION = 1000

/** A log slider's keys, as factors of the value: an arrow doubles or halves, a page is ×10. */
const LOG_STEPS: Readonly<Record<string, number>> = {
  ArrowRight: 2,
  ArrowUp: 2,
  ArrowLeft: 0.5,
  ArrowDown: 0.5,
  PageUp: 10,
  PageDown: 0.1,
}

/**
 * The track and the thumb, drawn from the range's parts: a 2 px track in `--border-strong`, accent
 * up to `--fill`, and a 6 × 12 px accent thumb.
 */
const PARTS = [
  '[&::-webkit-slider-runnable-track]:h-0.5',
  '[&::-webkit-slider-runnable-track]:bg-[linear-gradient(to_right,var(--accent)_var(--fill),var(--border-strong)_var(--fill))]',
  '[&::-webkit-slider-thumb]:mt-[-5px]',
  '[&::-webkit-slider-thumb]:h-3',
  '[&::-webkit-slider-thumb]:w-1.5',
  '[&::-webkit-slider-thumb]:appearance-none',
  '[&::-webkit-slider-thumb]:bg-accent',
  '[&::-moz-range-track]:h-0.5',
  '[&::-moz-range-track]:bg-border-strong',
  '[&::-moz-range-progress]:h-0.5',
  '[&::-moz-range-progress]:bg-accent',
  '[&::-moz-range-thumb]:h-3',
  '[&::-moz-range-thumb]:w-1.5',
  '[&::-moz-range-thumb]:rounded-none',
  '[&::-moz-range-thumb]:border-0',
  '[&::-moz-range-thumb]:bg-accent',
].join(' ')

export interface SliderProps
  extends Omit<
    ComponentProps<'input'>,
    'type' | 'value' | 'defaultValue' | 'onChange' | 'min' | 'max' | 'step' | 'children'
  > {
  min: number
  max: number
  /** The value's grain, 1 by default: a linear slider's native step; a log slider rounds to it. */
  step?: number | undefined
  /** `log` spreads min..max by ratio, for a range over decades: 1 … 10,000 cycles per frame. */
  scale?: 'linear' | 'log' | undefined
  /** The value, when the caller holds the state. */
  value?: number | undefined
  /** The value at first, when the slider holds its own state; `min` when absent. */
  defaultValue?: number | undefined
  onValueChange?: ((value: number) => void) | undefined
  /** The value as text, for `aria-valuetext` and the readout: `(n) => `${n}/frame``. */
  format?: ((value: number) => string) | undefined
  /** Shows the formatted value after the track, in a column as wide as the widest value. */
  showValue?: boolean | undefined
}

/**
 * A native range, restyled (DESIGN_SYSTEM §4): a hairline track, accent up to the value, a small
 * accent thumb. On a log scale (the arena's speed) each arrow key doubles or halves the value and
 * Page Up and Page Down multiply it by 10; on a linear scale the keys are the browser's. Assistive
 * tech reads the formatted value. `className` sizes it; every other prop goes to the `<input>`.
 */
export function Slider({
  min,
  max,
  step = 1,
  scale = 'linear',
  value,
  defaultValue,
  onValueChange,
  format = String,
  showValue = false,
  onKeyDown,
  className,
  style,
  ...rest
}: SliderProps) {
  const log = scale === 'log'
  if (log && !(min > 0)) throw new RangeError(`a log slider needs min > 0, not ${min}`)
  const [current, setCurrent] = useControllable(value, defaultValue ?? min, onValueChange)
  /** How far along the track the value sits, 0..1. */
  const share = Math.min(
    1,
    Math.max(
      0,
      log ? Math.log(current / min) / Math.log(max / min) : (current - min) / (max - min),
    ),
  )
  const readout = Math.max(format(min).length, format(max).length)

  const onLogKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event)
    const factor = LOG_STEPS[event.key]
    if (event.defaultPrevented || factor === undefined) return
    event.preventDefault()
    const next = snap(current * factor, min, max, step)
    // Rounding can undo a small step: then take one grain in the key's direction.
    setCurrent(
      next === current ? snap(current + Math.sign(factor - 1) * step, min, max, step) : next,
    )
  }

  return (
    <span
      className={cx(
        'inline-flex h-6 min-w-0 items-center gap-2 has-disabled:opacity-40',
        className,
      )}
    >
      <input
        type="range"
        min={log ? 0 : min}
        max={log ? RESOLUTION : max}
        step={log ? 1 : step}
        value={log ? Math.round(share * RESOLUTION) : current}
        aria-valuetext={format(current)}
        {...rest}
        onChange={(event) => {
          const position = Number(event.currentTarget.value)
          const next = log ? min * (max / min) ** (position / RESOLUTION) : position
          setCurrent(snap(next, min, max, step))
        }}
        onKeyDown={log ? onLogKeyDown : onKeyDown}
        className={cx(
          'h-full min-w-0 flex-1 cursor-pointer appearance-none bg-transparent disabled:cursor-not-allowed',
          PARTS,
          FOCUS_RING,
        )}
        style={{ ...style, ...vars({ '--fill': `${(share * 100).toFixed(2)}%` }) }}
      />
      {showValue && (
        <span
          aria-hidden="true"
          // Faded with the disabled slider: the text of an inactive control (WCAG 1.4.3 exempts it).
          aria-disabled={rest.disabled === true || undefined}
          className="min-w-(--readout) text-right text-data text-muted"
          style={vars({ '--readout': `${readout}ch` })}
        >
          {format(current)}
        </span>
      )}
    </span>
  )
}

/** `value` on the grid of `step` from `min`, held to `min..max`, without float noise. */
function snap(value: number, min: number, max: number, step: number): number {
  const stepped = Math.round((value - min) / step) * step + min
  const places = Math.max(decimals(step), decimals(min))
  return Number(Math.min(max, Math.max(min, stepped)).toFixed(places))
}

function decimals(value: number): number {
  return String(value).split('.')[1]?.length ?? 0
}
