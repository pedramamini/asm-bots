/** Request bodies: bounded, then read as JSON. */
import { ProtocolError } from '@asmbots/protocol'
import type { Context, MiddlewareHandler } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { AppEnv } from './env'
import { errorResponse } from './middleware'

/** Refuses a body over `maxSize` bytes with a 413, before the route reads it. */
export function limitBody(maxSize: number): MiddlewareHandler<AppEnv> {
  const size = `${maxSize / 1024} KB`
  return bodyLimit({
    maxSize,
    onError: (c) => errorResponse(c, 'payload_too_large', `the body is over ${size}`),
  })
}

/** The request's body as JSON; a body that is not JSON is a `ProtocolError`, so a 400. */
export async function jsonBody(c: Context<AppEnv>): Promise<unknown> {
  try {
    return await c.req.json()
  } catch {
    throw new ProtocolError('the request body is not JSON')
  }
}
