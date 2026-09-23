/**
 * The arena Worker (ARCHITECTURE §6): an `ArenaSession` behind `postMessage`. It runs cycles only
 * when a request asks, never on its own. `protocol.ts` has the messages; `client.ts` is the other
 * end. Every typed array it sends is transferred.
 */
import type { ArenaMessage, ArenaRequest } from './protocol'
import { ArenaSession } from './session'

const scope = self as unknown as DedicatedWorkerGlobalScope
const session = new ArenaSession()

scope.addEventListener('message', (event: MessageEvent<ArenaRequest>) => {
  for (const message of session.handle(event.data)) {
    scope.postMessage(message, transferList(message))
  }
})

/** The buffers of a message's typed arrays. Each array has a buffer of its own. */
function transferList(message: ArenaMessage): ArrayBuffer[] {
  if (message.type !== 'frame') return []
  const { writes, execs, ips, spawns, deaths, botDeaths, stats, ownerDirty, bytesDirty } = message
  const arrays = [writes, execs, ips, spawns, deaths, botDeaths, stats, ownerDirty, bytesDirty]
  return arrays.flatMap((a) => (a === null ? [] : [a.buffer as ArrayBuffer]))
}
