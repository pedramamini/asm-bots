/**
 * The API as a test sees it: `msw` answers the page's `fetch` to `/api/...` and its live rooms'
 * sockets, and each render gets its own query cache that does not retry, so an error shows at
 * once. `renderAt` puts a page in a memory router that knows the app's other pages as stubs.
 */
import { afterAll, afterEach, beforeAll } from 'bun:test'
import { ToastProvider } from '@asmbots/ui'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { act, render } from '@testing-library/react'
import { HttpResponse, http, type RequestHandler, type WebSocketHandler, ws } from 'msw'
import { setupServer } from 'msw/node'
import type { ReactNode } from 'react'

/**
 * The live rooms' sockets (`/api/live/:room`): one a page opens hears nothing, unless a test adds
 * a listener, `server.use(liveRooms.addEventListener('connection', ...))`.
 */
export const liveRooms = ws.link('*/api/live/*')

/**
 * An msw server for the file's tests: `handlers` by default, silent live rooms, and a ticker feed
 * that never comes (the frame's ticker keeps its quiet line); a test's own through `server.use`.
 */
export function useApiServer(...handlers: (RequestHandler | WebSocketHandler)[]) {
  const server = setupServer(
    liveRooms.addEventListener('connection', () => {}),
    ...handlers,
    hang('/ticker'),
  )
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

/** The pages a test router knows beside the one under test: each a stub that names itself. */
const STUBS = [
  '/',
  '/hills',
  '/hills/$slug',
  '/bots/$id',
  '/u/$handle',
  '/arena',
  '/arena/$replayId',
  '/editor',
]

/**
 * `content` at `url` (its path, and any query) of a memory router that knows the app's pages by
 * name, with queries and toasts: on a route of its own, `path` (`/hills/$slug`), or `url`'s path.
 * Resolves once the router has loaded.
 */
export async function renderAt(
  url: string,
  content: () => ReactNode,
  path = url.split(/[?#]/)[0] as string,
) {
  const root = createRootRoute({ component: Outlet })
  const at = (routePath: string, component: () => ReactNode) =>
    createRoute({ getParentRoute: () => root, path: routePath, component })
  const router = createRouter({
    routeTree: root.addChildren([
      at(path, content),
      ...STUBS.filter((p) => p !== path).map((p) => at(p, () => <p>page {p}</p>)),
    ]),
    history: createMemoryHistory({ initialEntries: [url] }),
  })
  render(
    <WithQueries>
      <ToastProvider>
        <RouterProvider router={router as never} />
      </ToastProvider>
    </WithQueries>,
  )
  await act(() => router.load())
  return router
}
