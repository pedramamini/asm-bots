import { Chip, type ChipVariant } from '@asmbots/ui'
import { type LucideIcon, ShieldAlert, ShieldCheck, ShieldEllipsis } from 'lucide-react'
import { checkLabel, checkTitle, type ReplayCheck } from './verify'

const LOOK: Readonly<Record<ReplayCheck['state'], readonly [ChipVariant, LucideIcon]>> = {
  pending: ['neutral', ShieldEllipsis],
  verified: ['accent', ShieldCheck],
  mismatch: ['danger', ShieldAlert],
}

export interface ReplayChipProps {
  check: ReplayCheck
  /** Whether a screen reader hears it change: once on a page, where it always shows. */
  live?: boolean | undefined
  className?: string | undefined
}

/**
 * A replay's check (PRODUCT_SPEC §2, DESIGN_SYSTEM §6 `shield-check`): `verifying` until its
 * rounds end, `verified` in accent when each round's result hash matches the recorded one,
 * `mismatch` in danger when one does not. The title says why.
 */
export function ReplayChip({ check, live = false, className }: ReplayChipProps) {
  const [variant, icon] = LOOK[check.state]
  return (
    <Chip
      variant={variant}
      icon={icon}
      title={checkTitle(check)}
      data-check={check.state}
      role={live ? 'status' : undefined}
      className={className}
    >
      {checkLabel(check)}
    </Chip>
  )
}
