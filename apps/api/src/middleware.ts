/** The API's middleware: request logging, CORS, and the protocol error shape. */
import { apiError, ERROR_STATUS, type ErrorCode, ProtocolError } from '@asmbots/protocol'
import type { Context, ErrorHandler, MiddlewareHandler } from 'hono'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { AppEnv } from './env'

/** One structured JSON line per event; `wrangler tail` and Workers Logs parse it. */
export function log(level: 'info' | 'warn' | 'error', msg: string, fields: object = {}): void {
  const line = JSON.stringify({ level, msg, ...fields })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

/** One log line per request, after the response. */
export const requestLog: MiddlewareHandler<AppEnv> = async (c, next) => {
  const start = Date.now()
  await next()
  log(c.res.status >= 500 ? 'error' : 'info', 'request', {
    requestId: c.get('requestId'),
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    ms: Date.now() - start,
  })
}

/** CORS for the app's origin only; the deployed app is same-origin and needs none. */
export const appCors: MiddlewareHandler<AppEnv> = (c, next) =>
  cors({
    origin: (origin) => (origin === c.env.APP_ORIGIN ? origin : null),
    allowMethods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowHeaders: ['Content-Type'],
    exposeHeaders: ['X-Request-Id', 'Retry-After'],
    credentials: true,
    maxAge: 600,
  })(c, next)

/** Whether `path` is the API's: `/api` and under it. */
export function isApi(path: string): boolean {
  return path === '/api' || path.startsWith('/api/')
}

/** The API's content policy. */
const API_CSP =
  "default-src 'self'; img-src 'self' data: https://avatars.githubusercontent.com; connect-src 'self' wss:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'"

/**
 * Security headers: HSTS on everything; the API's content policy on its answers; on the web app's
 * files, who may frame them: the site itself, and anyone for an embed (`/embed/*`, made for other
 * sites' `<iframe>`s).
 */
export const securityHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next()
  c.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
  const path = c.req.path
  const frame = path === '/embed' || path.startsWith('/embed/') ? '*' : "'self'"
  c.header('Content-Security-Policy', isApi(path) ? API_CSP : `frame-ancestors ${frame}`)
}

/** The code for an HTTP status, when the protocol has one. */
const CODE_OF = new Map<number, ErrorCode>(
  Object.entries(ERROR_STATUS).map(([code, status]) => [status, code as ErrorCode]),
)

/** A JSON error response in the protocol shape. */
export function errorResponse(c: Context, code: ErrorCode, message: string): Response {
  return c.json(apiError(code, message), ERROR_STATUS[code] as ContentfulStatusCode)
}

/** Every thrown error becomes `{ error: { code, message } }`. */
export const onError: ErrorHandler<AppEnv> = (err, c) => {
  if (err instanceof ProtocolError) return errorResponse(c, 'bad_request', err.message)
  if (err instanceof HTTPException) {
    const code = CODE_OF.get(err.status)
    if (code) return errorResponse(c, code, err.message || code.replaceAll('_', ' '))
  }
  const requestId = c.get('requestId')
  log('error', 'unhandled', {
    requestId,
    path: c.req.path,
    error: err instanceof Error ? (err.stack ?? err.message) : String(err),
  })
  return errorResponse(c, 'internal', `internal error (request ${requestId})`)
}
