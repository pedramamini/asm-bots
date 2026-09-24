import type { Env } from './env'
import { log } from './middleware'

/**
 * The weekly championship (`triggers.crons` in `wrangler.jsonc`). A stub until 3.3, when it
 * enqueues a tournament into a `Runner`.
 */
export async function scheduled(controller: ScheduledController, _env: Env): Promise<void> {
  log('info', 'cron', { cron: controller.cron, scheduledTime: controller.scheduledTime })
}
