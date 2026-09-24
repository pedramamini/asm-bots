/**
 * The API's client: `GET` and `POST /api/...` on the page's own origin (in dev, Vite proxies it to
 * `wrangler dev`). A response is read through its protocol schema, so a page gets typed records or
 * an error that says what went wrong.
 */
import { ApiError, ProtocolError } from '@asmbots/protocol'

/** A request the API refused or failed, or a response that was not what the protocol says. */
export class ApiRequestError extends Error {
  override readonly name = 'ApiRequestError'
  constructor(
    /** The HTTP status; 0 when the request never got an answer. */
    readonly status: number,
    /** The protocol error code: `not_found`, or `network`, or `bad_response`. */
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

/** `/api<path>` on this page's origin. */
export function apiUrl(path: string): string {
  return new URL(`/api${path}`, globalThis.location?.origin ?? 'http://localhost').href
}

/** `GET /api<path>`, its JSON body as `read` takes it. */
export function apiGet<T>(
  path: string,
  read: (value: unknown) => T,
  signal?: AbortSignal,
): Promise<T> {
  return request(path, { headers: { Accept: 'application/json' } }, read, signal)
}

/** `POST /api<path>` with `body` as JSON, its JSON answer as `read` takes it. */
export function apiPost<T>(
  path: string,
  body: unknown,
  read: (value: unknown) => T,
  signal?: AbortSignal,
): Promise<T> {
  const init = {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
  return request(path, init, read, signal)
}

async function request<T>(
  path: string,
  init: RequestInit,
  read: (value: unknown) => T,
  signal: AbortSignal | undefined,
): Promise<T> {
  let res: Response
  try {
    res = await fetch(apiUrl(path), { ...init, signal: signal ?? null })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new ApiRequestError(0, 'network', 'the server did not answer.')
  }
  const body: unknown = await res.json().catch(() => undefined)
  if (!res.ok) {
    const shaped = ApiError.safeParse(body)
    throw shaped.success
      ? new ApiRequestError(res.status, shaped.data.error.code, shaped.data.error.message)
      : new ApiRequestError(res.status, 'internal', `the server answered ${res.status}.`)
  }
  try {
    return read(body)
  } catch (error) {
    if (error instanceof ProtocolError) {
      throw new ApiRequestError(res.status, 'bad_response', error.message)
    }
    throw error
  }
}

/** Whether `error` is the API's answer that the thing is not there. */
export function isNotFound(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 404
}

/** Retry a failed query twice, but not when the API has answered: a 4xx will not change. */
export function shouldRetry(failures: number, error: unknown): boolean {
  if (error instanceof ApiRequestError && error.status >= 400 && error.status < 500) return false
  return failures < 2
}
