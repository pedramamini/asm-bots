import { describe, expect, it } from 'bun:test'
import { restore, resultHash, snapshot } from '../src/index'
import { BOTS, CONFIG, hashedRun, type Run } from './determinism.fixture'

/** Runs the determinism battle for `cycles` cycles in a new Worker and returns its report. */
async function inWorker(cycles: number): Promise<Run> {
  const worker = new Worker(new URL('./determinism.worker.ts', import.meta.url))
  try {
    return await new Promise<Run>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<Run>) => resolve(e.data)
      worker.onerror = (e) => reject(new Error(`worker: ${e.message}`))
      worker.postMessage(cycles)
    })
  } finally {
    worker.terminate()
  }
}

describe('determinism in a Worker (ISA §5.6)', () => {
  it('runs the battle to the hashes and the state of the main thread', async () => {
    const got = await inWorker(Number.POSITIVE_INFINITY)
    const want = hashedRun()
    expect(got.eventHash).toBe(want.eventHash)
    expect(got.resultHash).toBe(want.resultHash)
    expect(got.snapshot).toEqual(want.snapshot)
  })

  it('posts a snapshot that restores on the main thread', async () => {
    const got = await inWorker(500)
    expect(got.snapshot.cycle).toBe(500)
    const battle = restore(got.snapshot, BOTS, CONFIG)
    const want = hashedRun()
    expect(resultHash(battle.run() ?? battle.result())).toBe(want.resultHash)
    expect(snapshot(battle)).toEqual(want.snapshot)
  })
})
