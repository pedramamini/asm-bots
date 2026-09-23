/**
 * The Worker side of `determinism.worker.test.ts`: runs the determinism battle for the number of
 * cycles it receives and posts back what the run reports.
 */
import { hashedRun } from './determinism.fixture'

addEventListener('message', (e: MessageEvent<number>) => {
  postMessage(hashedRun(e.data))
})
