import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'bun:test'
import { ToastProvider } from '@asmbots/ui'
import { THEME_STORAGE_KEY } from '@asmbots/ui/themes'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { strFromU8, unzipSync, zipSync } from 'fflate'
import { useDom } from '../../../packages/ui/test/dom'
import { exportFileName, SettingsPage } from '../src/app/SettingsPage'
import {
  botsFromZip,
  botsToZip,
  clearLocalBots,
  deleteLocalBot,
  getLocalBot,
  importLocalBots,
  listLocalBots,
  saveLocalBot,
} from '../src/store/local-bots'
import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  sanitizeSettings,
  useSettings,
} from '../src/store/settings'

useDom()

/** The settings as a fresh page would have them: defaults, sentinel, nothing stored. */
function resetStore() {
  document.documentElement.dataset.theme = 'sentinel'
  useSettings.setState({ ...structuredClone(DEFAULT_SETTINGS), theme: 'sentinel' })
  localStorage.clear()
}

function stored(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '{}').state
}

describe('useSettings', () => {
  beforeEach(resetStore)

  it('persists every setting but the theme under its own key', () => {
    const settings = useSettings.getState()
    settings.setEffect('scanlines', false)
    settings.setMotion('reduce')
    settings.setSound({ on: true, volume: 0.8 })
    settings.markCoachSeen('arena')
    settings.markCoachSeen('arena')
    settings.setTheme('amber')
    expect(stored()).toEqual({
      effects: { bloom: true, scanlines: false, vignette: true },
      motion: 'reduce',
      sound: { on: true, volume: 0.8 },
      coachMarksSeen: ['arena'],
      lastArenaConfig: null,
    })
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('amber')
    expect(document.documentElement.dataset.theme).toBe('amber')
  })

  it('reads the stored settings back, keeping defaults for what is malformed', async () => {
    const config = {
      preset: 'duel',
      rounds: 3,
      maxCycles: 100_000,
      seed: null,
      maxProcesses: 64,
      minSpacing: 1024,
    }
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({
        state: {
          effects: { bloom: false, scanlines: 'yes' },
          motion: 'sideways',
          sound: { on: true, volume: 7 },
          coachMarksSeen: ['editor', 3, 'editor'],
          lastArenaConfig: config,
        },
        version: 1,
      }),
    )
    await useSettings.persist.rehydrate()
    const state = useSettings.getState()
    expect(state.effects).toEqual({ bloom: false, scanlines: true, vignette: true })
    expect(state.motion).toBe('system')
    expect(state.sound).toEqual({ on: true, volume: 1 })
    expect(state.coachMarksSeen).toEqual(['editor'])
    expect(state.lastArenaConfig).toEqual(config)
  })

  it('ignores stored junk', () => {
    expect(sanitizeSettings('nope')).toEqual({})
    expect(sanitizeSettings({ lastArenaConfig: { rounds: -1 } })).toEqual({})
  })

  it('cycles from the chosen theme, not a previewed one', () => {
    document.documentElement.dataset.theme = 'ice'
    useSettings.getState().cycleTheme()
    expect(useSettings.getState().theme).toBe('amber')
  })

  it('resets everything, and the theme follows the system again', () => {
    const settings = useSettings.getState()
    settings.setSound({ on: true })
    settings.setTheme('paper')
    useSettings.getState().reset()
    expect(useSettings.getState().sound).toEqual(DEFAULT_SETTINGS.sound)
    expect(useSettings.getState().theme).toBe('sentinel')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()
  })
})

describe('local bots', () => {
  beforeEach(() => clearLocalBots())

  it('creates, reads, updates, lists, and deletes', async () => {
    const dwarf = await saveLocalBot({ name: 'dwarf', source: 'mov ax, 1' })
    await Bun.sleep(2)
    const imp = await saveLocalBot({ name: 'imp', source: 'jmp $' })
    expect((await listLocalBots()).map((bot) => bot.name)).toEqual(['imp', 'dwarf'])
    await Bun.sleep(2)
    const edited = await saveLocalBot({ ...dwarf, source: 'mov ax, 2' })
    expect(edited.id).toBe(dwarf.id)
    expect(edited.updatedAt).toBeGreaterThan(dwarf.updatedAt)
    expect(await getLocalBot(dwarf.id)).toEqual(edited)
    expect((await listLocalBots()).map((bot) => bot.name)).toEqual(['dwarf', 'imp'])
    await deleteLocalBot(imp.id)
    expect(await listLocalBots()).toEqual([edited])
  })

  it('exports one .asm per bot, with safe and unique names', async () => {
    await saveLocalBot({ name: 'Dwarf v3', source: 'mov ax, 1' })
    await saveLocalBot({ name: 'dwarf v3', source: 'mov ax, 2' })
    await saveLocalBot({ name: '../../etc', source: 'nop' })
    await saveLocalBot({ name: '', source: 'hlt' })
    const bots = await listLocalBots()
    // A stamp before 1980 (a hand-edited store) still zips: DOS dates start there.
    const files = unzipSync(
      botsToZip(bots.map((bot, i) => (i === 0 ? { ...bot, updatedAt: 1 } : bot))),
    )
    expect(Object.keys(files).sort()).toEqual([
      'bot.asm',
      'dwarf-v3-2.asm',
      'dwarf-v3.asm',
      'etc.asm',
    ])
    expect(
      Object.values(files)
        .map((bytes) => strFromU8(bytes))
        .sort(),
    ).toEqual(['hlt', 'mov ax, 1', 'mov ax, 2', 'nop'])
  })

  it('imports the .asm files of a zip and skips the rest', async () => {
    const zip = zipSync({
      'bots/imp.asm': new TextEncoder().encode('jmp $'),
      'readme.txt': new TextEncoder().encode('hi'),
      '__MACOSX/._imp.asm': new Uint8Array([0]),
      '.hidden/x.asm': new Uint8Array([0]),
    })
    expect(botsFromZip(zip)).toEqual([{ name: 'imp', source: 'jmp $' }])
    await importLocalBots(zip)
    expect((await listLocalBots()).map(({ name, source }) => ({ name, source }))).toEqual([
      { name: 'imp', source: 'jmp $' },
    ])
  })
})

describe('SettingsPage', () => {
  beforeEach(async () => {
    resetStore()
    await clearLocalBots()
  })

  function renderPage() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <SettingsPage />
        </ToastProvider>
      </QueryClientProvider>,
    )
  }

  it('picks a theme, previews on hover, and puts the choice back on leave', () => {
    renderPage()
    const themes = screen.getByRole('radiogroup', { name: 'theme' })
    const amber = within(themes).getByRole('radio', { name: 'amber' })
    fireEvent.pointerEnter(amber)
    expect(document.documentElement.dataset.theme).toBe('amber')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()
    fireEvent.pointerLeave(amber)
    expect(document.documentElement.dataset.theme).toBe('sentinel')
    fireEvent.click(within(themes).getByRole('radio', { name: 'ice' }))
    expect(useSettings.getState().theme).toBe('ice')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('ice')
    expect(within(themes).getByRole('radio', { name: 'ice' }).getAttribute('aria-checked')).toBe(
      'true',
    )
  })

  it('switches effects, motion, and sound', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'bloom' }))
    fireEvent.click(screen.getByRole('radio', { name: 'reduce' }))
    const volume = screen.getByRole('slider', { name: 'volume' }) as HTMLInputElement
    expect(volume.disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'sound' }))
    expect(volume.disabled).toBe(false)
    fireEvent.change(volume, { target: { value: '30' } })
    const state = useSettings.getState()
    expect(state.effects.bloom).toBe(false)
    expect(state.motion).toBe('reduce')
    expect(state.sound).toEqual({ on: true, volume: 0.3 })
  })

  it('shows the account signed out', () => {
    renderPage()
    const account = screen.getByRole('region', { name: 'account' })
    expect(account.textContent).toContain('signed out')
    expect(
      (within(account).getByRole('button', { name: 'sign in with github' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  it('clears local data only after the confirm', async () => {
    await saveLocalBot({ name: 'imp', source: 'jmp $' })
    useSettings.getState().setSound({ on: true })
    renderPage()
    const data = screen.getByRole('region', { name: 'data' })
    await within(data).findByText('1 local bot')
    fireEvent.click(within(data).getByRole('button', { name: 'clear local data' }))
    const dialog = screen.getByRole('dialog', { name: 'clear local data' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'cancel' }))
    expect(await listLocalBots()).toHaveLength(1)
    fireEvent.click(within(data).getByRole('button', { name: 'clear local data' }))
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole('dialog', { name: 'clear local data' })).getByRole('button', {
          name: 'clear',
        }),
      )
    })
    await waitFor(() => expect(within(data).getByText('0 local bots')).toBeTruthy())
    expect(await listLocalBots()).toEqual([])
    expect(useSettings.getState().sound.on).toBe(false)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('names the export by date', () => {
    expect(exportFileName(new Date('2026-09-23T12:00:00Z'))).toBe('asmbots-bots-2026-09-23.zip')
  })
})
