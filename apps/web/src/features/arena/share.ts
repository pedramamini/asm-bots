/**
 * Share links (PRODUCT_SPEC §10): the setup's `copy a share link`, the victory's `share`, and the
 * replay links of `replay link` and of `/arena/$replayId`.
 */
import type { ToastApi } from '@asmbots/ui'
import { type ArenaSetupSpec, type SharedBot, shareUrl } from './setup/url'

/**
 * Copies `url` and says `done` in a toast, or that it could not. Returns the link, or null when
 * the clipboard refused it.
 */
export async function copyLink(
  url: string,
  toast: ToastApi['toast'],
  done: string,
): Promise<string | null> {
  try {
    await navigator.clipboard.writeText(url)
    toast(done, { variant: 'accent' })
    return url
  } catch {
    toast('could not copy the link.', { variant: 'danger' })
    return null
  }
}

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
