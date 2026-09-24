/** The write routes the web app calls (`apps/api/src/routes`). */
import { parse, type Replay, StoredReplay } from '@asmbots/protocol'
import { apiPost } from './client'

/** `POST /api/replays`: the server runs `replay`'s match again, then keeps it under its key. */
export function storeReplay(replay: Replay, signal?: AbortSignal): Promise<StoredReplay> {
  return apiPost('/replays', { replay }, (v) => parse(StoredReplay, v, 'the answer'), signal)
}
