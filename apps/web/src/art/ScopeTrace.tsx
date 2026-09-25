import { cx } from '@asmbots/ui'

const WIDTH = 480
const HEIGHT = 200
/** Samples per trace, one every 4 px. */
const SAMPLES = WIDTH / 4 + 1

/** A trace: its bot's hue, its first process count (0..1 of the height), and when it dies. */
interface Trace {
  readonly hue: number
  readonly start: number
  /** 0..1 across, or 1 for a bot that lives. */
  readonly death: number
  readonly seed: number
}

const TRACES: readonly Trace[] = [
  { hue: 4, start: 0.2, death: 1, seed: 11 },
  { hue: 8, start: 0.35, death: 0.78, seed: 23 },
  { hue: 1, start: 0.28, death: 0.46, seed: 37 },
  { hue: 9, start: 0.1, death: 0.22, seed: 41 },
]

/** A fixed pseudo-random stream: the same seed gives the same numbers. */
function stream(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), s | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * A trace's points: a process count that climbs as the bot forks, wanders, and falls to the floor
 * when the bot dies. A fixed walk, so the picture is the same on every render.
 */
export function tracePoints(trace: Trace): string {
  const random = stream(trace.seed)
  let value = trace.start
  const points: string[] = []
  for (let i = 0; i < SAMPLES; i++) {
    const x = i / (SAMPLES - 1)
    const dead = x > trace.death
    value += (random() - 0.5) * 0.09 + (dead ? -0.09 : 0.006)
    value = Math.min(0.92, Math.max(0.015, value))
    points.push(`${(x * WIDTH).toFixed(1)},${(HEIGHT - value * HEIGHT).toFixed(1)}`)
  }
  return points.join(' ')
}

/**
 * Four bots' process counts over a battle, drawn as phosphor on a scope's graticule
 * (DESIGN_SYSTEM §10): three die, one lives. On the arena's black in every theme, in the bots'
 * hues. Art: hidden from assistive tech.
 */
export function ScopeTrace({ className }: { className?: string | undefined }) {
  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      aria-hidden
      preserveAspectRatio="none"
      className={cx('block size-full font-mono', className)}
    >
      <defs>
        <filter id="scope-glow" x="-5%" y="-20%" width="110%" height="140%">
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <rect width={WIDTH} height={HEIGHT} className="fill-arena-bg" />
      <g className="stroke-arena-lattice" strokeWidth={1}>
        {Array.from({ length: 11 }, (_, i) => (
          <line key={`v${i}`} x1={i * 48} y1={0} x2={i * 48} y2={HEIGHT} />
        ))}
        {Array.from({ length: 9 }, (_, i) => (
          <line key={`h${i}`} x1={0} y1={i * 25} x2={WIDTH} y2={i * 25} />
        ))}
      </g>
      <g className="stroke-arena-ruler" strokeWidth={1}>
        <line x1={0} y1={HEIGHT / 2} x2={WIDTH} y2={HEIGHT / 2} />
        <line x1={WIDTH / 2} y1={0} x2={WIDTH / 2} y2={HEIGHT} />
      </g>
      <g filter="url(#scope-glow)" fill="none" strokeWidth={1.5} strokeLinejoin="round">
        {TRACES.map((trace) => (
          <polyline
            key={trace.seed}
            points={tracePoints(trace)}
            stroke={`var(--bot-${trace.hue})`}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </g>
    </svg>
  )
}
