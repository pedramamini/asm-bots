/**
 * The arena's speed (PRODUCT_SPEC §2): cycles per frame from 1 to 10,000 on a log slider, then
 * `max`. `[` and `]` step along a 1-2-5 ladder.
 */
import { MAX_CYCLES_PER_FRAME, type Speed } from '../worker/protocol'

/** The speeds `[` and `]` step through, slowest first. */
export const SPEED_STEPS: readonly Speed[] = [
  1,
  2,
  5,
  10,
  20,
  50,
  100,
  200,
  500,
  1000,
  2000,
  5000,
  MAX_CYCLES_PER_FRAME,
  'max',
]

/** A speed as the ladder ranks it: `max` past every count. */
function rank(speed: Speed): number {
  return speed === 'max' ? Number.POSITIVE_INFINITY : speed
}

/** The next speed up the ladder: `]`. `max` stays `max`. */
export function faster(speed: Speed): Speed {
  return SPEED_STEPS.find((step) => rank(step) > rank(speed)) ?? 'max'
}

/** The next speed down the ladder: `[`. 1 stays 1. */
export function slower(speed: Speed): Speed {
  return [...SPEED_STEPS].reverse().find((step) => rank(step) < rank(speed)) ?? 1
}

/** A speed as the HUD shows it: `240/f`, or `max`. */
export function speedLabel(speed: Speed): string {
  return speed === 'max' ? 'max' : `${speed.toLocaleString('en-US')}/f`
}
