/**
 * Plays golden matchups in a Worker: post it a list of `GoldenMatchup`s and it posts back
 * `playGoldens` of them. `scripts/golden.ts` and `test/goldens.test.ts` check that a Worker plays
 * every golden to the results of the main thread (ISA §5.6).
 */
import { type GoldenMatchup, playGoldens } from './goldens'

addEventListener('message', (e: MessageEvent<readonly GoldenMatchup[]>) => {
  postMessage(playGoldens(e.data))
})
