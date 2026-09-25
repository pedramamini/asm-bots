import { cx } from '@asmbots/ui'
import { useId } from 'react'

/** The pins on each side of the chip. */
const PINS = [14, 22, 30, 38, 46] as const

/**
 * The mark: an 8086 in its package, pins on every side, and the shell's prompt on its die (the
 * favicon's `>_`). Four cells in bot hues sit under the prompt: the core, taken. It draws in the
 * accent, so it follows the theme; `glow` gives the die a soft bloom, as the arena gives its IPs.
 */
export function LogoMark({
  size = 48,
  glow = false,
  className,
}: {
  size?: number
  glow?: boolean
  className?: string | undefined
}) {
  const filter = useId()
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 60 60"
      width={size}
      height={size}
      className={cx('shrink-0 text-accent', className)}
      fill="none"
      stroke="currentColor"
    >
      {glow && (
        <defs>
          <filter id={filter} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
      )}
      <g strokeWidth="2.5" strokeLinecap="square" opacity="0.7">
        {PINS.map((p) => (
          <g key={p}>
            <path d={`M${p} 3v5`} />
            <path d={`M${p} 52v5`} />
            <path d={`M3 ${p}h5`} />
            <path d={`M52 ${p}h5`} />
          </g>
        ))}
      </g>
      <rect x="9" y="9" width="42" height="42" rx="4" strokeWidth="2" />
      <circle cx="15.5" cy="15.5" r="1.6" fill="currentColor" stroke="none" opacity="0.7" />
      <g filter={glow ? `url(#${filter})` : undefined}>
        <path d="M17 21l8 6.5-8 6.5" strokeWidth="3.2" strokeLinecap="square" />
        <rect x="28" y="31" width="13" height="3.4" fill="currentColor" stroke="none" />
      </g>
      <g stroke="none">
        <rect x="17" y="40" width="4" height="4" style={{ fill: 'var(--bot-0)' }} />
        <rect x="23" y="40" width="4" height="4" style={{ fill: 'var(--bot-3)' }} />
        <rect x="29" y="40" width="4" height="4" style={{ fill: 'var(--bot-6)' }} />
        <rect x="35" y="40" width="4" height="4" style={{ fill: 'var(--bot-8)' }} />
      </g>
    </svg>
  )
}

/** The logo: the mark beside the name and its line. All spans: the page keeps its one `h1`. */
export function Logo({
  size = 56,
  glow = false,
  className,
}: {
  size?: number
  glow?: boolean
  className?: string | undefined
}) {
  return (
    <span className={cx('flex items-center gap-3', className)}>
      <LogoMark size={size} glow={glow} />
      <span className="flex flex-col gap-1">
        <span className="font-[700] text-[28px] text-bright leading-none tracking-[0.18em]">
          ASM BOTS
        </span>
        <span className="text-panel-title text-accent-fg">{'core war // 8086'}</span>
      </span>
    </span>
  )
}
