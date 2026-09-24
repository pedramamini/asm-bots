/**
 * The arena Worker without a Worker, for the tests of what drives one: an `ArenaSession` in the
 * test's own thread behind the Worker's interface, and display frames that come when the test
 * says. A real `ArenaClient` runs on them.
 */
import { ArenaClient, createArenaStore, type Schedule } from '../src/features/arena/worker/client'
import type { ArenaMessage, ArenaRequest } from '../src/features/arena/worker/protocol'
import { ArenaSession } from '../src/features/arena/worker/session'

/** An `ArenaSession` behind the Worker's interface: requests in, messages out a moment later. */
export class SessionWorker {
  readonly session = new ArenaSession()
  /** The requests posted, in order. */
  readonly sent: ArenaRequest[] = []
  terminated = false
  private listener: ((event: { data: ArenaMessage }) => void) | null = null

  addEventListener(type: string, listener: (event: { data: ArenaMessage }) => void): void {
    if (type === 'message') this.listener = listener
  }

  postMessage(request: ArenaRequest): void {
    this.sent.push(request)
    const messages = this.session.handle(request)
    queueMicrotask(() => {
      for (const message of messages) this.listener?.({ data: message })
    })
  }

  terminate(): void {
    this.terminated = true
  }
}

/** Display frames that come only when the test calls `tick`. */
export function manualSchedule(): { schedule: Schedule; tick: () => void } {
  let pending: (() => void) | null = null
  return {
    schedule: (callback) => {
      pending = callback
      return () => {
        pending = null
      }
    },
    tick: () => {
      const callback = pending
      pending = null
      callback?.()
    },
  }
}

/** A client on a `SessionWorker`, with a store of its own, paced by `schedule`. */
export function sessionClient(schedule: Schedule): { client: ArenaClient; worker: SessionWorker } {
  const worker = new SessionWorker()
  const client = new ArenaClient({
    worker: worker as unknown as Worker,
    store: createArenaStore(),
    schedule,
  })
  return { client, worker }
}
