/**
 * The account in the web app (PRODUCT_SPEC §9): the header's slot signed out and signed in, and
 * the first-sign-in dialog (pick a handle, then import the local bots), against `msw`.
 */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import type { ImportBotsResult, Me } from '@asmbots/protocol'
import { ToastProvider } from '@asmbots/ui'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import type { ReactNode } from 'react'
import { useDom, window } from '../../../packages/ui/test/dom'
import { SettingsPage } from '../src/app/SettingsPage'
import { AccountSlot } from '../src/features/account/AccountSlot'
import { cloudBotName, FirstSignIn, importLocalBots } from '../src/features/account/FirstSignIn'
import {
  clearLocalBots,
  getLocalBot,
  listLocalBots,
  markLocalBotsSynced,
  saveLocalBot,
} from '../src/store/local-bots'
import { answer, useApiServer, WithQueries } from './api-server'

useDom()
window.scrollTo = () => {}

const T = '2026-09-24T12:00:00.000Z'
const ME: Me = {
  user: { id: 'u1', handle: 'octo', avatarUrl: 'https://avatars.example/1', createdAt: T },
  onboarded: false,
}

const server = useApiServer()

function signedIn(on: boolean) {
  // biome-ignore lint/suspicious/noDocumentCookie: the hint cookie the API would set
  document.cookie = on ? 'signed_in=1; Path=/' : 'signed_in=; Max-Age=0; Path=/'
}

beforeEach(async () => {
  signedIn(false)
  await clearLocalBots()
})
afterEach(() => signedIn(false))

function renderWith(content: () => ReactNode) {
  const root = createRootRoute({ component: Outlet })
  const at = (path: string, component: () => ReactNode) =>
    createRoute({ getParentRoute: () => root, path, component })
  const router = createRouter({
    routeTree: root.addChildren([
      at('/', content),
      at('/u/$handle', () => <p>profile page</p>),
      at('/settings', () => <p>settings page</p>),
    ]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(
    <WithQueries>
      <ToastProvider>
        <RouterProvider router={router as never} />
      </ToastProvider>
    </WithQueries>,
  )
  return router
}

/** `PATCH /api/me` answers `body`, and puts each request's JSON body in `seen`. */
function answerPatch(body: unknown, status = 200, seen: unknown[] = []) {
  return http.patch('*/api/me', async ({ request }) => {
    seen.push(await request.json())
    return HttpResponse.json(body as object, { status })
  })
}

function importAnswer(seen: unknown[], refuse: (name: string) => boolean = () => false) {
  return http.post('*/api/bots/import', async ({ request }) => {
    const body = (await request.json()) as { bots: { name: string; source: string }[] }
    seen.push(body)
    const results: ImportBotsResult['results'] = body.bots.map((bot, i) =>
      refuse(bot.name)
        ? { ok: false as const, message: 'it does not assemble', diagnostics: [] }
        : {
            ok: true as const,
            bot: {
              id: `cloud-${bot.name}-${i}`,
              ownerId: 'u1',
              slug: `b${i}`,
              name: bot.name,
              visibility: 'private' as const,
              createdAt: T,
              updatedAt: T,
            },
            version: {
              id: `v-${i}`,
              botId: `cloud-${bot.name}-${i}`,
              version: 1,
              source: bot.source,
              bytesSha256: 'ab'.repeat(32),
              size: 2,
              author: null,
              strategy: null,
              isa: 'x16c-v1',
              createdAt: T,
            },
          },
    )
    return HttpResponse.json({ results } satisfies ImportBotsResult, { status: 201 })
  })
}

describe('the account slot', () => {
  it('offers sign-in, and asks the API nothing, when the browser holds no session', async () => {
    renderWith(() => <AccountSlot />)
    // msw fails any request it has no handler for: a GET /api/me here would.
    expect(await screen.findByRole('button', { name: 'sign in with github' })).toBeTruthy()
  })

  it('shows the avatar menu when signed in', async () => {
    signedIn(true)
    server.use(answer('/me', ME))
    const router = renderWith(() => <AccountSlot />)
    const avatar = await screen.findByRole('button', { name: 'account: octo' })
    fireEvent.click(avatar)
    const menu = screen.getByRole('menu')
    const items = within(menu)
      .getAllByRole('menuitem')
      .map((item) => item.textContent)
    expect(items).toEqual(['profile', 'settings', 'sign out'])
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'profile' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/u/octo'))
  })

  it('signs out', async () => {
    signedIn(true)
    let loggedOut = false
    server.use(
      answer('/me', ME),
      http.post('*/api/auth/logout', () => {
        loggedOut = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    renderWith(() => <AccountSlot />)
    fireEvent.click(await screen.findByRole('button', { name: 'account: octo' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'sign out' }))
    expect(await screen.findByRole('button', { name: 'sign in with github' })).toBeTruthy()
    expect(loggedOut).toBe(true)
    expect(await screen.findByText('signed out.')).toBeTruthy()
  })

  it('drops a stale hint when the API says the session is gone', async () => {
    signedIn(true)
    server.use(answer('/me', { error: { code: 'unauthorized', message: 'sign in first' } }, 401))
    renderWith(() => <AccountSlot />)
    expect(await screen.findByRole('button', { name: 'sign in with github' })).toBeTruthy()
    await waitFor(() => expect(document.cookie).not.toContain('signed_in=1'))
  })
})

describe('the settings account panel', () => {
  const onboarded: Me = { ...ME, onboarded: true }

  it('shows the github link, and edits the handle with the same checks as the first sign-in', async () => {
    signedIn(true)
    const seen: unknown[] = []
    server.use(
      answer('/me', onboarded),
      answer('/me/bots', { bots: [] }),
      answerPatch({ error: { code: 'conflict', message: 'taken-one is taken' } }, 409, seen),
    )
    renderWith(() => <SettingsPage />)
    const account = await screen.findByRole('region', { name: 'account' })
    await waitFor(() => expect(account.textContent).toContain('github: linked'))
    const input = within(account).getByRole('textbox', { name: 'handle' }) as HTMLInputElement
    const save = within(account).getByRole('button', { name: 'save' }) as HTMLButtonElement
    expect(input.value).toBe('octo')
    expect(save.disabled).toBe(true)
    fireEvent.change(input, { target: { value: 'No' } })
    expect(input.value).toBe('no')
    expect(account.textContent).toContain('a handle is 3 to 24 characters')
    expect(save.disabled).toBe(true)
    fireEvent.change(input, { target: { value: 'taken-one' } })
    fireEvent.click(save)
    expect(await within(account).findByText('taken-one is taken')).toBeTruthy()
    expect(seen).toEqual([{ handle: 'taken-one' }])

    server.use(answerPatch({ ...onboarded, user: { ...onboarded.user, handle: 'octo-2' } }))
    fireEvent.change(input, { target: { value: 'octo-2' } })
    fireEvent.click(save)
    expect(await screen.findByText('your handle is octo-2.')).toBeTruthy()
    await waitFor(() => expect(account.textContent).toContain('signed in: octo-2'))
  })

  it('deletes the account only after the handle is typed, and unlinks the local bots', async () => {
    signedIn(true)
    const local = await saveLocalBot({ name: 'Spin', source: 'jmp $' })
    await markLocalBotsSynced(new Map([[local.id, 'cloud-1']]))
    let deleted = 0
    server.use(
      answer('/me', onboarded),
      answer('/me/bots', { bots: [] }),
      http.delete('*/api/me', () => {
        deleted++
        return new HttpResponse(null, { status: 204 })
      }),
    )
    renderWith(() => <SettingsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'delete account' }))
    const dialog = await screen.findByRole('dialog', { name: 'delete account' })
    await waitFor(() => expect(dialog.textContent).toContain('0 cloud bots'))
    const confirm = within(dialog).getByRole('button', { name: 'delete' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'your handle' }), {
      target: { value: 'octo' },
    })
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)
    expect(await screen.findByText('account deleted.')).toBeTruthy()
    expect(deleted).toBe(1)
    const account = screen.getByRole('region', { name: 'account' })
    await waitFor(() => expect(account.textContent).toContain('signed out'))
    expect((await getLocalBot(local.id))?.cloudId).toBeUndefined()
  })
})

describe('the first sign-in', () => {
  it('prefills the handle, checks it as it is typed, and shows the API’s refusal', async () => {
    const seen: unknown[] = []
    server.use(
      answerPatch({ error: { code: 'conflict', message: 'taken-one is taken' } }, 409, seen),
    )
    const onDone = mock((_me: Me) => {})
    renderWith(() => <FirstSignIn me={ME} onDone={onDone} />)
    const dialog = await screen.findByRole('dialog', { name: 'pick a handle' })
    const field = within(dialog).getByRole('textbox', { name: 'handle' }) as HTMLInputElement
    const next = within(dialog).getByRole('button', { name: 'continue' }) as HTMLButtonElement
    expect(field.value).toBe('octo')

    fireEvent.change(field, { target: { value: 'Admin' } })
    expect(field.value).toBe('admin')
    expect(within(dialog).getByRole('status').textContent).toBe('admin is reserved')
    expect(next.disabled).toBe(true)

    fireEvent.change(field, { target: { value: 'taken-one' } })
    expect(next.disabled).toBe(false)
    fireEvent.click(next)
    await waitFor(() =>
      expect(within(dialog).getByRole('status').textContent).toBe('taken-one is taken'),
    )
    expect(seen).toEqual([{ handle: 'taken-one' }])
    expect(onDone).not.toHaveBeenCalled()
  })

  it('finishes after the handle when there are no local bots', async () => {
    const done: Me = { ...ME, user: { ...ME.user, handle: 'octo-2' }, onboarded: true }
    server.use(answerPatch(done))
    const onDone = mock((_me: Me) => {})
    renderWith(() => <FirstSignIn me={ME} onDone={onDone} />)
    const dialog = await screen.findByRole('dialog', { name: 'pick a handle' })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'handle' }), {
      target: { value: 'octo-2' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'continue' }))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(done))
  })

  it('then imports the unsynced local bots and marks them synced', async () => {
    const done: Me = { ...ME, onboarded: true }
    const seen: unknown[] = []
    server.use(
      answerPatch(done),
      importAnswer(seen, (name) => name === 'broken'),
    )
    await saveLocalBot({ name: 'imp', source: '%name "Imp"\nstart: jmp $\n' })
    await saveLocalBot({ name: 'broken', source: 'frob' })
    const onDone = mock((_me: Me) => {})
    renderWith(() => <FirstSignIn me={ME} onDone={onDone} />)
    const handle = await screen.findByRole('dialog', { name: 'pick a handle' })
    fireEvent.click(within(handle).getByRole('button', { name: 'continue' }))

    const dialog = await screen.findByRole('dialog', { name: 'import your bots' })
    expect(dialog.textContent).toContain('import 2 local bots to your account?')
    fireEvent.click(within(dialog).getByRole('button', { name: 'import 2' }))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(done))
    expect(
      await screen.findByText('imported 1 bot; 1 did not assemble and stay local.'),
    ).toBeTruthy()

    expect(seen).toHaveLength(1)
    const bots = await listLocalBots()
    const synced = Object.fromEntries(bots.map((b) => [b.name, b.cloudId ?? null]))
    expect(synced).toEqual({ imp: expect.stringMatching(/^cloud-imp-/), broken: null })
    // A later save keeps the link.
    const imp = bots.find((b) => b.name === 'imp')
    await saveLocalBot({ id: imp?.id, name: 'imp', source: 'start: jmp $\n' })
    expect((await listLocalBots()).find((b) => b.name === 'imp')?.cloudId).toBe(imp?.cloudId)
  })

  it('lets the user skip the import', async () => {
    const done: Me = { ...ME, onboarded: true }
    server.use(answerPatch(done))
    await saveLocalBot({ name: 'imp', source: 'start: jmp $\n' })
    const onDone = mock((_me: Me) => {})
    renderWith(() => <FirstSignIn me={ME} onDone={onDone} />)
    fireEvent.click(await screen.findByRole('button', { name: 'continue' }))
    const dialog = await screen.findByRole('dialog', { name: 'import your bots' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'not now' }))
    expect(onDone).toHaveBeenCalledWith(done)
    expect((await listLocalBots())[0]?.cloudId).toBeUndefined()
  })
})

describe('importLocalBots', () => {
  it('sends 50 bots a request, and API-safe names', async () => {
    const seen: { bots: { name: string }[] }[] = []
    server.use(importAnswer(seen as unknown[]))
    for (let i = 0; i < 51; i++) await saveLocalBot({ name: `bot ${i}`, source: 'nop' })
    const outcome = await importLocalBots(await listLocalBots())
    expect(outcome).toEqual({ imported: 51, refused: [] })
    expect(seen.map((body) => body.bots.length)).toEqual([50, 1])
    expect(cloudBotName('  two\nlines  ')).toBe('two lines')
    expect(cloudBotName('   ')).toBe('bot')
    expect(cloudBotName('x'.repeat(80))).toHaveLength(64)
  })
})
