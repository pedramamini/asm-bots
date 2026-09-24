/**
 * The API as a test sees it: `msw` answers the page's `fetch` to `/api/...`, and each render gets
 * its own query cache that does not retry, so an error shows at once.
 */
import { afterAll, afterEach, beforeAll } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HttpResponse, http, type RequestHandler } from 'msw'
import { setupServer } from 'msw/node'
import type { ReactNode } from 'react'

/** An msw server for the file's tests: `handlers` by default, a test's own through `server.use`. */
export function useApiServer(...handlers: RequestHandler[]) {
  const server = setupServer(...handlers)
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
  afterEach(() => server.resetHandlers())
  afterAll(() => server.close())
  return server
}

/** `GET /api<path>` answers `body` as JSON. */
export function answer(path: string, body: unknown, status = 200) {
  return http.get(`*/api${path}`, () => HttpResponse.json(body as object, { status }))
}

/** `GET /api<path>` answers with the protocol's error shape. */
export function refuse(path: string, status: number, code: string, message: string) {
  return answer(path, { error: { code, message } }, status)
}

/** `POST /api<path>` answers `body` as JSON, and puts each request's JSON body in `seen`. */
export function answerPost(path: string, body: unknown, status = 200, seen: unknown[] = []) {
  return http.post(`*/api${path}`, async ({ request }) => {
    seen.push(await request.json())
    return HttpResponse.json(body as object, { status })
  })
}

/** `GET /api<path>` never answers: the page stays loading. */
export function hang(path: string) {
  return http.get(`*/api${path}`, () => new Promise<never>(() => {}))
}

export function testQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

export function WithQueries({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={testQueryClient()}>{children}</QueryClientProvider>
}
