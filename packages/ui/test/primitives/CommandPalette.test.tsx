import { describe, expect, it } from 'bun:test'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { Grid2x2, Palette } from 'lucide-react'
import { useState } from 'react'
import { CommandPalette, filterCommands, type PaletteCommand } from '../../src/index'
import { useDom } from '../dom'

useDom()

/** Every command the test ran, in order. */
let ran: string[] = []

function commands(): PaletteCommand[] {
  ran = []
  const command = (id: string, extra: Partial<PaletteCommand>) => ({
    id,
    label: id,
    run: () => ran.push(id),
    ...extra,
  })
  return [
    command('go to arena', { group: 'go', icon: Grid2x2, keys: ['g', 'a'] }),
    command('sentinel', { group: 'theme', icon: Palette, current: true }),
    command('ice', { group: 'theme', icon: Palette, keywords: 'color' }),
    // Out of its group's place: the palette lists it under `go`, and Down reaches it there.
    command('go to hills', { group: 'go' }),
  ]
}

/** A palette whose onClose closes it; `closed` says whether it did. */
function Harness({ query }: { query?: string }) {
  const [open, setOpen] = useState(true)
  const [list] = useState(commands)
  return (
    <>
      <p>{open ? 'open' : 'closed'}</p>
      <CommandPalette open={open} onClose={() => setOpen(false)} commands={list} query={query} />
    </>
  )
}

const field = () => screen.getByRole('combobox', { name: 'search the commands' })
const options = () => screen.queryAllByRole('option').map((option) => option.textContent)
const active = () =>
  document.getElementById(field().getAttribute('aria-activedescendant') ?? '')?.textContent
const press = (key: string) => fireEvent.keyDown(field(), { key })
const type = (text: string) => fireEvent.change(field(), { target: { value: text } })

describe('CommandPalette', () => {
  it('opens a dialog on its search, the commands under their groups in first-seen order', () => {
    render(<Harness />)
    const dialog = screen.getByRole('dialog', { name: 'commands' })
    expect(document.activeElement).toBe(field())
    expect(
      within(dialog)
        .getAllByRole('group')
        .map((group) => group.textContent),
    ).toEqual(['gogo to arenagago to hills', 'themesentinel (current)ice'])
    expect(screen.getByRole('group', { name: 'theme' })).toBeTruthy()
    expect(active()).toBe('go to arenaga')
  })

  it('moves the active command with Up and Down, wrapping, in the order drawn', () => {
    render(<Harness />)
    press('ArrowDown')
    expect(active()).toBe('go to hills')
    press('ArrowDown')
    press('ArrowDown')
    press('ArrowDown')
    expect(active()).toBe('go to arenaga')
    press('ArrowUp')
    expect(active()).toBe('ice')
    expect(screen.getByRole('option', { name: 'ice' }).getAttribute('aria-selected')).toBe('true')
  })

  it('runs the active command on Enter, after it closes', () => {
    render(<Harness />)
    press('ArrowDown')
    press('Enter')
    expect(ran).toEqual(['go to hills'])
    expect(screen.getByText('closed')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('filters by every word typed, over group, label, and keywords, and says when none match', () => {
    render(<Harness />)
    type('theme')
    expect(options()).toEqual(['sentinel (current)', 'ice'])
    type('color')
    expect(options()).toEqual(['ice'])
    expect(active()).toBe('ice')
    type('go hills')
    expect(options()).toEqual(['go to hills'])
    type('zzz')
    expect(options()).toEqual([])
    expect(screen.getByRole('status').textContent).toBe('no command matches')
    press('Enter')
    expect(ran).toEqual([])
    expect(screen.getByText('open')).toBeTruthy()
  })

  it('opens on its query, and runs a command the pointer picks', () => {
    render(<Harness query="theme" />)
    expect((field() as HTMLInputElement).value).toBe('theme')
    const ice = screen.getByRole('option', { name: 'ice' })
    fireEvent.pointerMove(ice)
    expect(active()).toBe('ice')
    // A press keeps the focus in the field.
    expect(fireEvent.mouseDown(ice)).toBe(false)
    fireEvent.click(ice)
    expect(ran).toEqual(['ice'])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes on Escape without running anything', () => {
    render(<Harness />)
    press('Escape')
    expect(screen.getByText('closed')).toBeTruthy()
    expect(ran).toEqual([])
  })
})

describe('filterCommands', () => {
  it('keeps the order, and every command for an empty search', () => {
    const list = commands()
    expect(filterCommands(list, '   ')).toEqual(list)
    expect(filterCommands(list, 'GO').map((command) => command.id)).toEqual([
      'go to arena',
      'go to hills',
    ])
  })
})
