/**
 * The settings page's API tokens panel, against `msw`: it shows only signed in, lists the tokens
 * (never a secret), makes one and shows its secret once with the warning, and revokes one after a
 * confirm.
 */
import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'bun:test'
import type { ApiToken, CreatedApiToken, Me } from '@asmbots/protocol'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { useDom, window } from '../../../packages/ui/test/dom'
import { SettingsPage } from '../src/app/SettingsPage'
import { answer, answerPost, renderAt, useApiServer } from './api-server'

useDom()
window.scrollTo = () => {}

const T = '2026-09-24T12:00:00.000Z'
const ME: Me = {
  user: { id: 'u1', handle: 'octo', avatarUrl: null, createdAt: T },
  onboarded: true,
}
const LAPTOP: ApiToken = {
  id: 't1',
  name: 'laptop',
  prefix: 'asmb_1234567',
  createdAt: T,
  lastUsedAt: null,
}
const SECRET = `asmb_${'ab'.repeat(32)}`

const server = useApiServer()

function signedIn(on: boolean) {
  // biome-ignore lint/suspicious/noDocumentCookie: the hint cookie the API would set
  document.cookie = on ? 'signed_in=1; Path=/' : 'signed_in=; Max-Age=0; Path=/'
}
afterEach(() => signedIn(false))

describe('the api tokens panel', () => {
  it('is not there signed out', async () => {
    await renderAt('/settings', () => <SettingsPage />)
    await screen.findByRole('region', { name: 'account' })
    expect(screen.queryByRole('region', { name: 'api tokens' })).toBeNull()
  })

  it('says what a token is for, links the agents page, and lists the tokens', async () => {
    signedIn(true)
    server.use(
      answer('/me', ME),
      answer('/me/bots', { bots: [] }),
      answer('/me/tokens', { tokens: [LAPTOP] }),
    )
    await renderAt('/settings', () => <SettingsPage />)
    const panel = await screen.findByRole('region', { name: 'api tokens' })
    expect(panel.textContent).toContain('a token lets a script or an AI agent push bots')
    const link = within(panel).getByRole('link', { name: 'agents page' })
    expect(link.getAttribute('href')).toBe('/docs/tools/agents')
    const list = await within(panel).findByRole('list', { name: 'your api tokens' })
    expect(list.textContent).toContain('laptop')
    expect(list.textContent).toContain('asmb_1234567…')
    expect(list.textContent).toContain('created 2026-09-24')
    expect(list.textContent).toContain('last used never')
    expect(panel.textContent).toContain(`1 of 10`)
  })

  it('makes a token and shows its secret once, with the warning', async () => {
    signedIn(true)
    const seen: unknown[] = []
    const made: CreatedApiToken = { token: { ...LAPTOP, id: 't2', name: 'agent' }, secret: SECRET }
    server.use(
      answer('/me', ME),
      answer('/me/bots', { bots: [] }),
      answer('/me/tokens', { tokens: [] }),
      answerPost('/me/tokens', made, 201, seen),
    )
    await renderAt('/settings', () => <SettingsPage />)
    const panel = await screen.findByRole('region', { name: 'api tokens' })
    expect(await within(panel).findByText(/no api tokens yet\./)).toBeTruthy()
    const create = within(panel).getByRole('button', { name: 'create token' }) as HTMLButtonElement
    expect(create.disabled).toBe(true)
    fireEvent.change(within(panel).getByRole('textbox', { name: 'token name' }), {
      target: { value: '  agent ' },
    })
    fireEvent.click(create)
    const note = await within(panel).findByRole('note', { name: 'new token' })
    expect(seen).toEqual([{ name: 'agent' }])
    expect(note.textContent).toContain('copy it now: it is not shown again.')
    expect(
      (within(note).getByRole('textbox', { name: 'the token' }) as HTMLInputElement).value,
    ).toBe(SECRET)
    fireEvent.click(within(note).getByRole('button', { name: 'done' }))
    await waitFor(() => expect(within(panel).queryByRole('note', { name: 'new token' })).toBeNull())
    expect(panel.textContent).not.toContain(SECRET)
  })

  it('shows why the API refused a token', async () => {
    signedIn(true)
    server.use(
      answer('/me', ME),
      answer('/me/bots', { bots: [] }),
      answer('/me/tokens', { tokens: [] }),
      answerPost(
        '/me/tokens',
        { error: { code: 'conflict', message: 'an account holds 10 api tokens' } },
        409,
      ),
    )
    await renderAt('/settings', () => <SettingsPage />)
    const panel = await screen.findByRole('region', { name: 'api tokens' })
    fireEvent.change(await within(panel).findByRole('textbox', { name: 'token name' }), {
      target: { value: 'one more' },
    })
    fireEvent.click(within(panel).getByRole('button', { name: 'create token' }))
    expect((await within(panel).findByRole('alert')).textContent).toBe(
      'an account holds 10 api tokens',
    )
  })

  it('revokes a token after a confirm', async () => {
    signedIn(true)
    let revoked = ''
    let tokens = [LAPTOP]
    server.use(
      answer('/me', ME),
      answer('/me/bots', { bots: [] }),
      http.get('*/api/me/tokens', () => HttpResponse.json({ tokens })),
      http.delete('*/api/me/tokens/:id', ({ params }) => {
        revoked = String(params.id)
        tokens = []
        return new HttpResponse(null, { status: 204 })
      }),
    )
    await renderAt('/settings', () => <SettingsPage />)
    const panel = await screen.findByRole('region', { name: 'api tokens' })
    fireEvent.click(await within(panel).findByRole('button', { name: 'revoke laptop' }))
    const dialog = await screen.findByRole('dialog', { name: 'revoke api token' })
    expect(revoked).toBe('')
    fireEvent.click(within(dialog).getByRole('button', { name: 'revoke' }))
    expect(await screen.findByText('revoked laptop.')).toBeTruthy()
    expect(revoked).toBe('t1')
    expect(await within(panel).findByText(/no api tokens yet\./)).toBeTruthy()
  })
})
