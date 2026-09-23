import { useVirtualizer } from '@tanstack/react-virtual'
import { type ComponentProps, type ReactNode, useMemo, useRef } from 'react'
import { FOCUS_RING } from '../control'
import { useControllable } from '../hooks/useControllable'
import { hasContent } from '../node'
import { cx, vars } from '../style'

/** A table with more rows than this draws only the rows in view, and a few past each edge. */
export const VIRTUALIZE_ABOVE = 200
/** Every row's height, px: `h-6`. The virtual window counts on it. */
const ROW_HEIGHT = 24
/** Rows drawn past each edge of the view, so a fast scroll shows no gap. */
const OVERSCAN = 8

export type SortDirection = 'asc' | 'desc'

/** The column the rows sort by, and which way. */
export interface TableSort {
  column: string
  direction: SortDirection
}

export interface TableColumn<Row> {
  /** Names the column: its React key, and what `TableSort.column` holds. */
  id: string
  /** The header, muted UPPER 10 px: `procs`. */
  header: ReactNode
  /** The cell of `row`. */
  cell: (row: Row) => ReactNode
  /** `right` for numerics: counts, bytes, cycles, points. */
  align?: 'left' | 'center' | 'right' | undefined
  /** The value the column sorts by: numbers in order, strings in natural order. None: no sort. */
  sortValue?: ((row: Row) => number | string) | undefined
  /** The first click's direction: largest first for a right-aligned column, else A to Z. */
  sortFirst?: SortDirection | undefined
  /** Classes on the column's header and cells: its width (`w-16`), its color. */
  className?: string | undefined
}

export interface TableProps<Row> extends Omit<ComponentProps<'table'>, 'children'> {
  columns: readonly TableColumn<Row>[]
  rows: readonly Row[]
  /** A row's identity, the same across sorts and updates. */
  rowKey: (row: Row) => string | number
  /** The sort, when the caller holds the state; null for none. */
  sort?: TableSort | null | undefined
  /** The sort at first, when the table holds its own state. */
  defaultSort?: TableSort | undefined
  onSortChange?: ((sort: TableSort) => void) | undefined
  /** What shows in place of the rows when there are none: an EmptyState. */
  empty?: ReactNode
}

const ALIGN = { left: 'text-left', center: 'text-center', right: 'text-right' } as const

/** Every cell: the row's height, 8 px apart, flush with the table's edges, cut off with an ellipsis. */
const CELL = 'h-6 truncate px-2 first:pl-0 last:pr-0'

/** Natural order: `dwarf-v9` before `dwarf-v10`. */
const COLLATOR = new Intl.Collator('en', { numeric: true })

/**
 * A data table (DESIGN_SYSTEM §4): 12 px tabular data in 24 px rows, hairlines between the rows
 * and none around them, headers in muted UPPER 10 px that stay on top as the rows scroll. A column
 * with a `sortValue` sorts from its header; the sorted header reads `aria-sort`. The row under the
 * pointer takes `--panel-2`. Past 200 rows only the rows in view are drawn (the table then counts
 * all of them in `aria-rowcount`), so give the table a height (`h-80`, or `flex-1` in a column).
 * Columns lay out from the header row (`table-fixed`): give the narrow ones a width and the rest
 * share the remainder, so live numbers never shift a column. `className` goes on the scroll box;
 * every other prop, the ref included, goes to the `<table>`.
 */
export function Table<Row>({
  columns,
  rows,
  rowKey,
  sort,
  defaultSort,
  onSortChange,
  empty,
  className,
  ...rest
}: TableProps<Row>) {
  const [current, setCurrent] = useControllable<TableSort | null>(
    sort,
    defaultSort ?? null,
    (next) => {
      if (next !== null) onSortChange?.(next)
    },
  )
  const sorted = useMemo(() => sortRows(rows, columns, current), [rows, columns, current])
  const scroller = useRef<HTMLDivElement>(null)
  const virtual = sorted.length > VIRTUALIZE_ABOVE
  const virtualizer = useVirtualizer({
    count: virtual ? sorted.length : 0,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
    // The header row sits above the first row in the scroll box.
    scrollMargin: ROW_HEIGHT,
  })

  const items = virtual ? virtualizer.getVirtualItems() : []
  const drawn = virtual
    ? items.map((item) => ({ row: sorted[item.index] as Row, index: item.index }))
    : sorted.map((row, index) => ({ row, index }))
  const first = items[0]
  const last = items.at(-1)
  const above = first === undefined ? 0 : first.start - ROW_HEIGHT
  const below = last === undefined ? 0 : virtualizer.getTotalSize() - (last.end - ROW_HEIGHT)

  const toggle = (column: TableColumn<Row>) => {
    const firstWay = column.sortFirst ?? (column.align === 'right' ? 'desc' : 'asc')
    const direction =
      current?.column === column.id ? (current.direction === 'asc' ? 'desc' : 'asc') : firstWay
    setCurrent({ column: column.id, direction })
  }

  return (
    <div ref={scroller} className={cx('min-h-0 min-w-0 overflow-auto', className)}>
      <table
        aria-rowcount={virtual ? sorted.length + 1 : undefined}
        {...rest}
        className="w-full table-fixed border-separate border-spacing-0 text-data text-text"
      >
        <thead>
          <tr aria-rowindex={virtual ? 1 : undefined}>
            {columns.map((column) => {
              const direction = current?.column === column.id ? current.direction : undefined
              return (
                <th
                  key={column.id}
                  scope="col"
                  aria-sort={direction && (direction === 'asc' ? 'ascending' : 'descending')}
                  className={cx(
                    CELL,
                    'sticky top-0 z-1 border-b border-border bg-panel text-panel-status',
                    direction === undefined ? 'text-muted' : 'text-text',
                    ALIGN[column.align ?? 'left'],
                    column.className,
                  )}
                >
                  {column.sortValue === undefined ? (
                    column.header
                  ) : (
                    <SortButton
                      direction={direction}
                      right={column.align === 'right'}
                      onClick={() => toggle(column)}
                    >
                      {column.header}
                    </SortButton>
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {above > 0 && <Spacer height={above} span={columns.length} />}
          {drawn.map(({ row, index }) => (
            <tr
              key={rowKey(row)}
              aria-rowindex={virtual ? index + 2 : undefined}
              className="group/row transition-colors duration-120 ease-out hover:bg-panel-2"
            >
              {columns.map((column) => (
                <td
                  key={column.id}
                  className={cx(
                    CELL,
                    'border-b border-border group-last/row:border-b-0',
                    ALIGN[column.align ?? 'left'],
                    column.className,
                  )}
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
          {below > 0 && <Spacer height={below} span={columns.length} />}
          {sorted.length === 0 && hasContent(empty) && (
            <tr>
              <td colSpan={columns.length} className="p-0">
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

interface SortButtonProps {
  direction: SortDirection | undefined
  /** A right-aligned header puts the arrow before its label, so the label ends with the numbers. */
  right: boolean
  onClick: () => void
  children: ReactNode
}

function SortButton({ direction, right, onClick, children }: SortButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'inline-flex max-w-full cursor-pointer items-center gap-1 uppercase transition-colors duration-120 ease-out hover:text-bright',
        right && 'flex-row-reverse',
        FOCUS_RING,
      )}
    >
      <span className="truncate">{children}</span>
      {direction !== undefined && (
        <span aria-hidden="true" className="text-accent">
          {direction === 'asc' ? '↑' : '↓'}
        </span>
      )}
    </button>
  )
}

/** The height of the rows not drawn, above or below the ones that are. */
function Spacer({ height, span }: { height: number; span: number }) {
  return (
    // biome-ignore lint/a11y/noAriaHiddenOnFocusable: a row takes no focus; this one only holds space.
    <tr aria-hidden="true" className="h-(--rows)" style={vars({ '--rows': `${height}px` })}>
      <td colSpan={span} className="p-0" />
    </tr>
  )
}

/** `rows` in the order of `sort`: equal values keep the order they came in. */
function sortRows<Row>(
  rows: readonly Row[],
  columns: readonly TableColumn<Row>[],
  sort: TableSort | null,
): readonly Row[] {
  const value = columns.find((column) => column.id === sort?.column)?.sortValue
  if (sort === null || value === undefined) return rows
  const sign = sort.direction === 'asc' ? 1 : -1
  return rows
    .map((row, index) => ({ row, index, key: value(row) }))
    .sort((a, b) => sign * compare(a.key, b.key) || a.index - b.index)
    .map(({ row }) => row)
}

function compare(a: number | string, b: number | string): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return COLLATOR.compare(String(a), String(b))
}
