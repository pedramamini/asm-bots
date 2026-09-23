import { afterEach, describe, expect, it } from 'bun:test'
import { fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import {
  EmptyState,
  Table,
  type TableColumn,
  type TableSort,
  VIRTUALIZE_ABOVE,
} from '../../src/index'
import { html, stubLayout, useDom } from '../dom'

useDom()

const undo: (() => void)[] = []
afterEach(() => {
  for (const restore of undo.splice(0)) restore()
})

interface Bot {
  name: string
  procs: number
  footprint: number
}

const BOTS: readonly Bot[] = [
  { name: 'dwarf-v10', procs: 3, footprint: 400 },
  { name: 'imp', procs: 41, footprint: 2119 },
  { name: 'dwarf-v9', procs: 12, footprint: 3471 },
  { name: 'stone', procs: 12, footprint: 738 },
]

const COLUMNS: readonly TableColumn<Bot>[] = [
  { id: 'name', header: 'bot', cell: (b) => b.name, sortValue: (b) => b.name },
  {
    id: 'procs',
    header: 'procs',
    align: 'right',
    cell: (b) => b.procs,
    sortValue: (b) => b.procs,
    className: 'w-16',
  },
  { id: 'footprint', header: 'footprint', align: 'right', cell: (b) => `${b.footprint} B` },
]

const byName = (b: Bot) => b.name

/** The first cell of each body row, top to bottom. */
const names = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => row.firstElementChild?.textContent)
const header = (name: string) => screen.getByRole('columnheader', { name })
const sortBy = (name: string) => fireEvent.click(screen.getByRole('button', { name }))

describe('Table', () => {
  it('draws the header row over the rows', () => {
    const { container } = render(
      <Table
        columns={COLUMNS}
        rows={BOTS}
        rowKey={byName}
        defaultSort={{ column: 'procs', direction: 'desc' }}
      />,
    )
    expect(html(container)).toMatchSnapshot()
  })

  it('has hairlines between the rows only, muted UPPER 10 px headers, 24 px rows (DESIGN_SYSTEM §4)', () => {
    render(<Table columns={COLUMNS} rows={BOTS} rowKey={byName} aria-label="bots" />)
    const table = screen.getByRole('table', { name: 'bots' })
    expect(table.className.split(' ')).toEqual(
      expect.arrayContaining(['table-fixed', 'border-separate', 'border-spacing-0', 'text-data']),
    )
    const th = header('footprint')
    expect(th.className.split(' ')).toEqual(
      expect.arrayContaining([
        'text-panel-status',
        'text-muted',
        'border-b',
        'border-border',
        'h-6',
      ]),
    )
    const rows = screen.getAllByRole('row').slice(1)
    for (const row of rows) {
      expect(row.className.split(' ')).toEqual(expect.arrayContaining(['hover:bg-panel-2']))
      for (const cell of row.children) {
        expect(cell.className.split(' ')).toEqual(
          expect.arrayContaining(['h-6', 'border-b', 'group-last/row:border-b-0']),
        )
      }
    }
  })

  it('aligns a column right when it says so: numerics end on the same edge', () => {
    render(<Table columns={COLUMNS} rows={BOTS} rowKey={byName} />)
    expect(header('bot').className).toContain('text-left')
    expect(header('footprint').className).toContain('text-right')
    const cells = screen.getAllByRole('cell')
    expect(cells.filter((cell) => cell.textContent?.endsWith(' B'))).toHaveLength(4)
    for (const cell of cells) {
      const right = /^\d/.test(cell.textContent ?? '')
      expect({ cell: cell.textContent, right: cell.className.includes('text-right') }).toEqual({
        cell: cell.textContent,
        right,
      })
    }
  })

  it('puts a column’s className on its header and every cell', () => {
    render(<Table columns={COLUMNS} rows={BOTS} rowKey={byName} />)
    expect(header('procs').className.split(' ')).toContain('w-16')
    const procs = screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.children[1] as HTMLElement)
    expect(procs.every((cell) => cell.className.split(' ').includes('w-16'))).toBe(true)
  })

  it('keeps the input order until a header sorts it', () => {
    render(<Table columns={COLUMNS} rows={BOTS} rowKey={byName} />)
    expect(names()).toEqual(['dwarf-v10', 'imp', 'dwarf-v9', 'stone'])
    for (const name of ['bot', 'procs', 'footprint']) {
      expect(header(name).getAttribute('aria-sort')).toBeNull()
    }
  })

  it('sorts text A to Z on the first click, in natural order, and reverses on the next', () => {
    render(<Table columns={COLUMNS} rows={BOTS} rowKey={byName} />)
    sortBy('bot')
    expect(names()).toEqual(['dwarf-v9', 'dwarf-v10', 'imp', 'stone'])
    expect(header('bot').getAttribute('aria-sort')).toBe('ascending')
    sortBy('bot')
    expect(names()).toEqual(['stone', 'imp', 'dwarf-v10', 'dwarf-v9'])
    expect(header('bot').getAttribute('aria-sort')).toBe('descending')
  })

  it('sorts a right-aligned column largest first, and keeps ties in their input order', () => {
    render(<Table columns={COLUMNS} rows={BOTS} rowKey={byName} />)
    sortBy('bot')
    sortBy('procs')
    // dwarf-v9 and stone tie at 12 and keep the order they came in, not the last sort's.
    expect(names()).toEqual(['imp', 'dwarf-v9', 'stone', 'dwarf-v10'])
    expect(header('procs').getAttribute('aria-sort')).toBe('descending')
    expect(header('bot').getAttribute('aria-sort')).toBeNull()
    sortBy('procs')
    expect(names()).toEqual(['dwarf-v10', 'dwarf-v9', 'stone', 'imp'])
  })

  it('takes the first direction from sortFirst', () => {
    const columns: TableColumn<Bot>[] = [
      { ...(COLUMNS[0] as TableColumn<Bot>), sortFirst: 'desc' },
      { ...(COLUMNS[1] as TableColumn<Bot>), sortFirst: 'asc' },
    ]
    render(<Table columns={columns} rows={BOTS} rowKey={byName} />)
    sortBy('bot')
    expect(names()).toEqual(['stone', 'imp', 'dwarf-v10', 'dwarf-v9'])
    sortBy('procs')
    expect(names()).toEqual(['dwarf-v10', 'dwarf-v9', 'stone', 'imp'])
  })

  it('shows the sort as an accent arrow, before a right-aligned label and after a left one', () => {
    render(
      <Table
        columns={COLUMNS}
        rows={BOTS}
        rowKey={byName}
        defaultSort={{ column: 'procs', direction: 'desc' }}
      />,
    )
    const procs = screen.getByRole('button', { name: 'procs' })
    expect(procs.textContent).toBe('procs↓')
    expect(procs.className).toContain('flex-row-reverse')
    expect(procs.className).toContain('uppercase')
    const arrow = procs.lastElementChild as HTMLElement
    expect(arrow.getAttribute('aria-hidden')).toBe('true')
    expect(arrow.className).toBe('text-accent')
    // The sorted header reads in --text; the others stay muted.
    expect(header('procs').className).toContain('text-text')
    expect(header('bot').className).toContain('text-muted')
    sortBy('bot')
    const bot = screen.getByRole('button', { name: 'bot' })
    expect(bot.textContent).toBe('bot↑')
    expect(bot.className).not.toContain('flex-row-reverse')
    expect(screen.getByRole('button', { name: 'procs' }).textContent).toBe('procs')
  })

  it('draws a header without a sortValue as text, not a button', () => {
    render(<Table columns={COLUMNS} rows={BOTS} rowKey={byName} />)
    expect(screen.queryByRole('button', { name: 'footprint' })).toBeNull()
    expect(header('footprint').textContent).toBe('footprint')
  })

  it('sorts by `sort` when the caller holds it, and reports each click', () => {
    const changes: TableSort[] = []
    const { rerender } = render(
      <Table
        columns={COLUMNS}
        rows={BOTS}
        rowKey={byName}
        sort={{ column: 'procs', direction: 'asc' }}
        onSortChange={(sort) => changes.push(sort)}
      />,
    )
    expect(names()).toEqual(['dwarf-v10', 'dwarf-v9', 'stone', 'imp'])
    sortBy('procs')
    expect(changes).toEqual([{ column: 'procs', direction: 'desc' }])
    // Nothing moves until the caller passes the new sort back.
    expect(names()).toEqual(['dwarf-v10', 'dwarf-v9', 'stone', 'imp'])
    rerender(
      <Table
        columns={COLUMNS}
        rows={BOTS}
        rowKey={byName}
        sort={null}
        onSortChange={(sort) => changes.push(sort)}
      />,
    )
    expect(names()).toEqual(['dwarf-v10', 'imp', 'dwarf-v9', 'stone'])
    sortBy('bot')
    expect(changes.at(-1)).toEqual({ column: 'name', direction: 'asc' })
  })

  it('reports each sort a header makes when it holds its own state', () => {
    const changes: TableSort[] = []
    render(
      <Table
        columns={COLUMNS}
        rows={BOTS}
        rowKey={byName}
        onSortChange={(sort) => changes.push(sort)}
      />,
    )
    sortBy('procs')
    sortBy('procs')
    expect(changes).toEqual([
      { column: 'procs', direction: 'desc' },
      { column: 'procs', direction: 'asc' },
    ])
  })

  it('shows `empty` in one full-width cell when there are no rows', () => {
    render(
      <Table
        columns={COLUMNS}
        rows={[]}
        rowKey={byName}
        empty={
          <EmptyState action={{ label: 'submit a bot', href: '/hills/main/submit' }}>
            no entrants yet.
          </EmptyState>
        }
      />,
    )
    const cell = screen.getByRole('cell')
    expect(cell.getAttribute('colspan')).toBe('3')
    expect(cell.textContent).toBe('no entrants yet. submit a bot →')
    expect(screen.getAllByRole('columnheader')).toHaveLength(3)
  })

  it('draws no body rows and no empty cell for no rows and no `empty`', () => {
    render(<Table columns={COLUMNS} rows={[]} rowKey={byName} />)
    expect(screen.getAllByRole('row')).toHaveLength(1)
    expect(screen.queryByRole('cell')).toBeNull()
  })

  it('keeps the header cells on top as the rows scroll, over --panel', () => {
    render(<Table columns={COLUMNS} rows={BOTS} rowKey={byName} />)
    expect(header('bot').className.split(' ')).toEqual(
      expect.arrayContaining(['sticky', 'top-0', 'z-1', 'bg-panel']),
    )
  })

  it('puts className on the scroll box, and the other props and the ref on the table', () => {
    const ref = createRef<HTMLTableElement>()
    render(
      <Table
        ref={ref}
        columns={COLUMNS}
        rows={BOTS}
        rowKey={byName}
        className="h-80"
        aria-label="standings"
        data-state="live"
      />,
    )
    const table = screen.getByRole('table', { name: 'standings' })
    expect(ref.current).toBe(table)
    expect(table.dataset.state).toBe('live')
    const box = table.parentElement as HTMLElement
    expect(box.className.split(' ')).toEqual(
      expect.arrayContaining(['overflow-auto', 'min-h-0', 'h-80']),
    )
    expect(table.className).not.toContain('h-80')
  })
})

describe('Table past 200 rows', () => {
  interface Line {
    n: number
  }
  const lines = (count: number): Line[] => Array.from({ length: count }, (_, n) => ({ n }))
  const LINE_COLUMNS: TableColumn<Line>[] = [
    { id: 'n', header: 'cycle', align: 'right', cell: (line) => `cycle ${line.n}` },
  ]
  /** The rows drawn, spacers aside. */
  const drawn = (table: HTMLElement) => [...table.querySelectorAll('tbody tr:not([aria-hidden])')]
  const spacers = (table: HTMLElement) =>
    [...table.querySelectorAll<HTMLElement>('tbody tr[aria-hidden]')].map((row) =>
      Number.parseInt(row.style.getPropertyValue('--rows'), 10),
    )

  function renderLines(count: number) {
    // A 240 px view: the header and 9 rows. jsdom lays nothing out, so the view says so itself.
    undo.push(stubLayout('offsetHeight', () => 240))
    render(
      <Table
        className="h-60"
        columns={LINE_COLUMNS}
        rows={lines(count)}
        rowKey={(line) => line.n}
        aria-label="trace"
      />,
    )
    return screen.getByRole('table', { name: 'trace' })
  }

  it('draws every row at 200 and counts none of them', () => {
    const table = renderLines(VIRTUALIZE_ABOVE)
    expect(drawn(table)).toHaveLength(200)
    expect(spacers(table)).toEqual([])
    expect(table.getAttribute('aria-rowcount')).toBeNull()
    expect(drawn(table)[0]?.getAttribute('aria-rowindex')).toBeNull()
  })

  it('draws only the rows in view and a few more above 200, and holds the height of the rest', () => {
    const table = renderLines(1000)
    const rows = drawn(table)
    expect(rows.length).toBeGreaterThan(9)
    expect(rows.length).toBeLessThan(40)
    expect(rows[0]?.textContent).toBe('cycle 0')
    // No spacer above the first row; one below with the height of every row not drawn.
    expect(spacers(table)).toEqual([(1000 - rows.length) * 24])
    // Assistive tech still hears the whole table: the header is row 1, cycle 0 is row 2.
    expect(table.getAttribute('aria-rowcount')).toBe('1001')
    expect(rows[0]?.getAttribute('aria-rowindex')).toBe('2')
    expect(table.querySelector('thead tr')?.getAttribute('aria-rowindex')).toBe('1')
  })

  it('moves the drawn rows with the scroll, and the spacers keep the total height', () => {
    const table = renderLines(1000)
    const box = table.parentElement as HTMLElement
    box.scrollTop = 24 * 500
    fireEvent.scroll(box)
    const rows = drawn(table)
    const cycles = rows.map((row) => Number(row.textContent?.replace('cycle ', '')))
    expect(cycles).toContain(500)
    expect(cycles).toContain(508)
    expect(cycles).not.toContain(0)
    expect(cycles).toEqual(cycles.map((_, i) => (cycles[0] as number) + i))
    const [above, below] = spacers(table)
    expect(above).toBe((cycles[0] as number) * 24)
    expect((above ?? 0) + rows.length * 24 + (below ?? 0)).toBe(1000 * 24)
    expect(rows[0]?.getAttribute('aria-rowindex')).toBe(String((cycles[0] as number) + 2))
  })

  it('sorts all the rows, not only the ones drawn', () => {
    undo.push(stubLayout('offsetHeight', () => 240))
    render(
      <Table
        columns={[{ ...(LINE_COLUMNS[0] as TableColumn<Line>), sortValue: (line) => line.n }]}
        rows={lines(1000)}
        rowKey={(line) => line.n}
        aria-label="trace"
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'cycle' }))
    const table = screen.getByRole('table', { name: 'trace' })
    expect(drawn(table)[0]?.textContent).toBe('cycle 999')
    expect(drawn(table)[1]?.textContent).toBe('cycle 998')
  })
})
