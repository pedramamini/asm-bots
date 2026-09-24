/**
 * The Worker: `/api/*` in Hono, everything else from the web app's static assets (ARCHITECTURE
 * §7). No Node built-ins here or in anything it imports: the engine and tourney run unchanged.
 */
import { Hono } from 'hono'
import { requestId } from 'hono/request-id'
import { scheduled } from './cron'
import type { AppEnv, Env } from './env'
import { appCors, errorResponse, onError, requestLog } from './middleware'
import { rateLimit, WRITE_LIMIT } from './rate-limit'
import { health } from './routes/health'
import { version } from './routes/version'

const app = new Hono<AppEnv>()

app.use(requestId())
app.use(requestLog)
app.use('/api/*', appCors)
app.on(['POST', 'PUT', 'PATCH', 'DELETE'], '/api/*', rateLimit(WRITE_LIMIT))

app.route('/api/health', health)
app.route('/api/version', version)

app.onError(onError)
app.notFound((c) =>
  c.req.path === '/api' || c.req.path.startsWith('/api/')
    ? errorResponse(c, 'not_found', `no route for ${c.req.method} ${c.req.path}`)
    : c.env.ASSETS.fetch(c.req.raw),
)

export { LiveRoom } from './durable/live-room'
export { Runner } from './durable/runner'

export default {
  fetch: app.fetch,
  scheduled,
} satisfies ExportedHandler<Env>
