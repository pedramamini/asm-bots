/** The write routes the web app calls (`apps/api/src/routes`). */
import {
  HillSubmitted,
  ImportBotsResult,
  Me,
  type NewBot,
  parse,
  type Replay,
  SavedBot,
  SavedBotVersion,
  StoredReplay,
  TournamentEntered,
  TournamentStarted,
  type UpdateBot,
  UpdatedBot,
  type UpdateMe,
} from '@asmbots/protocol'
import { apiDelete, apiPatch, apiPost } from './client'

const segment = encodeURIComponent

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

/** `POST /api/bots`: a new bot in the account, at version 1. */
export function createBot(bot: NewBot): Promise<SavedBot> {
  return apiPost('/bots', bot, (v) => parse(SavedBot, v, 'the bot'))
}

/** `PATCH /api/bots/:id`: a new name or visibility. */
export function updateBot(id: string, update: UpdateBot): Promise<UpdatedBot> {
  return apiPatch(`/bots/${segment(id)}`, update, (v) => parse(UpdatedBot, v, 'the bot'))
}

/** `POST /api/bots/:id/versions`: the next version, or the latest when its bytes are the same. */
export function addBotVersion(id: string, source: string): Promise<SavedBotVersion> {
  return apiPost(`/bots/${segment(id)}/versions`, { source }, (v) =>
    parse(SavedBotVersion, v, 'the version'),
  )
}

/** `POST /api/hills/:slug/submit`: a version of one of my bots challenges the hill; its job starts. */
export function submitToHill(slug: string, botVersionId: string): Promise<HillSubmitted> {
  return apiPost(`/hills/${segment(slug)}/submit`, { botVersionId }, (v) =>
    parse(HillSubmitted, v, 'the submission'),
  )
}

/**
 * `POST /api/tournaments/:id/enter`: a version of one of my bots enters an open tournament; one
 * entry a user, so it replaces the one I had.
 */
export function enterTournament(id: string, botVersionId: string): Promise<TournamentEntered> {
  return apiPost(`/tournaments/${segment(id)}/enter`, { botVersionId }, (v) =>
    parse(TournamentEntered, v, 'the entry'),
  )
}

/** `POST /api/tournaments/:id/start`: its owner starts it; its `Runner` plays it. */
export function startTournament(id: string): Promise<TournamentStarted> {
  return apiPost(`/tournaments/${segment(id)}/start`, {}, (v) =>
    parse(TournamentStarted, v, 'the start'),
  )
}

/** `DELETE /api/bots/:id` */
export function deleteBot(id: string): Promise<void> {
  return apiDelete(`/bots/${segment(id)}`)
}

/** `DELETE /api/me`: deletes the account, its cloud bots, and every session it has. */
export function deleteAccount(): Promise<void> {
  return apiDelete('/me')
}

/** `POST /api/auth/logout`: ends the session here and on the server. */
export async function signOut(): Promise<void> {
  await apiPost('/auth/logout', {}, () => undefined)
}

/** Where `sign in with github` goes: GitHub, then back to `returnTo` on this site. */
export function signInHref(returnTo: string): string {
  return `/api/auth/github?returnTo=${encodeURIComponent(returnTo)}`
}
