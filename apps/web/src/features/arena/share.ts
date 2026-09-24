/**
 * Share links (PRODUCT_SPEC §10): the setup's `copy a share link`, and the victory's `share`.
 */
import type { ToastApi } from '@asmbots/ui'
import { type ArenaSetupSpec, type SharedBot, shareUrl } from './setup/url'

/**
 * Copies the link of `spec`, with the sources of `bots` in its fragment, and says so in a toast.
 * Returns the link, or null when the clipboard refused it.
 */
export async function copyShareLink(
  spec: ArenaSetupSpec,
  bots: readonly SharedBot[],
  toast: ToastApi['toast'],
): Promise<string | null> {
  const url = shareUrl(window.location.origin, spec, bots)
  try {
    await navigator.clipboard.writeText(url)
    const inside =
      bots.length === 0
        ? ''
        : ` with ${bots.length} local ${bots.length === 1 ? 'bot' : 'bots'} inside`
    toast(`link copied${inside}.`, { variant: 'accent' })
    return url
  } catch {
    toast('could not copy the link.', { variant: 'danger' })
    return null
  }
}
