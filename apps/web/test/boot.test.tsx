import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { http } from 'msw'
import { useDom, window } from '../../../packages/ui/test/dom'
import { BOOT_LOG } from '../src/app/boot/BootScreen'
import { armBoot, shouldBoot, useBoot, WELCOME_TOUR } from '../src/app/boot/boot'
import { TOUR_STEPS } from '../src/app/boot/WelcomeTour'
import { INTRO_SEED } from '../src/features/arena/intro'
import { stringifySearch } from '../src/router'
import { routeTree } from '../src/routeTree.gen'
import { useSettings } from '../src/store/settings'
import { testQueryClient, useApiServer } from './api-server'

useDom()
// The pages' reads never answer: the boot and the tour need none.
useApiServer(http.all('*/api/*', () => new Promise<never>(() => {})))
window.scrollTo = () => {}

beforeEach(() => {
  // Reduced motion: the boot log shows whole, and `enter` goes at once, with no fade.
  useSettings.setState({ coachMarksSeen: [], motion: 'reduce' })
  useBoot.setState({ phase: 'off' })
  window.sessionStorage.clear()
})

afterEach(() => {
  // The stores outlive the file: the next file's pages must not open under a boot or a tour.
  useBoot.setState({ phase: 'off' })
  useSettings.setState({ coachMarksSeen: [], motion: 'system' })
  window.history.replaceState(null, '', '/')
})

async function open(path = '/') {
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
  return router
}

describe('shouldBoot', () => {
  const at = { path: '/', search: '', automated: false }

  it('boots every load of `/`', () => {
    expect(shouldBoot(at)).toBe(true)
  })

  it('never on a deep link, or for a driven browser', () => {
    expect(shouldBoot({ ...at, path: '/arena' })).toBe(false)
    expect(shouldBoot({ ...at, automated: true })).toBe(false)
  })

  it('`?boot=1` boots `/` whatever else holds, and nowhere else', () => {
    expect(shouldBoot({ ...at, search: '?boot=1', automated: true })).toBe(true)
    expect(shouldBoot({ ...at, path: '/docs', search: '?boot=1' })).toBe(false)
  })
})

describe('armBoot', () => {
  it('boots on every load, not once a session', () => {
    armBoot()
    expect(useBoot.getState().phase).toBe('boot')
    useBoot.setState({ phase: 'off' })
    armBoot()
    expect(useBoot.getState().phase).toBe('boot')
  })

  it('takes `?boot=1` off the URL and keeps the rest', () => {
    window.history.replaceState(null, '', '/?boot=1&x=2#top')
    armBoot()
    expect(useBoot.getState().phase).toBe('boot')
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(
      '/?x=2#top',
    )
  })

  it('does nothing on another page', () => {
    window.history.replaceState(null, '', '/arena')
    armBoot()
    expect(useBoot.getState().phase).toBe('off')
  })
})

describe('the boot screen', () => {
  it('shows the logo, the boot log, and `take tour` with the focus, over an inert page', async () => {
    useBoot.setState({ phase: 'boot' })
    await open()
    const boot = screen.getByRole('dialog', { name: 'asm bots' })
    expect(boot.textContent).toContain('ASM BOTS')
    const log = within(boot).getByRole('list', { name: 'boot log' })
    expect(within(log).getAllByRole('listitem')).toHaveLength(BOOT_LOG.length)
    expect(log.textContent).toContain('zeroing core')
    const tour = within(boot).getByRole('button', { name: 'take tour' })
    expect(document.activeElement).toBe(tour)
    expect(within(boot).getByRole('button', { name: 'enter site' })).toBeTruthy()
  })

  it('first visit: `take tour` opens the tour, and the tour ends on the guided first battle', async () => {
    useBoot.setState({ phase: 'boot' })
    const router = await open()
    const boot = screen.getByRole('dialog', { name: 'asm bots' })
    fireEvent.click(within(boot).getByRole('button', { name: 'take tour' }))
    expect(screen.queryByRole('dialog', { name: 'asm bots' })).toBeNull()
    const tour = await screen.findByRole('dialog', { name: 'the tour' })
    expect(tour.textContent).toContain(`1 / ${TOUR_STEPS.length} · the core`)
    // Back is off on the first step; next and the arrow keys walk the steps.
    expect(within(tour).getByRole('button', { name: 'back' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(within(tour).getByRole('button', { name: 'next' }))
    expect(tour.textContent).toContain('2 / 6 · a bot is a program')
    fireEvent.keyDown(tour, { key: 'ArrowLeft' })
    expect(tour.textContent).toContain('1 / 6 · the core')
    for (let i = 0; i < TOUR_STEPS.length; i++) fireEvent.keyDown(tour, { key: 'ArrowRight' })
    expect(tour.textContent).toContain('6 / 6 · where everything is')
    // The last step lists every page, and hands over to the arena's intro.
    const pages = within(tour).getByRole('list', { name: 'the pages' })
    expect(
      within(pages)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      expect.stringContaining('arena'),
      expect.stringContaining('editor'),
      expect.stringContaining('tournaments'),
      expect.stringContaining('hills'),
      expect.stringContaining('docs'),
    ])
    expect(within(tour).queryByRole('button', { name: 'skip the tour' })).toBeNull()
    await act(async () => {
      fireEvent.click(within(tour).getByRole('button', { name: 'watch the first battle' }))
    })
    expect(screen.queryByRole('dialog', { name: 'the tour' })).toBeNull()
    expect(useSettings.getState().coachMarksSeen).toContain(WELCOME_TOUR)
    expect(router.state.location.pathname).toBe('/arena')
    // The arena took `?intro` and loaded the intro's fight: Dwarf vs Imp at its seed.
    expect(router.state.location.search).toMatchObject({
      b: 'roster:dwarf,roster:imp',
      seed: INTRO_SEED,
    })
  })

  it('`enter site` goes in and puts the tour away for good', async () => {
    useBoot.setState({ phase: 'boot' })
    await open()
    const boot = screen.getByRole('dialog', { name: 'asm bots' })
    fireEvent.click(within(boot).getByRole('button', { name: 'enter site' }))
    expect(useBoot.getState().phase).toBe('off')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(useSettings.getState().coachMarksSeen).toContain(WELCOME_TOUR)
  })

  it('a returning user gets the same choice, and `take tour` opens the tour again', async () => {
    useSettings.setState({ coachMarksSeen: [WELCOME_TOUR] })
    useBoot.setState({ phase: 'boot' })
    await open()
    const boot = screen.getByRole('dialog', { name: 'asm bots' })
    expect(within(boot).getByRole('button', { name: 'enter site' })).toBeTruthy()
    fireEvent.click(within(boot).getByRole('button', { name: 'take tour' }))
    expect(await screen.findByRole('dialog', { name: 'the tour' })).toBeTruthy()
  })

  it('Escape on the tour skips it', async () => {
    useBoot.setState({ phase: 'tour' })
    await open()
    const tour = await screen.findByRole('dialog', { name: 'the tour' })
    fireEvent.keyDown(tour, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'the tour' })).toBeNull()
    expect(useSettings.getState().coachMarksSeen).toContain(WELCOME_TOUR)
  })

  it("the home page's `take the tour` opens it again", async () => {
    useSettings.setState({ coachMarksSeen: [WELCOME_TOUR] })
    await open()
    const how = await screen.findByRole('region', { name: 'how it works' })
    expect(within(how).getAllByRole('listitem')).toHaveLength(3)
    fireEvent.click(within(how).getByRole('button', { name: 'take the tour' }))
    expect(await screen.findByRole('dialog', { name: 'the tour' })).toBeTruthy()
  })
})
