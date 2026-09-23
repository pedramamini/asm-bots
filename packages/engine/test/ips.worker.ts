/**
 * The Worker side of the speed test in `ips.test.ts`. A Worker's JIT has seen no other test, so
 * it times the bench battle as `bench/ips.ts` does: a warm-up run, then the runs it receives.
 * Posts back the instructions per second of each run.
 */
import { CYCLES, measure } from '../bench/workload'

addEventListener('message', (e: MessageEvent<number>) => {
  measure(CYCLES / 10)
  const rates = Array.from({ length: e.data }, () => {
    const m = measure()
    return m.instructions / m.seconds
  })
  postMessage(rates)
})
