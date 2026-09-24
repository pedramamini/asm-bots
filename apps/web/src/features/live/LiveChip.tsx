import { Chip, type ChipVariant, cx } from '@asmbots/ui'
import { Eye } from 'lucide-react'
import { useMotionReduced } from '../../store/settings'
import type { LiveStatus } from './room'

const LOOK: Readonly<
  Record<
    LiveStatus,
    { readonly variant: ChipVariant; readonly label: string; readonly title: string }
  >
> = {
  idle: { variant: 'neutral', label: 'offline', title: 'not joined to the live room' },
  connecting: { variant: 'neutral', label: 'connecting', title: 'joining the live room' },
  live: { variant: 'accent', label: 'live', title: 'hearing the live room as it happens' },
  reconnecting: {
    variant: 'warn',
    label: 'reconnecting',
    title: 'the live room dropped: joining it again',
  },
  full: {
    variant: 'warn',
    label: 'room full',
    title: 'the live room is full: trying again in a minute',
  },
  outdated: {
    variant: 'danger',
    label: 'reload',
    title: 'the site has a new version: reload the page to watch',
  },
}

export interface LiveChipProps {
  status: LiveStatus
  /** A job is running in the room: the chip's dot pulses (PRODUCT_SPEC §4). */
  busy: boolean
}

/**
 * The live room's state (PRODUCT_SPEC §4): `LIVE` in accent with a glowing dot once the socket
 * hears the room, pulsing while a job runs (steady under reduced motion); `connecting`,
 * `reconnecting`, `room full`, or `reload` otherwise. The title says what each means.
 */
export function LiveChip({ status, busy }: LiveChipProps) {
  const reduced = useMotionReduced()
  const { variant, label, title } = LOOK[status]
  const live = status === 'live'
  return (
    <Chip
      variant={variant}
      title={title}
      data-status={status}
      data-live={live && busy ? 'true' : undefined}
    >
      <span
        aria-hidden="true"
        className={cx(
          'size-1.5 rounded-full bg-current',
          live && 'shadow-[0_0_6px_currentColor]',
          live && busy && !reduced && 'animate-skeleton',
        )}
      />
      {label}
    </Chip>
  )
}

/** `3 watching`: the sockets on the room, the reader's among them. Nothing until the room says. */
export function SpectatorCount({ count }: { count: number | null }) {
  if (count === null) return null
  return (
    <Chip icon={Eye} title="spectators in this room, you among them" data-spectators={count}>
      {count.toLocaleString('en-US')} watching
    </Chip>
  )
}
