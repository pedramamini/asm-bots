/**
 * Cloud bots in the web app (PRODUCT_SPEC §3, §6): the editor's cloud save and its links, the
 * library's `mine (cloud)`, account versions in `versions`, and the bot page's `fork` and
 * `challenge`, against `msw`.
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { Bot, BotDetail, BotVersion, Me, MyBot } from '@asmbots/protocol'
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
import { parseRefs, sharedBots } from '../src/features/arena/setup/url'
import { BotActions, challengeLink } from '../src/features/bots/BotActions'
import { forkIntoMyBots, localCopyOf, saveToCloud } from '../src/features/bots/cloud'
import { Library } from '../src/features/editor/Library'
import { VersionsModal } from '../src/features/editor/VersionsModal'
import { listVersions } from '../src/store/bot-versions'
import { clearLocalBots, getLocalBot, listLocalBots, saveLocalBot } from '../src/store/local-bots'
import { answer, useApiServer, WithQueries } from './api-server'

useDom()
window.scrollTo = () => {}

const T = '2026-09-24T12:00:00.000Z'
const SHA = 'ab'.repeat(32)
const SPIN = '%name "Spin"\nstart: jmp $\n'

function cloudBot(id: string, name = 'Spin', visibility: Bot['visibility'] = 'private'): Bot {
  return { id, ownerId: 'u1', slug: 'spin', name, visibility, createdAt: T, updatedAt: T }
}

function cloudVersion(botId: string, version: number, source?: string): BotVersion {
  return {
    id: `${botId}-v${version}`,
    botId,
    version,
    ...(source !== undefined && { source }),
    bytesSha256: SHA,
    size: 2,
    author: null,
    strategy: null,
    isa: 'x16c-v1',
    createdAt: T,
  }
}

const server = useApiServer()

/** `<method> /api<path>` answers `body` (made from the request's JSON), and logs each body. */
function answerWrite(
  method: 'post' | 'patch',
  path: string,
  body: (sent: Record<string, unknown>) => unknown,
  seen: unknown[] = [],
  status = 200,
) {
  return http[method](`*/api${path}`, async ({ request }) => {
    const sent = (await request.json()) as Record<string, unknown>
    seen.push(sent)
    return HttpResponse.json(body(sent) as object, { status })
  })
}

function signedIn(on: boolean) {
  // biome-ignore lint/suspicious/noDocumentCookie: the hint cookie the API would set
  document.cookie = on ? 'signed_in=1; Path=/' : 'signed_in=; Max-Age=0; Path=/'
}

beforeEach(async () => {
  signedIn(false)
  await clearLocalBots()
})

describe('saveToCloud', () => {
  it('makes an unlinked bot in the account, and links the local one to it', async () => {
    const seen: unknown[] = []
    server.use(
      answerWrite(
        'post',
        '/bots',
        (sent) => ({
          bot: cloudBot('c1', String(sent.name)),
          version: cloudVersion('c1', 1, SPIN),
        }),
        seen,
        201,
      ),
    )
    const local = await saveLocalBot({ name: 'Spin', source: SPIN })
    const saved = await saveToCloud(local)
    expect([saved.bot.id, saved.version.version, saved.created]).toEqual(['c1', 1, true])
    expect(seen).toEqual([{ name: 'Spin', source: SPIN }])
    expect((await getLocalBot(local.id))?.cloudId).toBe('c1')
  })

  it('adds a version to a linked bot, and renames it to match', async () => {
    const versions: unknown[] = []
    const patches: unknown[] = []
    server.use(
      answerWrite(
        'post',
        '/bots/c2/versions',
        () => ({
          bot: cloudBot('c2', 'Old'),
          version: cloudVersion('c2', 4, SPIN),
          created: false,
        }),
        versions,
      ),
      answerWrite(
        'patch',
        '/bots/c2',
        (sent) => ({ bot: cloudBot('c2', String(sent.name)) }),
        patches,
      ),
    )
    const local = await saveLocalBot({ name: 'New', source: SPIN, cloudId: 'c2' })
    const saved = await saveToCloud(local)
    expect([saved.bot.name, saved.version.version, saved.created]).toEqual(['New', 4, false])
    expect(versions).toEqual([{ source: SPIN }])
    expect(patches).toEqual([{ name: 'New' }])
  })

  it('makes the bot again when the linked one was deleted from the account', async () => {
    server.use(
      http.post('*/api/bots/gone/versions', () =>
        HttpResponse.json(
          { error: { code: 'not_found', message: 'no bot gone' } },
          { status: 404 },
        ),
      ),
      answerWrite(
        'post',
        '/bots',
        () => ({ bot: cloudBot('c3'), version: cloudVersion('c3', 1) }),
        [],
        201,
      ),
    )
    const local = await saveLocalBot({ name: 'Spin', source: SPIN, cloudId: 'gone' })
    expect((await saveToCloud(local)).bot.id).toBe('c3')
    expect((await getLocalBot(local.id))?.cloudId).toBe('c3')
  })

  it("throws the API's refusal, and leaves the local bot unlinked", async () => {
    server.use(
      http.post('*/api/bots', () =>
        HttpResponse.json(
          { error: { code: 'unprocessable', message: 'it does not assemble: line 1: nope' } },
          { status: 422 },
        ),
      ),
    )
    const local = await saveLocalBot({ name: 'Broken', source: 'frob' })
    await expect(saveToCloud(local)).rejects.toThrow('it does not assemble: line 1: nope')
    expect((await getLocalBot(local.id))?.cloudId).toBeUndefined()
  })
})

describe('localCopyOf', () => {
  it('opens the linked local bot, else makes one from the latest source', async () => {
    const linked = await saveLocalBot({ name: 'Spin', source: SPIN, cloudId: 'c4' })
    const read = mock(async () => SPIN)
    expect((await localCopyOf(cloudBot('c4'), [linked], read)).id).toBe(linked.id)
    expect(read).not.toHaveBeenCalled()
    const copy = await localCopyOf(cloudBot('c5', 'Other'), [linked], read)
    expect([copy.name, copy.source, copy.cloudId]).toEqual(['Other', SPIN, 'c5'])
    expect((await listVersions(copy.id)).map((v) => v.source)).toEqual([SPIN])
  })
})

describe('forkIntoMyBots', () => {
  it('copies locally signed out, and into the account too signed in', async () => {
    const out = await forkIntoMyBots({ name: 'Dwarf', source: SPIN }, false)
    expect([out.cloud, out.local.cloudId]).toEqual([false, undefined])
    server.use(
      answerWrite(
        'post',
        '/bots',
        () => ({ bot: cloudBot('c6'), version: cloudVersion('c6', 1) }),
        [],
        201,
      ),
    )
    const inn = await forkIntoMyBots({ name: 'Dwarf', source: SPIN }, true)
    expect([inn.cloud, inn.local.cloudId]).toEqual([true, 'c6'])
    expect((await listLocalBots()).length).toBe(2)
  })
})

describe('challengeLink', () => {
  it('fights my bot against the bot, carried in the link unless this browser has it', async () => {
    const mine = await saveLocalBot({ name: 'Mine', source: SPIN })
    const bot = cloudBot('b-42', 'Theirs', 'public')
    const carried = challengeLink(bot, SPIN, mine, [mine])
    expect(parseRefs(carried.search.b ?? '')).toEqual([
      { kind: 'local', id: mine.id },
      { kind: 'local', id: 'b-42' },
    ])
    expect(sharedBots(carried.hash).get('b-42')).toBe(SPIN)
    const here = await saveLocalBot({ name: 'Theirs', source: SPIN, cloudId: 'b-42' })
    const linked = challengeLink(bot, SPIN, mine, [mine, here])
    expect(parseRefs(linked.search.b ?? '')[1]).toEqual({ kind: 'local', id: here.id })
    expect(linked.hash).toBe('')
  })

  it('carries a version this browser’s copy has moved on from, under the config given', async () => {
    const mine = await saveLocalBot({ name: 'Mine', source: SPIN })
    const here = await saveLocalBot({
      name: 'Theirs',
      source: `${SPIN}; edited\n`,
      cloudId: 'b-43',
    })
    const config = {
      preset: null,
      rounds: 10,
      maxCycles: 50_000,
      seed: 1,
      maxProcesses: 64,
      minSpacing: 1024,
    }
    const old = challengeLink({ id: 'b-43' }, SPIN, mine, [mine, here], config)
    expect(parseRefs(old.search.b ?? '')[1]).toEqual({ kind: 'local', id: 'b-43' })
    expect(sharedBots(old.hash).get('b-43')).toBe(SPIN)
    expect(old.search).toMatchObject({ seed: 1, rounds: 10, cycles: 50_000 })
  })
})

describe('the library', () => {
  it('lists my account bots under mine (cloud), and opens one', () => {
    const cloud: MyBot[] = [
      { bot: cloudBot('c7', 'Spin', 'public'), latest: cloudVersion('c7', 3) },
      { bot: cloudBot('c8', 'Quiet'), latest: cloudVersion('c8', 1) },
    ]
    const onOpenCloud = mock((_bot: MyBot) => {})
    const props = {
      current: 'scratch',
      local: [],
      recent: [],
      onOpen: () => {},
      onFork: () => {},
      onOpenCloud,
    }
    const { rerender } = render(<Library {...props} />)
    expect(screen.queryByRole('region', { name: 'mine (cloud)' })).toBeNull()
    rerender(<Library {...props} cloud={cloud} />)
    const section = screen.getByRole('region', { name: 'mine (cloud)' })
    const rows = within(section).getAllByRole('button')
    expect(rows.map((row) => row.textContent)).toEqual(['Spin · v3 · public', 'Quiet · v1'])
    fireEvent.click(rows[0] as HTMLElement)
    expect(onOpenCloud.mock.calls[0]?.[0].bot.id).toBe('c7')
  })
})

describe('versions', () => {
  it('lists the account versions and diffs the one picked against the editor', async () => {
    const detail: BotDetail = {
      bot: cloudBot('c9'),
      owner: { id: 'u1', handle: 'octo', avatarUrl: null, createdAt: T },
      versions: [cloudVersion('c9', 2), cloudVersion('c9', 1)],
      placements: [],
    }
    server.use(
      answer('/bots/c9', detail),
      answer('/bots/c9/versions/2', { version: cloudVersion('c9', 2, SPIN) }),
      answer('/bots/c9/versions/1', { version: cloudVersion('c9', 1, `${SPIN}; old\n`) }),
    )
    const onRestore = mock(() => {})
    render(
      <WithQueries>
        <VersionsModal
          open
          botId={null}
          cloudId="c9"
          current={SPIN}
          onClose={() => {}}
          onRestore={onRestore}
        />
      </WithQueries>,
    )
    const dialog = await screen.findByRole('dialog', { name: 'versions' })
    const list = await within(dialog).findByRole('list', { name: 'account versions' })
    const picks = within(list).getAllByRole('button')
    expect(picks.map((b) => b.textContent?.slice(0, 2))).toEqual(['v2', 'v1'])
    expect(await within(dialog).findByText('the same as the editor')).toBeTruthy()
    fireEvent.click(picks[1] as HTMLElement)
    await waitFor(() =>
      expect(within(dialog).getByLabelText('diff').textContent).toContain('- ; old'),
    )
    fireEvent.click(within(dialog).getByRole('button', { name: 'restore' }))
    expect(onRestore).toHaveBeenCalledWith({
      name: 'Spin',
      source: `${SPIN}; old\n`,
      label: 'v1 of your account',
    })
  })
})

describe('the bot page actions', () => {
  function renderActions(content: () => ReactNode) {
    const root = createRootRoute({ component: Outlet })
    const at = (path: string, component: () => ReactNode) =>
      createRoute({ getParentRoute: () => root, path, component })
    const router = createRouter({
      routeTree: root.addChildren([
        at('/', content),
        at('/arena', () => <p>arena page</p>),
        at('/editor/$botId', () => <p>editor page</p>),
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

  it('waits while the source is not public', async () => {
    renderActions(() => (
      <BotActions bot={cloudBot('c10', 'Hidden', 'unlisted')} source={undefined} />
    ))
    const fork = await screen.findByRole('button', { name: 'fork' })
    expect(fork.hasAttribute('disabled')).toBe(true)
    expect(fork.getAttribute('title')).toBe('its source is not public')
    expect(screen.getByRole('button', { name: 'challenge ▾' }).hasAttribute('disabled')).toBe(true)
  })

  it('challenges with my bot picked from the menu', async () => {
    const mine = await saveLocalBot({ name: 'Mine', source: SPIN })
    const router = renderActions(() => (
      <BotActions bot={cloudBot('b-7', 'Theirs', 'public')} source={SPIN} />
    ))
    const challenge = await screen.findByRole('button', { name: 'challenge ▾' })
    await waitFor(() => expect(challenge.hasAttribute('disabled')).toBe(false))
    fireEvent.click(challenge)
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Mine' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/arena'))
    const search = router.state.location.search as { b?: string }
    expect(search.b).toBe(`local:${mine.id},local:b-7`)
    expect(sharedBots(router.state.location.hash).get('b-7')).toBe(SPIN)
  })

  it('forks into my bots, the account too when signed in, and opens the copy', async () => {
    signedIn(true)
    const me: Me = {
      user: { id: 'u1', handle: 'octo', avatarUrl: null, createdAt: T },
      onboarded: true,
    }
    const seen: unknown[] = []
    server.use(
      answer('/me', me),
      answerWrite(
        'post',
        '/bots',
        () => ({ bot: cloudBot('c11'), version: cloudVersion('c11', 1) }),
        seen,
        201,
      ),
    )
    const router = renderActions(() => (
      <BotActions bot={cloudBot('b-8', 'Theirs', 'public')} source={SPIN} />
    ))
    fireEvent.click(await screen.findByRole('button', { name: 'fork' }))
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/editor\//))
    const [copy] = await listLocalBots()
    expect([copy?.name, copy?.cloudId]).toEqual(['Theirs', 'c11'])
    expect(router.state.location.pathname).toBe(`/editor/${copy?.id}`)
    expect(seen).toEqual([{ name: 'Theirs', source: SPIN }])
    expect(await screen.findByText('forked Theirs into my bots.')).toBeTruthy()
  })
})
