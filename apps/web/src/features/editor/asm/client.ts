/**
 * The editor's end of the assembler Worker (`asm.worker.ts`): `assemble(source)` posts a request
 * and resolves with its answer. Should the Worker fail (it did not load, or it crashed), the
 * client assembles on the main thread from then on, the requests in flight included: the editor
 * gets slower, never stuck.
 */
import type { AsmReply, AsmRequest, AsmResult } from './protocol'
import { assembleSource } from './run'

export interface AsmClientOptions {
  /** The Worker to drive. Default: a new `asm.worker.ts`; none where there is no `Worker`. */
  readonly worker?: Worker | null
}

interface Waiting {
  readonly source: string
  readonly resolve: (result: AsmResult) => void
  readonly reject: (error: Error) => void
}

export class AsmClient {
  private readonly worker: Worker | null
  private readonly waiting = new Map<number, Waiting>()
  private nextId = 1
  private disposed = false
  /** Whether the client assembles on the main thread: no Worker, or it failed. */
  private local: boolean

  constructor(options: AsmClientOptions = {}) {
    this.worker =
      options.worker === undefined
        ? typeof Worker === 'function'
          ? new Worker(new URL('./asm.worker.ts', import.meta.url), { type: 'module', name: 'asm' })
          : null
        : options.worker
    this.local = this.worker === null
    this.worker?.addEventListener('message', (event: MessageEvent<AsmReply>) => {
      this.receive(event.data)
    })
    this.worker?.addEventListener('error', () => this.fallBack())
    this.worker?.addEventListener('messageerror', () => this.fallBack())
  }

  /** Whether the assembles run on the main thread (no Worker, or it failed). */
  get inThread(): boolean {
    return this.local
  }

  /** Assembles and lints `source`. Rejects only once the client is disposed. */
  assemble(source: string): Promise<AsmResult> {
    if (this.disposed) return Promise.reject(new Error('the assembler is closed'))
    if (this.local || this.worker === null) {
      return Promise.resolve().then(() => assembleSource(source))
    }
    const id = this.nextId++
    const worker = this.worker
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { source, resolve, reject })
      worker.postMessage({ id, source } satisfies AsmRequest)
    })
  }

  /** Ends the Worker. Requests in flight reject. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.worker?.terminate()
    const closed = new Error('the assembler is closed')
    for (const waiting of this.waiting.values()) waiting.reject(closed)
    this.waiting.clear()
  }

  private receive(reply: AsmReply): void {
    const waiting = this.waiting.get(reply.id)
    if (waiting === undefined) return
    this.waiting.delete(reply.id)
    // The Worker could not assemble this one (an assembler bug): the main thread tries, and a
    // bug that throws there too rejects.
    if ('error' in reply) this.assembleHere(waiting)
    else waiting.resolve(reply.result)
  }

  /** The Worker is gone: assemble what it owed, and all that comes, on the main thread. */
  private fallBack(): void {
    if (this.disposed || this.local) return
    this.local = true
    this.worker?.terminate()
    const owed = [...this.waiting.values()]
    this.waiting.clear()
    for (const waiting of owed) this.assembleHere(waiting)
  }

  private assembleHere(waiting: Waiting): void {
    try {
      waiting.resolve(assembleSource(waiting.source))
    } catch (error) {
      waiting.reject(error instanceof Error ? error : new Error(String(error)))
    }
  }
}
