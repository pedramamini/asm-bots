import { beforeAll, describe, expect, it, jest } from 'bun:test'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { Copy, Grid2x2, Play, ShieldCheck, StepBack, Trash2 } from 'lucide-react'
import { useEffect } from 'react'
import {
  Button,
  Chip,
  EmptyState,
  Header,
  Hex,
  HueSwatch,
  IconButton,
  Identicon,
  Input,
  Kbd,
  KeyHelp,
  Menu,
  Modal,
  NavButton,
  Panel,
  PanelGrid,
  RadarLoader,
  Segmented,
  Select,
  Skeleton,
  Slider,
  Sparkline,
  SplitPane,
  Stat,
  StatusBar,
  Table,
  type TableColumn,
  Ticker,
  Toast,
  ToastProvider,
  Toggle,
  Toolbar,
  useToast,
} from '../../src/index'
import { stubLayout, useDom } from '../dom'
import { compileKit, hasRule, MARKER } from '../tailwind'

useDom()

let build: (candidates: string[]) => string = () => ''
beforeAll(async () => {
  const kit = await compileKit()
  build = (candidates) => kit.build(candidates)
})

/** Every control in every state that changes its classes, the tooltip and the menu open. */
function Controls() {
  return (
    <>
      <NavButton href="/arena" icon={Grid2x2} active>
        arena
      </NavButton>
      <NavButton href="/editor" icon={Grid2x2}>
        editor
      </NavButton>
      <Button>refresh</Button>
      <Button variant="primary" icon={Play}>
        fight
      </Button>
      <Button variant="ghost" size="sm">
        clear
      </Button>
      <Button variant="danger" disabled>
        delete
      </Button>
      <Button loading>submit</Button>
      <IconButton icon={StepBack} label="step back" shortcut="," />
      <IconButton icon={StepBack} label="minimap" size="sm" pressed />
      <Segmented
        label="range"
        options={['week', 'month', { value: 'year', disabled: true }]}
        defaultValue="week"
      />
      <Input aria-label="search" />
      <Input aria-label="goto" mono prompt={null} />
      <Select aria-label="hill">
        <option>all hills</option>
      </Select>
      <Slider aria-label="volume" min={0} max={100} />
      <Slider aria-label="speed" min={1} max={10_000} scale="log" showValue />
      <Toggle>alpr</Toggle>
      <Toggle defaultPressed>bloom</Toggle>
      <Chip>3 active</Chip>
      <Chip variant="accent" icon={ShieldCheck}>
        verified
      </Chip>
      <Chip variant="warn">warn</Chip>
      <Chip variant="danger">dead</Chip>
      <Chip variant="info">info</Chip>
      <Kbd>space</Kbd>
      <Menu
        trigger={<Button>templates</Button>}
        items={[
          { label: 'blank', onSelect() {} },
          { label: 'dwarf', icon: Copy, shortcut: 'd', onSelect() {} },
          { label: 'scanner', disabled: true, onSelect() {} },
          'separator',
          { label: 'delete', icon: Trash2, danger: true, onSelect() {} },
        ]}
      />
    </>
  )
}

interface Row {
  n: number
}
const ROW_COLUMNS: TableColumn<Row>[] = [
  { id: 'n', header: 'n', align: 'right', sortValue: (row) => row.n, cell: (row) => row.n },
  {
    id: 'name',
    header: 'name',
    align: 'center',
    sortValue: (row) => `bot-${row.n}`,
    cell: () => 'x',
  },
  { id: 'plain', header: 'plain', cell: () => 'y' },
]
const rows = (count: number) => Array.from({ length: count }, (_, n) => ({ n }))

/** Shows one toast as it mounts: the provider's stack draws only toasts it holds. */
function ShowToast() {
  const { toast } = useToast()
  useEffect(() => {
    toast('link copied', { variant: 'accent', action: { label: 'open', onClick() {} } })
  }, [toast])
  return null
}

/** Every data display and feedback primitive in every state that changes its classes. */
function DataDisplay() {
  return (
    <ToastProvider>
      <ShowToast />
      {/* Sorted each way; past 200 rows, with spacers above and below. */}
      <Table
        columns={ROW_COLUMNS}
        rows={rows(3)}
        rowKey={(row) => row.n}
        defaultSort={{ column: 'n', direction: 'asc' }}
      />
      <Table
        columns={ROW_COLUMNS}
        rows={rows(3)}
        rowKey={(row) => row.n}
        defaultSort={{ column: 'name', direction: 'desc' }}
      />
      <Table className="h-60" columns={ROW_COLUMNS} rows={rows(1000)} rowKey={(row) => row.n} />
      <Table
        columns={ROW_COLUMNS}
        rows={[]}
        rowKey={(row) => row.n}
        empty={<EmptyState action={{ label: 'add', href: '/add' }}>none.</EmptyState>}
      />
      <EmptyState action={{ label: 'add', onClick() {} }}>none.</EmptyState>
      <Stat label="cycles" value="12,480" delta={3} note="vs last">
        <Sparkline values={[1, 2]} />
      </Stat>
      <Stat label="bots" value="8" delta={-2} />
      <Stat label="procs" value="41" delta={0} />
      <Stat label="footprint" loading />
      <Sparkline values={[1, 2]} hue={3} />
      <Identicon value="imp" />
      <Identicon value="imp" hue={3} />
      <HueSwatch hue={1} />
      <HueSwatch hue={13} />
      <Hex value={0x1a2f} />
      <Hex byte value={0xff} />
      <Skeleton className="h-2.5 w-24" />
      <Skeleton rows={2} />
      <RadarLoader framed label="loading" detail="3 left" />
      <RadarLoader />
      <KeyHelp
        bindings={[
          { keys: ['g', 'a'], description: 'go to arena', group: 'global' },
          { keys: ['f'], description: 'fullscreen' },
        ]}
      />
      {(['neutral', 'accent', 'warn', 'danger', 'info'] as const).map((variant) => (
        <Toast key={variant} variant={variant} onDismiss={() => {}}>
          {variant}
        </Toast>
      ))}
      {(['sm', 'md', 'lg'] as const).map((size) => (
        <Modal
          key={size}
          open
          size={size}
          title={size}
          onClose={() => {}}
          actions={<Button>ok</Button>}
        >
          body
        </Modal>
      ))}
    </ToastProvider>
  )
}

describe('the primitives’ classes', () => {
  it('each compile to a rule, in every state (a mistyped class is otherwise silent)', () => {
    // The states that add classes: a marquee, a drag in each direction, a dense panel, a table
    // scrolled into the middle of its rows.
    const undo = [
      stubLayout('scrollWidth', () => 900),
      stubLayout('clientWidth', () => 300),
      stubLayout('offsetHeight', () => 240),
    ]
    try {
      render(
        <>
          <Ticker items={['live', 'cycle 12']} link={{ href: '/', label: 'home' }} />
          <Header
            brand="ASM BOTS"
            stat="8 bots"
            nav={<a href="/arena">arena</a>}
            right={<button type="button">theme</button>}
          />
          <Toolbar>
            <button type="button">run</button>
          </Toolbar>
          <PanelGrid>
            <Panel title="arena" status="live" actions={<button type="button">refresh</button>} />
            <Panel title="queue" dense />
          </PanelGrid>
          <SplitPane label="rows">
            <p>editor</p>
            <p>debugger</p>
          </SplitPane>
          <SplitPane label="columns" direction="column">
            <p>editor</p>
            <p>arena</p>
          </SplitPane>
          <StatusBar left="ok" center="made with maestro" right="60 fps" />
          <Controls />
          <DataDisplay />
        </>,
      )
      const long = document.querySelector('.h-60') as HTMLElement
      long.scrollTop = 24 * 500
      fireEvent.scroll(long)
    } finally {
      for (const restore of undo) restore()
    }
    // Open the tooltip and the menu.
    jest.useFakeTimers()
    try {
      fireEvent.pointerEnter(screen.getByRole('button', { name: 'step back' }), {
        pointerType: 'mouse',
      })
      act(() => {
        jest.advanceTimersByTime(400)
      })
    } finally {
      jest.useRealTimers()
    }
    fireEvent.click(screen.getByRole('button', { name: 'templates' }))
    expect(document.querySelector('[role=tooltip]')).not.toBeNull()
    expect(document.querySelector('[role=menu]')).not.toBeNull()
    for (const divider of document.querySelectorAll('[role=separator]')) {
      fireEvent.pointerDown(divider, { pointerId: 1, button: 0 })
    }
    expect(document.querySelector('[inert]')).not.toBeNull()
    expect(document.querySelectorAll('[data-dragging]')).toHaveLength(2)
    // A spacer above the drawn rows and one below; a toast in the stack; three open modals.
    expect(document.querySelectorAll('.h-60 tbody tr[aria-hidden]')).toHaveLength(2)
    expect(document.querySelectorAll('section[aria-label=notifications] li')).toHaveLength(1)
    expect(document.querySelectorAll('dialog[open]')).toHaveLength(3)

    const names = new Set(
      [...document.body.querySelectorAll('[class]')].flatMap((element) => [...element.classList]),
    )
    const css = build([...names])
    expect([...names].filter((name) => !MARKER.test(name) && !hasRule(css, name))).toEqual([])
    expect(names.size).toBeGreaterThan(280)
  })

  it('catches a mistyped class', async () => {
    // A compiler of its own: a compiler's output holds every class it has built so far.
    const css = (await compileKit()).build(['bg-panel', 'text-mutd', 'p-2.5'])
    expect(hasRule(css, 'bg-panel')).toBe(true)
    expect(hasRule(css, 'text-mutd')).toBe(false)
    expect(hasRule(css, 'p-2')).toBe(false)
  })
})
