import type { PlateName } from '../art'
import { Plate } from '../art/Plate'

/** The banner's box in a page intro, from `md` on: 320 px wide, the intro's height. */
export const INTRO_ART_BOX = '-my-2 hidden w-80 shrink-0 self-stretch md:block'

/**
 * A section's banner at the right end of its page intro (DESIGN_SYSTEM §10): a dither plate that
 * runs the intro's height and fades in from the text's side. `PageIntro`'s `art` takes it.
 */
export function IntroArt({ name }: { name: PlateName }) {
  return (
    <div
      className={`${INTRO_ART_BOX} [mask-image:linear-gradient(to_right,transparent,black_35%)]`}
    >
      <Plate name={name} cell={2} />
    </div>
  )
}
