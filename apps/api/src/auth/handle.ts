/** Handles: the name in `/u/:handle`, unique in any case. */
import { isAllowedHandle } from '@asmbots/protocol'
import { randomHex } from './session'

/**
 * Handles to try, in order, for a new user whose GitHub login is `login`: the login itself, then
 * the login with a random suffix. The first-sign-in modal lets them pick another.
 */
export function handleCandidates(login: string, tries = 5): string[] {
  const base = login
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+/, '')
  const whole = base.slice(0, 24).replace(/-+$/, '')
  const stem = base.slice(0, 19).replace(/-+$/, '') || 'bot'
  const out = isAllowedHandle(whole) ? [whole] : []
  while (out.length < tries) out.push(`${stem}-${randomHex(2)}`)
  return out
}
