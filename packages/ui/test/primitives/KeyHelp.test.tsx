import { describe, expect, it } from 'bun:test'
import { render, screen, within } from '@testing-library/react'
import { type KeyBinding, KeyHelp } from '../../src/index'
import { html, useDom } from '../dom'

useDom()

const BINDINGS: readonly KeyBinding[] = [
  { keys: ['?'], description: 'key help', group: 'global' },
  { keys: ['space'], description: 'play or pause', group: 'arena' },
  { keys: ['t'], description: 'cycle theme', group: 'global' },
  { keys: ['g', 'a'], description: 'go to arena', group: 'global' },
  { keys: ['.'], description: 'step', group: 'arena' },
]

describe('KeyHelp', () => {
  it('draws a table per group', () => {
    const { container } = render(<KeyHelp bindings={BINDINGS} />)
    expect(html(container)).toMatchSnapshot()
  })

  it('lists each group once, in the order it first appears, captioned by its name', () => {
    render(<KeyHelp bindings={BINDINGS} />)
    const tables = screen.getAllByRole('table')
    expect(tables.map((t) => t.querySelector('caption')?.textContent)).toEqual(['global', 'arena'])
    expect(screen.getByRole('table', { name: 'global' })).toBe(tables[0] as HTMLElement)
    const rows = (table: HTMLElement) =>
      within(table)
        .getAllByRole('row')
        .map((row) => row.textContent)
    expect(rows(tables[0] as HTMLElement)).toEqual(['?key help', 'tcycle theme', 'g ago to arena'])
    expect(rows(tables[1] as HTMLElement)).toEqual(['spaceplay or pause', '.step'])
  })

  it('shows each key as a keycap, in the order they are pressed, as the row’s header', () => {
    render(<KeyHelp bindings={BINDINGS} />)
    const header = screen.getByRole('rowheader', { name: 'g a' })
    expect([...header.querySelectorAll('kbd')].map((k) => k.textContent)).toEqual(['g', 'a'])
    expect(header.getAttribute('scope')).toBe('row')
    expect(screen.getByRole('cell', { name: 'go to arena' })).toBeTruthy()
  })

  it('puts bindings without a group in an untitled table', () => {
    render(
      <KeyHelp
        bindings={[
          { keys: ['f'], description: 'fullscreen' },
          { keys: ['s'], description: 'screenshot' },
        ]}
      />,
    )
    const table = screen.getByRole('table')
    expect(table.querySelector('caption')).toBeNull()
    expect(within(table).getAllByRole('row')).toHaveLength(2)
  })

  it('draws hairlines between the rows, 24 px apart, and none after the last', () => {
    render(<KeyHelp bindings={BINDINGS} />)
    for (const cell of screen.getAllByRole('cell')) {
      expect(cell.className.split(' ')).toEqual(
        expect.arrayContaining(['h-6', 'border-b', 'border-border', 'group-last/row:border-b-0']),
      )
    }
  })

  it('flows the groups into columns that keep each group whole; className passes through', () => {
    const { container } = render(<KeyHelp bindings={BINDINGS} className="mt-2" />)
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toBe('columns-[16rem] gap-6 mt-2')
    for (const table of screen.getAllByRole('table')) {
      expect(table.className).toContain('break-inside-avoid')
    }
  })

  it('draws nothing for no bindings', () => {
    render(<KeyHelp bindings={[]} />)
    expect(screen.queryByRole('table')).toBeNull()
  })
})
