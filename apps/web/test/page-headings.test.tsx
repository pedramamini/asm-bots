import 'fake-indexeddb/auto'
import { describe, expect, it } from 'bun:test'
import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { act, render, screen } from '@testing-library/react'
import { http } from 'msw'
import { useDom, window } from '../../../packages/ui/test/dom'
import { stringifySearch } from '../src/router'
import { routeTree } from '../src/routeTree.gen'
import { testQueryClient, useApiServer } from './api-server'

useDom()
// The pages' reads never answer: the heading is there before any data.
useApiServer(http.all('*/api/*', () => new Promise<never>(() => {})))
window.scrollTo = () => {}

/** Each route whose page shows its name only in the chrome, and the `<h1>` it gets. */
const PAGES: readonly (readonly [path: string, heading: string])[] = [
  ['/arena', 'arena'],
  ['/tournaments', 'tournaments'],
  ['/tournaments/t-7', 'tournament'],
  ['/hills', 'hills'],
  ['/hills/main', 'hill main'],
  ['/settings', 'settings'],
  ['/no/such/address', '0x404'],
]

describe('page headings', () => {
  for (const [path, heading] of PAGES) {
    it(`${path} has one <h1>, "${heading}", hidden from sight`, async () => {
      const router = createRouter({
        routeTree,
        context: { queryClient: testQueryClient() },
        history: createMemoryHistory({ initialEntries: [path] }),
        stringifySearch,
      })
      render(
        <QueryClientProvider client={router.options.context.queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>,
      )
      await act(() => router.load())
      const h1 = await screen.findByRole('heading', { level: 1 })
      expect(h1.textContent).toBe(heading)
      expect(h1.className).toBe('sr-only')
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    })
  }
})
