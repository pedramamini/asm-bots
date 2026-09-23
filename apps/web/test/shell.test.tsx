import { afterEach, describe, expect, it, mock } from 'bun:test'
import { fireEvent, render, screen } from '@testing-library/react'
import { useDom, window } from '../../../packages/ui/test/dom'
import { ErrorPage, errorAddress, errorText } from '../src/app/ErrorPage'
import { bootTheme, type ThemeBootConfig, themeBootScript } from '../src/app/theme-boot'
import { routeTitle } from '../src/app/title'

useDom()

describe('routeTitle', () => {
  it('puts the route label after the brand, in capitals', () => {
    expect(routeTitle('arena')).toBe('ASM BOTS // ARENA')
    expect(routeTitle('0x404')).toBe('ASM BOTS // 0X404')
  })

  it('adds the detail as given', () => {
    expect(routeTitle('arena', 'r-1a2b')).toBe('ASM BOTS // ARENA · r-1a2b')
  })
})

describe('ErrorPage', () => {
  const error = new Error('bad opcode')

  it('gives the same error the same address, and another error another', () => {
    expect(errorAddress(error)).toMatch(/^0x[0-9A-F]{4}$/)
    expect(errorAddress(error)).toBe(errorAddress(error))
    expect(errorAddress(new Error('bad operand'))).not.toBe(errorAddress(error))
  })

  it('reads anything thrown', () => {
    expect(errorText('plain')).toBe('plain')
    const bare = new Error('no stack')
    bare.stack = undefined
    expect(errorText(bare)).toBe('Error: no stack')
  })

  it('says where it broke, shows the stack, and reloads', () => {
    const reload = mock(() => {})
    render(<ErrorPage error={error} onReload={reload} />)
    expect(screen.getByText(`something broke at ${errorAddress(error)}`)).toBeTruthy()
    expect(screen.getByText('bad opcode', { exact: false }).tagName).toBe('PRE')
    fireEvent.click(screen.getByRole('button', { name: 'reload' }))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('copies the stack', async () => {
    const writeText = mock((_: string) => Promise.resolve())
    const restore = stub(globalThis.navigator, 'clipboard', { writeText })
    try {
      render(<ErrorPage error={error} />)
      fireEvent.click(screen.getByRole('button', { name: 'copy stack' }))
      expect(writeText).toHaveBeenCalledWith(errorText(error))
      expect(await screen.findByRole('button', { name: 'copied' })).toBeTruthy()
    } finally {
      restore()
    }
  })
})

describe('bootTheme', () => {
  const config: ThemeBootConfig = {
    themes: ['sentinel', 'paper'],
    fallback: 'sentinel',
    light: 'paper',
    key: 'theme',
    background: { sentinel: '#0A0F0A', paper: '#F4F1EA' },
  }
  const root = () => window.document.documentElement
  const themeColor = () =>
    window.document.querySelector('meta[name="theme-color"]')?.getAttribute('content')

  let restore = () => {}

  function setup(prefersLight: boolean) {
    restore()
    window.document.querySelector('meta[name="theme-color"]')?.remove()
    const meta = window.document.createElement('meta')
    meta.name = 'theme-color'
    window.document.head.append(meta)
    restore = stub(globalThis, 'matchMedia', (query: string) => ({
      matches: prefersLight && query.includes('light'),
    }))
  }

  // Every test file shares the one window: leave it as it was.
  afterEach(() => {
    restore()
    restore = () => {}
    window.document.querySelector('meta[name="theme-color"]')?.remove()
    root().removeAttribute('data-theme')
  })

  it('applies the stored theme and its background', () => {
    setup(false)
    localStorage.setItem('theme', 'paper')
    bootTheme(config)
    expect(root().dataset.theme).toBe('paper')
    expect(themeColor()).toBe('#F4F1EA')
  })

  it('follows the system when nothing valid is stored, and stores nothing', () => {
    setup(true)
    localStorage.setItem('theme', 'neon')
    bootTheme(config)
    expect(root().dataset.theme).toBe('paper')
    expect(localStorage.getItem('theme')).toBe('neon')
    localStorage.clear()
    setup(false)
    bootTheme(config)
    expect(root().dataset.theme).toBe('sentinel')
  })

  it('keeps theme-color on the theme when the theme changes', async () => {
    setup(false)
    bootTheme(config)
    expect(themeColor()).toBe('#0A0F0A')
    root().dataset.theme = 'paper'
    await Promise.resolve()
    expect(themeColor()).toBe('#F4F1EA')
  })

  it('serializes to a script that runs on its own', () => {
    setup(false)
    const script = themeBootScript({
      sentinel: '#0A0F0A',
      amber: '#0F0A00',
      pedurple: '#0B0810',
      ice: '#050A0F',
      paper: '#F4F1EA',
    })
    localStorage.setItem('theme', 'amber')
    new Function(script)()
    expect(root().dataset.theme).toBe('amber')
    expect(themeColor()).toBe('#0F0A00')
  })
})

/** Sets `target[key]` for one test; the returned function puts the old property back. */
function stub(target: object, key: string, value: unknown): () => void {
  const previous = Object.getOwnPropertyDescriptor(target, key)
  Object.defineProperty(target, key, { value, configurable: true, writable: true })
  return () => {
    if (previous === undefined) Reflect.deleteProperty(target, key)
    else Object.defineProperty(target, key, previous)
  }
}
