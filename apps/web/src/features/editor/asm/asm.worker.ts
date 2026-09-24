/**
 * The assembler Worker (ARCHITECTURE §6: lint via `@asmbots/asm` on a debounce): it assembles and
 * lints the editor's source off the main thread, so a keystroke never waits for it. `protocol.ts`
 * has the messages; `client.ts` is the other end.
 */
import type { AsmReply, AsmRequest } from './protocol'
import { assembleSource } from './run'

const scope = self as unknown as DedicatedWorkerGlobalScope

scope.addEventListener('message', (event: MessageEvent<AsmRequest>) => {
  const { id, source } = event.data
  let reply: AsmReply
  try {
    reply = { id, result: assembleSource(source) }
  } catch (error) {
    reply = { id, error: error instanceof Error ? error.message : String(error) }
  }
  scope.postMessage(reply)
})
