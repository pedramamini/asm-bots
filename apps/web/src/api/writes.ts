/** The write routes the web app calls (`apps/api/src/routes`). */
import {
  ImportBotsResult,
  Me,
  type NewBot,
  parse,
  type Replay,
  StoredReplay,
  type UpdateMe,
} from '@asmbots/protocol'
import { apiPatch, apiPost } from './client'

/** `POST /api/replays`: the server runs `replay`'s match again, then keeps it under its key. */
export function storeReplay(replay: Replay, signal?: AbortSignal): Promise<StoredReplay> {
  return apiPost('/replays', { replay }, (v) => parse(StoredReplay, v, 'the answer'), signal)
}

/** `PATCH /api/me`: a new handle; the first one finishes the first sign-in. */
export function updateMe(update: UpdateMe): Promise<Me> {
  return apiPatch('/me', update, (v) => parse(Me, v, 'your account'))
}

/** `POST /api/bots/import`: local bots kept in the account, one result each, in order. */
export function importBots(bots: readonly NewBot[]): Promise<ImportBotsResult> {
  return apiPost('/bots/import', { bots }, (v) => parse(ImportBotsResult, v, 'the import'))
}

/** `POST /api/auth/logout`: ends the session here and on the server. */
export async function signOut(): Promise<void> {
  await apiPost('/auth/logout', {}, () => undefined)
}

/** Where `sign in with github` goes: GitHub, then back to `returnTo` on this site. */
export function signInHref(returnTo: string): string {
  return `/api/auth/github?returnTo=${encodeURIComponent(returnTo)}`
}
