import 'fake-indexeddb/auto'
import { describe, expect, it } from 'bun:test'
import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { http } from 'msw'
import { useDom, window } from '../../../packages/ui/test/dom'
import { stringifySearch } from '../src/router'
import { routeTree } from '../src/routeTree.gen'
import { testQueryClient, useApiServer } from './api-server'

useDom()
// The pages' reads never answer: the intro is there before any data.
useApiServer(http.all('*/api/*', () => new Promise<never>(() => {})))
window.scrollTo = () => {}

/** Each page that explains itself: its path, its name, a word of its lead, and its docs page. */
const PAGES = [
  ['/arena', 'the arena', 'sandbox', '/docs/start-here'],
  ['/hills', 'hills', 'king', '/docs/tournaments/hills'],
  ['/tournaments', 'tournaments', 'champion', '/docs/tournaments/formats'],
] as const

async function open(path: string) {
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
}

describe('page intros', () => {
  for (const [path, name, word, docs] of PAGES) {
    it(`${path} says what it is, and its ⓘ opens more with a docs link`, async () => {
      await open(path)
      const intro = await screen.findByRole('region', { name: `about ${name}` })
      expect(intro.textContent).toContain(word)
      expect(screen.queryByRole('dialog')).toBeNull()

      fireEvent.click(within(intro).getByRole('button', { name: `about ${name}` }))
      const dialog = await screen.findByRole('dialog', { name: `about ${name}` })
      const link = within(dialog).getByRole('link', { name: 'read the docs' })
      expect(link.getAttribute('href')).toBe(docs)

      // The header's `×` and the footer's `close` both close it.
      const [, footer] = within(dialog).getAllByRole('button', { name: 'close' })
      fireEvent.click(footer as HTMLElement)
      expect(screen.queryByRole('dialog')).toBeNull()
    })
  }
})
