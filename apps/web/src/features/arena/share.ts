/**
 * Share links (PRODUCT_SPEC §10): the setup's `copy a share link`, the victory's `share`, and the
 * replay links of `replay link` and of `/arena/$replayId`.
 */
import type { ToastApi } from '@asmbots/ui'
import { copyLink } from '../share/share'
import { type ArenaSetupSpec, type SharedBot, shareUrl } from './setup/url'

export { copyLink }

/**
 * Copies the link of `spec`, with the sources of `bots` in its fragment, and says so in a toast.
 * Returns the link, or null when the clipboard refused it.
 */
export function copyShareLink(
  spec: ArenaSetupSpec,
  bots: readonly SharedBot[],
  toast: ToastApi['toast'],
): Promise<string | null> {
  const inside =
    bots.length === 0
      ? ''
      : ` with ${bots.length} local ${bots.length === 1 ? 'bot' : 'bots'} inside`
  return copyLink(shareUrl(window.location.origin, spec, bots), toast, `link copied${inside}.`)
}
