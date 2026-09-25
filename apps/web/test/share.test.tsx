/**
 * Sharing (PRODUCT_SPEC §10): `share ▾` copies a page's link or an `<iframe>` of its battle, and
 * saves its share card as a PNG; the embed's URL is the arena page's under `/embed`; and what the
 * bot, hill, and server tournament pages share.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import type { Bot, MatchSummary, TournamentDetail } from '@asmbots/protocol'
import { ToastProvider } from '@asmbots/ui'
import { render, screen, waitFor } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { useDom, window } from '../../../packages/ui/test/dom'
import { botShare, SPARRING_PARTNER } from '../src/features/bots/BotActions'
import { hillShare } from '../src/features/hills/HillPage'
import { ShareMenu, type ShareTarget } from '../src/features/share/ShareMenu'
import {
  EMBED_HEIGHT,
  EMBED_WIDTH,
  embedSnippet,
  embedTitle,
  embedUrl,
  watchUrl,
} from '../src/features/share/share'
import { serverShare } from '../src/features/tournaments/ServerTournament'
import { useApiServer } from './api-server'
import { pickShare } from './share-menu'

useDom()
const server = useApiServer()

const ORIGIN = 'http://localhost'
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

const writeText = mock((_text: string) => Promise.resolve())
const saved: { name: string; blob: Blob }[] = []
let undo: (() => void)[] = []

beforeAll(() => {
  const clipboard = Object.getOwnPropertyDescriptor(globalThis.navigator, 'clipboard')
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
  const blobs = new Map<string, Blob>()
  const url = { create: URL.createObjectURL, revoke: URL.revokeObjectURL }
  URL.createObjectURL = (blob: Blob) => {
    const at = `blob:${blobs.size}`
    blobs.set(at, blob)
    return at
  }
  URL.revokeObjectURL = () => {}
  const click = window.HTMLAnchorElement.prototype.click
  window.HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    saved.push({ name: this.download, blob: blobs.get(this.href) as Blob })
  }
  undo = [
    () => {
      if (clipboard === undefined) Reflect.deleteProperty(globalThis.navigator, 'clipboard')
      else Object.defineProperty(globalThis.navigator, 'clipboard', clipboard)
    },
    () => {
      URL.createObjectURL = url.create
      URL.revokeObjectURL = url.revoke
      window.HTMLAnchorElement.prototype.click = click
    },
  ]
})
afterEach(() => {
  writeText.mockClear()
  writeText.mockImplementation(() => Promise.resolve())
  saved.length = 0
})
afterAll(() => {
  for (const step of undo) step()
})

function renderMenu(target: ShareTarget) {
  return render(
    <ToastProvider>
      <div data-testid="page">
        <ShareMenu {...target} />
      </div>
    </ToastProvider>,
  )
}

describe('embed links', () => {
  it('puts an arena page’s URL under /embed, and takes it back out', () => {
    const page = `${ORIGIN}/arena?b=roster:dwarf,roster:imp&seed=1#src=abc`
    const embed = `${ORIGIN}/embed/arena?b=roster:dwarf,roster:imp&seed=1#src=abc`
    expect(embedUrl(page)).toBe(embed)
    expect(watchUrl(embed)).toBe(page)
    expect(embedUrl(`${ORIGIN}/arena/${'a'.repeat(64)}`)).toBe(
      `${ORIGIN}/embed/arena/${'a'.repeat(64)}`,
    )
    // A URL that is not an embed's stays as it is.
    expect(watchUrl(page)).toBe(page)
  })

  it('writes an <iframe> of the embed, its URL and name escaped', () => {
    expect(embedSnippet(`${ORIGIN}/embed/arena?b=x&seed=1`, 'ASM BOTS: "A" vs <B>')).toBe(
      `<iframe src="${ORIGIN}/embed/arena?b=x&amp;seed=1" title="ASM BOTS: &quot;A&quot; vs &lt;B&gt;" width="${EMBED_WIDTH}" height="${EMBED_HEIGHT}" style="border:0" allow="fullscreen" loading="lazy"></iframe>`,
    )
    expect(embedTitle(['Dwarf', 'Imp'])).toBe('ASM BOTS: Dwarf vs Imp')
    expect(embedTitle(['A', 'B', 'C', 'D'])).toBe('ASM BOTS: 4 bots')
  })
})

describe('share ▾', () => {
  const target: ShareTarget = {
    link: `${ORIGIN}/bots/b-1`,
    embed: { url: `${ORIGIN}/embed/arena?b=roster:dwarf&seed=1`, title: 'ASM BOTS: Dwarf vs Imp' },
    png: { path: '/bots/b-1/og.png', name: 'asmbots-dwarf.png' },
  }

  it('copies the link, and says so', async () => {
    renderMenu(target)
    await pickShare(screen.getByTestId('page'), 'copy link')
    expect(await screen.findByText('link copied.')).toBeTruthy()
    expect(writeText).toHaveBeenCalledWith(`${ORIGIN}/bots/b-1`)
  })

  it('copies an <iframe> of the battle, and says when the clipboard refuses it', async () => {
    renderMenu(target)
    await pickShare(screen.getByTestId('page'), 'copy embed')
    expect(await screen.findByText('embed copied: paste it into any page.')).toBeTruthy()
    expect(writeText).toHaveBeenCalledWith(
      embedSnippet(target.embed?.url ?? '', 'ASM BOTS: Dwarf vs Imp'),
    )
    writeText.mockImplementation(() => Promise.reject(new Error('denied')))
    await pickShare(screen.getByTestId('page'), 'copy embed')
    expect(await screen.findByText('could not copy the embed.')).toBeTruthy()
  })

  it('saves the card the API draws, and says when it cannot', async () => {
    server.use(
      http.get('*/api/bots/b-1/og.png', () =>
        HttpResponse.arrayBuffer(PNG.buffer as ArrayBuffer, {
          headers: { 'Content-Type': 'image/png' },
        }),
      ),
    )
    renderMenu(target)
    await pickShare(screen.getByTestId('page'), 'download png')
    await waitFor(() => expect(saved.map((file) => file.name)).toEqual(['asmbots-dwarf.png']))
    const blob = saved[0]?.blob as Blob
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(PNG)

    server.use(http.get('*/api/bots/b-1/og.png', () => new HttpResponse(null, { status: 404 })))
    await pickShare(screen.getByTestId('page'), 'download png')
    expect(await screen.findByText('could not make the image.')).toBeTruthy()
    expect(saved).toHaveLength(1)
  })

  it('runs a page’s own copy and picture, and offers only what the page has', async () => {
    const link = mock(() => {})
    const png = mock(() => {})
    renderMenu({ link, png })
    await pickShare(screen.getByTestId('page'), 'copy link')
    expect(link).toHaveBeenCalledTimes(1)
    await pickShare(screen.getByTestId('page'), 'download png')
    expect(png).toHaveBeenCalledTimes(1)
    await pickShare(screen.getByTestId('page'), 'copy link')
    expect(screen.queryByRole('menuitem', { name: 'copy embed' })).toBeNull()
  })
})

const BOT: Bot = {
  id: 'b-1',
  ownerId: 'u-1',
  slug: 'dwarf-v3',
  name: 'Dwarf v3',
  visibility: 'public',
  createdAt: '2026-09-24T00:00:00.000Z',
  updatedAt: '2026-09-24T00:00:00.000Z',
}

describe('what a page shares', () => {
  it('a bot: its link, its card unless private, and it sparring once its source is known', () => {
    const share = botShare(BOT, 'start: jmp $', ORIGIN)
    expect(share.link).toBe(`${ORIGIN}/bots/b-1`)
    expect(share.png).toEqual({ path: '/bots/b-1/og.png', name: 'asmbots-dwarf-v3.png' })
    const embed = new URL(share.embed?.url ?? '')
    expect(embed.pathname).toBe('/embed/arena')
    expect(embed.searchParams.get('b')).toBe(`local:b-1,roster:${SPARRING_PARTNER}`)
    expect(embed.searchParams.get('seed')).toBe('1')
    expect(embed.hash).toStartWith('#src=')
    expect(share.embed?.title).toBe(`ASM BOTS: Dwarf v3 vs ${SPARRING_PARTNER}`)
    const hidden = botShare({ ...BOT, visibility: 'private' }, undefined, ORIGIN)
    expect(hidden.png).toBeUndefined()
    expect(hidden.embed).toBeUndefined()
  })

  it('a hill: its link, its card, and its newest match that has a replay', () => {
    const summary = (id: string, replayKey: string | null): MatchSummary => ({
      match: {
        id,
        tournamentId: null,
        hillId: 'h-main',
        participants: ['v-1', 'v-2'],
        rounds: 10,
        seed: 1,
        key: null,
        result: null,
        replayKey,
        finishedAt: '2026-09-24T00:00:00.000Z',
      },
      bots: [
        {
          botId: 'b-1',
          versionId: 'v-1',
          slug: 'dwarf',
          name: 'Dwarf',
          version: 1,
          owner: 'a',
          author: null,
        },
        null,
      ],
    })
    const key = 'c'.repeat(64)
    const share = hillShare('main', [summary('m-3', null), summary('m-2', key)], ORIGIN)
    expect(share.link).toBe(`${ORIGIN}/hills/main`)
    expect(share.png).toEqual({ path: '/hills/main/og.png', name: 'asmbots-hill-main.png' })
    expect(share.embed).toEqual({
      url: `${ORIGIN}/embed/arena/${key}`,
      title: 'ASM BOTS: Dwarf vs a deleted bot',
    })
    expect(hillShare('main', [summary('m-3', null)], ORIGIN).embed).toBeUndefined()
  })

  it('a server tournament: its link, its card unless a draft, and the match it finished last', () => {
    const match = (id: string, finishedAt: string | null, replayKey: string | null) => ({
      id,
      tournamentId: 't-1',
      hillId: null,
      participants: ['v-1', 'v-2'],
      rounds: 3,
      seed: 1,
      key: null,
      result: null,
      replayKey,
      finishedAt,
    })
    const label = (versionId: string, name: string) => ({
      botId: versionId,
      versionId,
      slug: name.toLowerCase(),
      name,
      version: 1,
      owner: 'a',
      author: null,
    })
    const detail = {
      tournament: { id: 't-1', slug: 'cup', status: 'finished' },
      entrants: [label('v-1', 'Dwarf'), label('v-2', 'Imp')],
      matches: [
        match('t-1-0', '2026-09-24T10:00:00.000Z', 'a'.repeat(64)),
        match('t-1-1', '2026-09-24T11:00:00.000Z', 'b'.repeat(64)),
        match('t-1-2', null, null),
      ],
    } as unknown as TournamentDetail
    const share = serverShare(detail, ORIGIN)
    expect(share.link).toBe(`${ORIGIN}/tournaments/t-1`)
    expect(share.png).toEqual({ path: '/tournaments/t-1/og.png', name: 'asmbots-cup.png' })
    expect(share.embed).toEqual({
      url: `${ORIGIN}/embed/arena/${'b'.repeat(64)}`,
      title: 'ASM BOTS: Dwarf vs Imp',
    })
    const draft = { ...detail, tournament: { ...detail.tournament, status: 'draft' }, matches: [] }
    const unshared = serverShare(draft as unknown as TournamentDetail, ORIGIN)
    expect(unshared.png).toBeUndefined()
    expect(unshared.embed).toBeUndefined()
  })
})
