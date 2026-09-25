import { cx } from '@asmbots/ui'

/** The core strip's cells: 16 across, 4 down, each standing for 1 KB. */
const CORE_COLS = 16
const CORE_ROWS = 4

/** The strip's owned cells, by index: which bot (hue) holds each. */
const OWNED: Readonly<Record<number, number>> = {
  2: 0,
  3: 0,
  4: 0,
  18: 0,
  9: 3,
  10: 3,
  25: 3,
  41: 3,
  12: 6,
  28: 6,
  29: 6,
  44: 6,
  45: 6,
  34: 9,
  35: 9,
  50: 9,
  51: 9,
}

/** The cell the IP callout points at, and the dead process's. */
const IP_CELL = 51
const DEATH_CELL = 60

/** The process queue's slots round its ring: the bot each process belongs to. */
const QUEUE = [0, 3, 6, 0, 9, 3] as const

const CELL = 14
const CORE_X = 238
const CORE_Y = 56

function cellCenter(index: number): { x: number; y: number } {
  return {
    x: CORE_X + (index % CORE_COLS) * CELL + CELL / 2 - 1,
    y: CORE_Y + Math.floor(index / CORE_COLS) * CELL + CELL / 2 - 1,
  }
}

/**
 * The machine as a technical drawing (DESIGN_SYSTEM §10): the CPU, the 64 KB core with bots in
 * it, the round-robin queue, the IP at work, and a process dying on a zero byte. Hairlines in the
 * theme's tokens, so it follows the theme with no script. Art: hidden from assistive tech.
 */
export function Schematic({ className }: { className?: string | undefined }) {
  const ip = cellCenter(IP_CELL)
  const death = cellCenter(DEATH_CELL)
  return (
    <svg
      viewBox="0 0 480 270"
      aria-hidden
      className={cx('block h-auto w-full font-mono', className)}
      fontSize={9}
      letterSpacing={0.4}
    >
      <defs>
        <pattern id="schematic-grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M20 0H0V20" fill="none" className="stroke-border" strokeWidth={0.5} />
        </pattern>
        <marker
          id="schematic-arrow"
          viewBox="0 0 6 6"
          refX="5"
          refY="3"
          markerWidth="6"
          markerHeight="6"
          orient="auto"
        >
          <path d="M0 0L6 3L0 6Z" className="fill-accent" />
        </marker>
      </defs>
      <rect width="480" height="270" fill="url(#schematic-grid)" />

      {/* The CPU and its registers. */}
      <g>
        <rect x="24" y="40" width="160" height="84" rx="2" fill="none" className="stroke-accent" />
        <text x="34" y="57" className="fill-accent-fg" fontSize={10}>
          CPU · 8086
        </text>
        <text x="34" y="76" className="fill-muted">
          AX BX CX DX
        </text>
        <text x="34" y="90" className="fill-muted">
          SI DI BP SP
        </text>
        <text x="34" y="104" className="fill-muted">
          IP FLAGS
        </text>
        <text x="34" y="118" className="fill-dim" fontSize={8}>
          one instruction a turn
        </text>
      </g>

      {/* The bus to the core. */}
      <line
        x1="184"
        y1="82"
        x2="232"
        y2="82"
        className="stroke-accent"
        markerEnd="url(#schematic-arrow)"
      />
      <text x="194" y="76" className="fill-dim" fontSize={8}>
        BUS
      </text>

      {/* The core: 64 KB, a cell a kilobyte, the bots' territory in their hues. */}
      <text x={CORE_X} y="24" className="fill-text" fontSize={10}>
        CORE · 0x0000–0xFFFF
      </text>
      {/* The dimension line over the strip, its text in a gap. */}
      <g className="stroke-dim">
        <line x1={CORE_X} y1="42" x2={CORE_X + 76} y2="42" />
        <line x1={CORE_X + CORE_COLS * CELL - 76} y1="42" x2={CORE_X + CORE_COLS * CELL} y2="42" />
        <line x1={CORE_X} y1="37" x2={CORE_X} y2="47" />
        <line x1={CORE_X + CORE_COLS * CELL} y1="37" x2={CORE_X + CORE_COLS * CELL} y2="47" />
      </g>
      <text
        x={CORE_X + (CORE_COLS * CELL) / 2}
        y="45"
        textAnchor="middle"
        className="fill-dim"
        fontSize={8}
      >
        65,536 BYTES
      </text>
      {Array.from({ length: CORE_COLS * CORE_ROWS }, (_, index) => {
        const { x, y } = cellCenter(index)
        const hue = OWNED[index]
        return (
          <rect
            key={index}
            x={x - CELL / 2 + 1}
            y={y - CELL / 2 + 1}
            width={CELL - 2}
            height={CELL - 2}
            fill={hue === undefined ? 'none' : `var(--bot-${hue})`}
            fillOpacity={0.6}
            className="stroke-border-strong"
            strokeWidth={0.5}
          />
        )
      })}

      {/* The IP at work, in its bot's own territory. */}
      <circle cx={ip.x} cy={ip.y} r="8" fill="none" className="stroke-bright" />
      <polyline
        points={`${ip.x},${ip.y + 8} ${ip.x},${ip.y + 42} ${ip.x + 18},${ip.y + 42}`}
        fill="none"
        className="stroke-bright"
        strokeWidth={0.75}
      />
      <text x={ip.x + 22} y={ip.y + 39} className="fill-bright">
        IP · 0x3400
      </text>
      <text x={ip.x + 22} y={ip.y + 51} className="fill-muted">
        add bx, 4
      </text>

      {/* A process runs a zero byte and dies. */}
      <g className="stroke-danger" strokeWidth={1.25}>
        <line x1={death.x - 4} y1={death.y - 4} x2={death.x + 4} y2={death.y + 4} />
        <line x1={death.x - 4} y1={death.y + 4} x2={death.x + 4} y2={death.y - 4} />
      </g>
      <polyline
        points={`${death.x},${death.y + 8} ${death.x},${death.y + 92} ${death.x - 18},${death.y + 92}`}
        fill="none"
        className="stroke-danger"
        strokeWidth={0.75}
      />
      <text x={death.x - 22} y={death.y + 89} textAnchor="end" className="fill-danger">
        0x00 · DAT
      </text>
      <text x={death.x - 22} y={death.y + 101} textAnchor="end" className="fill-muted">
        the process dies
      </text>

      {/* The process queue: round robin, one turn each. */}
      <g>
        <rect x="24" y="152" width="160" height="96" rx="2" fill="none" className="stroke-muted" />
        <text x="34" y="169" className="fill-text" fontSize={10}>
          PROCESS QUEUE
        </text>
        <circle cx="62" cy="210" r="24" fill="none" className="stroke-dim" strokeDasharray="3 3" />
        {QUEUE.map((hue, index) => {
          const angle = (index / QUEUE.length) * Math.PI * 2 - Math.PI / 2
          return (
            <circle
              key={index}
              cx={62 + Math.cos(angle) * 24}
              cy={210 + Math.sin(angle) * 24}
              r={index === 0 ? 5 : 3.5}
              fill={`var(--bot-${hue})`}
              className={index === 0 ? 'stroke-bright' : undefined}
            />
          )
        })}
        <text x="100" y="200" className="fill-muted" fontSize={8}>
          ROUND ROBIN
        </text>
        <text x="100" y="213" className="fill-dim" fontSize={8}>
          SPL FORKS
        </text>
        <text x="100" y="226" className="fill-dim" fontSize={8}>
          ≤ 64 A BOT
        </text>
      </g>
      <line x1="104" y1="124" x2="104" y2="152" className="stroke-muted" strokeDasharray="3 3" />

      <text x="24" y="262" className="fill-dim" fontSize={8}>
        DWG 01 · X16C VM · REV 3
      </text>
    </svg>
  )
}
