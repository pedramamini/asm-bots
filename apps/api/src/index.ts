/**
 * The Worker: `/api/*` in Hono, everything else from the web app's static assets (ARCHITECTURE
 * §7). No Node built-ins here or in anything it imports: the engine and tourney run unchanged.
 */
import { Hono } from 'hono'
import { requestId } from 'hono/request-id'
import { auth } from './auth/github'
import { loadSession, sameOrigin } from './auth/session'
import { scheduled } from './cron'
import type { AppEnv, Env } from './env'
import { appCors, errorResponse, onError, requestLog } from './middleware'
import {
  ASSEMBLE_LIMIT,
  AUTH_LIMIT,
  BOTS_LIMIT,
  REPLAYS_LIMIT,
  rateLimit,
  SUBMIT_LIMIT,
  WRITE_LIMIT,
} from './rate-limit'
import { assembler } from './routes/assemble'
import { bots } from './routes/bots'
import { health } from './routes/health'
import { hills } from './routes/hills'
import { me } from './routes/me'
import { replays } from './routes/replays'
import { tournaments } from './routes/tournaments'
import { users } from './routes/users'
import { version } from './routes/version'

const app = new Hono<AppEnv>()

app.use(requestId())
app.use(requestLog)
app.use('/api/*', appCors)
app.on(['POST', 'PUT', 'PATCH', 'DELETE'], '/api/*', sameOrigin)
// The session before the limits: they count a signed-in user's requests by user, not by IP.
app.use('/api/*', loadSession)
app.on(['POST', 'PUT', 'PATCH', 'DELETE'], '/api/*', rateLimit(WRITE_LIMIT))
app.use('/api/auth/*', rateLimit(AUTH_LIMIT))
app.post('/api/assemble', rateLimit(ASSEMBLE_LIMIT))
// `/api/bots/*` covers `/api/bots` too: a second pattern for it would count each request twice.
app.post('/api/bots/*', rateLimit(BOTS_LIMIT))
app.post('/api/replays', rateLimit(REPLAYS_LIMIT))
app.post('/api/hills/:slug/submit', rateLimit(SUBMIT_LIMIT))

app.route('/api/health', health)
app.route('/api/version', version)
app.route('/api/auth', auth)
app.route('/api/me', me)
app.route('/api/assemble', assembler)
app.route('/api/bots', bots)
app.route('/api/hills', hills)
app.route('/api/replays', replays)
app.route('/api/tournaments', tournaments)
app.route('/api/users', users)

app.onError(onError)
app.notFound((c) =>
  c.req.path === '/api' || c.req.path.startsWith('/api/')
    ? errorResponse(c, 'not_found', `no route for ${c.req.method} ${c.req.path}`)
    : c.env.ASSETS.fetch(c.req.raw),
)

export { LiveRoom } from './do/live-room'
export { Runner } from './do/runner'

export default {
  fetch: app.fetch,
  scheduled,
} satisfies ExportedHandler<Env>
