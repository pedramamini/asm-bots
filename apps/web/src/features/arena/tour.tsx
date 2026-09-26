/**
 * The arena's first-visit tour (PRODUCT_SPEC §9): three coach marks, roster → fight → watch, one
 * at a time. The setup shows the first until two bots are picked, then the second on the fight
 * button; the battle shows the third on the events log. Doing a step moves the tour on; its
 * button puts the whole tour away for good (`coachMarksSeen` holds `arena`), as does leaving the
 * battle it ends on. The intro's guide takes the tour's place while it runs.
 */
import { CoachMark, Kbd } from '@asmbots/ui'

// Its id lives with the settings, so the welcome tour can mark it seen without this page's code.
export { ARENA_TOUR } from '../../store/settings'

interface StepProps {
  onDismiss: () => void
}

/** 1/3, under the first roster card's `+`. */
export function RosterStep({ onDismiss }: StepProps) {
  return (
    <CoachMark
      data-coach="arena-roster"
      placement="bottom-end"
      step="1/3"
      dismissLabel="skip the tour"
      onDismiss={onDismiss}
    >
      pick two bots or more: a card&rsquo;s + adds it to the fight.
    </CoachMark>
  )
}

/** 2/3, over the fight button. */
export function FightStep({ onDismiss }: StepProps) {
  return (
    <CoachMark
      data-coach="arena-fight"
      placement="top-start"
      step="2/3"
      dismissLabel="skip the tour"
      onDismiss={onDismiss}
    >
      fight loads them into one 64 KB core and plays the battle.
    </CoachMark>
  )
}

/** 3/3, under the events log's title, over its lines. */
export function WatchStep({ onDismiss }: StepProps) {
  return (
    <CoachMark data-coach="arena-watch" placement="inline" step="3/3" onDismiss={onDismiss}>
      <Kbd>space</Kbd> pauses; <Kbd>[</Kbd> <Kbd>]</Kbd> set the speed. every death lands in this
      log: click a line to go back to it. <Kbd>?</Kbd> lists every key.
    </CoachMark>
  )
}
