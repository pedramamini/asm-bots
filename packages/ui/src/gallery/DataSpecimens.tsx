import { CodeXml, Download, Grid2x2, Palette, Play, Swords, Trash2 } from 'lucide-react'
import { Fragment, type ReactNode, useState } from 'react'
import { hexByte } from '../hex'
import { Button } from '../primitives/Button'
import { CoachMark } from '../primitives/CoachMark'
import { CommandPalette, type PaletteCommand } from '../primitives/CommandPalette'
import { EmptyState } from '../primitives/EmptyState'
import { Hex } from '../primitives/Hex'
import { HueSwatch } from '../primitives/HueSwatch'
import { IconButton } from '../primitives/IconButton'
import { Identicon } from '../primitives/Identicon'
import { Input } from '../primitives/Input'
import { Kbd } from '../primitives/Kbd'
import { KeyHelp } from '../primitives/KeyHelp'
import { Modal } from '../primitives/Modal'
import { RadarLoader } from '../primitives/RadarLoader'
import { Select } from '../primitives/Select'
import { Skeleton } from '../primitives/Skeleton'
import { Sparkline } from '../primitives/Sparkline'
import { Stat } from '../primitives/Stat'
import { Table, type TableColumn } from '../primitives/Table'
import { Toast, useToast } from '../primitives/Toast'
import { vars } from '../style'
import { type Entrant, grouped, HILL, KEYS, KING_RATINGS, ramp, TRACE, type TraceRow } from './data'
import { Specimen, State, States, stay } from './specimen'

/** A compact standings table: the Table sheet's sorted state. */
const STANDING_COLUMNS: TableColumn<Entrant>[] = [
  {
    id: 'bot',
    header: 'bot',
    sortValue: (entrant) => entrant.name,
    cell: (entrant) => (
      <span className="inline-flex items-center gap-2">
        <Identicon value={entrant.name} size={16} hue={entrant.hue} />
        <span className="text-bright">{entrant.name}</span>
      </span>
    ),
  },
  {
    id: 'author',
    header: 'author',
    className: 'w-20',
    cell: (entrant) => <span className="text-muted">{entrant.author}</span>,
  },
  {
    id: 'score',
    header: 'score',
    align: 'right',
    className: 'w-16',
    sortValue: (entrant) => entrant.score,
    cell: (entrant) => entrant.score.toFixed(1),
  },
  {
    id: 'rating',
    header: 'rating',
    align: 'right',
    className: 'w-16',
    sortValue: (entrant) => entrant.rating,
    cell: (entrant) => grouped(entrant.rating),
  },
]

const TRACE_COLUMNS: TableColumn<TraceRow>[] = [
  {
    id: 'cycle',
    header: 'cycle',
    align: 'right',
    className: 'w-16',
    cell: (row) => grouped(row.cycle),
  },
  { id: 'address', header: 'addr', className: 'w-16', cell: (row) => <Hex value={row.address} /> },
  {
    id: 'bytes',
    header: 'bytes',
    className: 'w-22',
    cell: (row) => <span className="text-muted">{row.bytes.map(hexByte).join(' ')}</span>,
  },
  {
    id: 'text',
    header: 'instruction',
    cell: (row) => <span className="text-bright">{row.text}</span>,
  },
]

/** The Hex sheet's rows: the number, and whether it shows as a byte. */
const HEX_VALUES: readonly (readonly [value: number, byte: boolean, note: string])[] = [
  [0, false, 'zero'],
  [0x1a2f, false, 'an address'],
  [0xfffe, false, 'the stack top'],
  [0x1_0010, false, 'wraps to 16 bits'],
  [0x7b, true, 'a byte'],
  [0xff, true, 'the largest'],
  [0x1ff, true, 'wraps to 8 bits'],
]

/** Identicons need a value: the roster's bots, one per hue. */
const ROSTER = [
  'dwarf-v3',
  'imp-ring',
  'stone',
  'paper-v2',
  'scanner',
  'vampire',
  'silk',
  'gate',
  'decoy',
  'hybrid',
  'painter-lcg',
  'dwarf-wide',
] as const

/**
 * Table, Stat, Sparkline, Identicon, HueSwatch, Hex, Modal, Toast, Skeleton, RadarLoader,
 * EmptyState, KeyHelp, and CommandPalette: each in each of its states.
 */
export function DataSpecimens() {
  return (
    <>
      <Specimen name="Table" status="sorted · virtual · empty" className="col-span-12">
        <div className="grid grid-cols-12 gap-3">
          <div className="col-span-5 flex min-w-0 flex-col gap-2">
            <Label>sorted by score · the third row hovered</Label>
            <Table
              aria-label="sorted standings"
              columns={STANDING_COLUMNS}
              rows={HILL.slice(0, 7)}
              rowKey={(entrant) => entrant.name}
              defaultSort={{ column: 'score', direction: 'desc' }}
              data-force="hover"
              data-force-target="tbody tr:nth-child(3)"
            />
          </div>
          <div className="col-span-4 flex min-w-0 flex-col gap-2">
            <Label>1,000 rows · only those in view are drawn</Label>
            <Table
              aria-label="trace"
              className="h-50"
              columns={TRACE_COLUMNS}
              rows={TRACE}
              rowKey={(row) => row.n}
            />
          </div>
          <div className="col-span-3 flex min-w-0 flex-col gap-2">
            <Label>no rows</Label>
            <Table
              aria-label="empty hill"
              columns={STANDING_COLUMNS.slice(0, 3)}
              rows={[]}
              rowKey={(entrant) => entrant.name}
              empty={
                <EmptyState action={{ label: 'submit a bot', href: '#submit', onClick: stay }}>
                  no entrants yet.
                </EmptyState>
              }
            />
          </div>
        </div>
      </Specimen>

      <Specimen name="Stat" status="rise · fall · loading" className="col-span-12">
        <div className="grid grid-cols-3 gap-3">
          <Stat label="cycles" value="12,480" delta={1_204} note="vs last round">
            <Sparkline values={ramp(31, 40, 4, 20, 3)} width={56} height={24} />
          </Stat>
          <Stat label="bots alive" value="6 / 8" delta={-2} note="this round" />
          <Stat label="hill rank" value="#3" delta={-3} invert note="3 places up" />
          <Stat label="bot size" value="142 B" delta={12} invert note="vs v2" />
          <Stat label="ties" value="41" delta={0} note="no change" />
          <Stat label="footprint" loading />
        </div>
      </Specimen>

      <Specimen name="Sparkline" status="1 px · accent or hue" className="col-span-4">
        <States>
          <State label="accent">
            <Sparkline values={KING_RATINGS} width={160} height={24} />
          </State>
          <State label="hues" top>
            <div className="grid grid-cols-4 gap-x-3 gap-y-1.5">
              {Array.from({ length: 12 }, (_, hue) => (
                <Sparkline
                  key={hue}
                  values={ramp(40 + hue, 24, 2, 10, 3)}
                  hue={hue}
                  width={48}
                  height={14}
                />
              ))}
            </div>
          </State>
          <State label="flat · one">
            <Sparkline values={[5, 5, 5, 5]} width={64} height={14} />
            <Sparkline values={[5]} width={64} height={14} />
          </State>
          <State label="stretched">
            <Sparkline
              values={ramp(50, 60, 10, 40, 8)}
              width={200}
              height={20}
              className="w-full"
            />
          </State>
        </States>
      </Specimen>

      <Specimen name="Identicon" status="8 × 8 · mirrored" className="col-span-4">
        <States>
          <State label="sizes">
            {[16, 24, 32, 48, 64].map((size) => (
              <Identicon key={size} value="dwarf-v3" size={size} hue={0} />
            ))}
          </State>
          <State label="hues" top>
            <div className="grid grid-cols-6 gap-2">
              {ROSTER.map((name, hue) => (
                <Identicon key={name} value={name} size={32} hue={hue} />
              ))}
            </div>
          </State>
          <State label="hashed hue">
            {['imp', 'stone-age', 'vampire-x', 'silk-v4', 'decoy-z', 'gate-keeper'].map((name) => (
              <Identicon key={name} value={name} size={24} />
            ))}
          </State>
          <State label="accent">
            <Identicon value="dwarf-v3" size={24} hue="var(--accent)" />
          </State>
        </States>
      </Specimen>

      <Specimen name="HueSwatch" status="12 hues · 13+ hatched" className="col-span-4">
        <States>
          <State label="hues" top>
            <div className="grid grid-cols-6 gap-x-3 gap-y-1.5">
              {Array.from({ length: 12 }, (_, hue) => (
                <span key={hue} className="inline-flex items-center gap-1.5 text-data text-muted">
                  <HueSwatch hue={hue} size={12} />
                  {hue}
                </span>
              ))}
            </div>
          </State>
          <State label="wrapped">
            {[12, 13, 14, 15].map((hue) => (
              <span key={hue} className="inline-flex items-center gap-1.5 text-data text-muted">
                <HueSwatch hue={hue} size={12} />
                {hue}
              </span>
            ))}
          </State>
          <State label="sizes">
            {[10, 16, 24].map((size) => (
              <HueSwatch key={size} hue={4} size={size} />
            ))}
            {[10, 16, 24].map((size) => (
              <HueSwatch key={`w${size}`} hue={16} size={size} />
            ))}
          </State>
        </States>
      </Specimen>

      <Specimen name="Hex" status="the native unit" className="col-span-3">
        <div className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-x-4 gap-y-1 text-data">
          {HEX_VALUES.map(([value, byte, note]) => (
            <Fragment key={`${value}:${byte}`}>
              <span className="text-right text-muted">{grouped(value)}</span>
              <Hex value={value} byte={byte} className="text-bright" />
              <span className="truncate text-muted">{note}</span>
            </Fragment>
          ))}
        </div>
      </Specimen>

      <Specimen name="Modal" status="sm · md · lg" className="col-span-3">
        <ModalSheet />
      </Specimen>

      <Specimen name="Toast" status="5 variants · 5 s" className="col-span-6">
        <ToastSheet />
      </Specimen>

      <Specimen name="Skeleton" status="blocks · rows" className="col-span-4">
        <States>
          <State label="blocks">
            <Skeleton className="h-2.5 w-24" />
            <Skeleton className="h-6 w-16" />
            <Skeleton className="h-2.5 w-40" />
          </State>
          <State label="rows" top>
            <Skeleton rows={4} className="w-full" />
          </State>
          <State label="bars" top>
            <div aria-hidden="true" className="flex h-16 w-full items-end gap-1">
              {[0.4, 0.62, 0.8, 0.5, 0.7, 0.36, 0.9, 0.56].map((height) => (
                <Skeleton
                  key={height}
                  className="h-(--bar) flex-1"
                  style={vars({ '--bar': `${height * 100}%` })}
                />
              ))}
            </div>
          </State>
        </States>
      </Specimen>

      <Specimen name="RadarLoader" status="2 s turn" className="col-span-4">
        <div className="flex items-start justify-around gap-3">
          <RadarLoader label="loading demo" detail="4 bots · seed 0x1A2F" size={96} />
          <RadarLoader size={64} />
          <RadarLoader framed label="loading" detail="6 sections" size={80} />
        </div>
      </Specimen>

      <Specimen name="EmptyState" status="one sentence · one action" className="col-span-4">
        <States>
          <State label="link">
            <EmptyState action={{ label: 'submit a bot', href: '#submit', onClick: stay }}>
              no entrants yet.
            </EmptyState>
          </State>
          <State label="button">
            <EmptyState action={{ label: 'write one', onClick: () => {} }}>
              no local bots.
            </EmptyState>
          </State>
          <State label="dense">
            <EmptyState dense action={{ label: 'watch ip', onClick: () => {} }}>
              nothing watched yet.
            </EmptyState>
          </State>
        </States>
      </Specimen>

      <Specimen name="KeyHelp" status={`${KEYS.length} bindings`} className="col-span-8">
        <KeyHelp bindings={KEYS} />
      </Specimen>

      <Specimen name="CommandPalette" status="mod+k · type · ↑ ↓ · enter" className="col-span-4">
        <CommandPaletteSheet />
      </Specimen>

      <Specimen name="CoachMark" status="first visit · got it" className="col-span-4">
        <CoachMarkSheet />
      </Specimen>
    </>
  )
}

/**
 * The coach mark under an icon button and over a button, as the editor and the arena pin theirs:
 * the editor's one mark, and a step of the arena's tour. `got it` or `skip the tour` puts one
 * away; `show again` brings them back.
 */
function CoachMarkSheet() {
  const [shown, setShown] = useState({ under: true, over: true })
  return (
    <div className="flex h-full min-h-60 flex-col justify-between gap-3">
      <span className="relative flex self-start">
        <IconButton icon={Play} label="run" shortcut="F5" />
        {shown.under && (
          <CoachMark onDismiss={() => setShown({ ...shown, under: false })}>
            assemble runs as you type; press <Kbd>F5</Kbd> to debug.
          </CoachMark>
        )}
      </span>
      <span className="flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={shown.under && shown.over}
          onClick={() => setShown({ under: true, over: true })}
        >
          show again
        </Button>
        <span className="relative flex">
          <Button icon={Swords}>fight</Button>
          {shown.over && (
            <CoachMark
              placement="top-end"
              step="2/3"
              dismissLabel="skip the tour"
              onDismiss={() => setShown({ ...shown, over: false })}
            >
              fight loads the bots into one core and plays the battle.
            </CoachMark>
          )}
        </span>
      </span>
    </div>
  )
}

/** A muted caption over a sheet's part. */
function Label({ children }: { children: ReactNode }) {
  return <span className="text-panel-status text-muted">{children}</span>
}

/** Buttons that open the modal at each size, each with the content it has in the app. */
function ModalSheet() {
  const [open, setOpen] = useState<'sm' | 'md' | 'lg' | null>(null)
  const close = () => setOpen(null)
  return (
    <>
      <States>
        <State label="sm · 360">
          <Button size="sm" onClick={() => setOpen('sm')}>
            open sm
          </Button>
        </State>
        <State label="md · 480">
          <Button size="sm" onClick={() => setOpen('md')}>
            open md
          </Button>
        </State>
        <State label="lg · 640">
          <Button size="sm" onClick={() => setOpen('lg')}>
            open lg
          </Button>
        </State>
      </States>
      <p className="mt-3 text-data text-muted">
        escape, the overlay, and the close button dismiss it; tab stays inside.
      </p>
      <Modal
        open={open === 'sm'}
        onClose={close}
        size="sm"
        title="delete bot"
        actions={
          <>
            <Button variant="ghost" onClick={close}>
              cancel
            </Button>
            <Button variant="danger" icon={Trash2} onClick={close}>
              delete
            </Button>
          </>
        }
      >
        <p>
          delete <b className="text-bright">dwarf-v3</b> and its 12 versions? hill entries keep its
          name.
        </p>
      </Modal>
      <Modal
        open={open === 'md'}
        onClose={close}
        size="md"
        title="submit to hill"
        actions={
          <>
            <Button variant="ghost" onClick={close}>
              cancel
            </Button>
            <Button variant="primary" icon={Swords} onClick={close}>
              submit · 32 fights
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p>
            the server assembles the bot and fights every entrant of{' '}
            <b className="text-bright">main</b>, 10 rounds each. the top 32 stay on the hill.
          </p>
          <States>
            <State label="bot">
              <Select aria-label="bot" className="w-full" defaultValue="dwarf-v4">
                <option>dwarf-v4</option>
                <option>silk-v5</option>
              </Select>
            </State>
            <State label="note">
              <Input className="w-full" placeholder="what changed" aria-label="note" />
            </State>
          </States>
        </div>
      </Modal>
      <Modal
        open={open === 'lg'}
        onClose={close}
        size="lg"
        title="keys"
        actions={
          <Button icon={Download} onClick={close}>
            print
          </Button>
        }
      >
        <KeyHelp bindings={KEYS} />
      </Modal>
    </>
  )
}

/** A button that opens the palette on a few routes and themes; a theme picked is checked next time. */
function CommandPaletteSheet() {
  const [open, setOpen] = useState(false)
  const [theme, setTheme] = useState('sentinel')
  const commands: PaletteCommand[] = [
    {
      id: 'arena',
      group: 'go',
      label: 'go to arena',
      icon: Grid2x2,
      keys: ['g', 'a'],
      run: () => {},
    },
    {
      id: 'editor',
      group: 'go',
      label: 'go to editor',
      icon: CodeXml,
      keys: ['g', 'e'],
      run: () => {},
    },
    ...['sentinel', 'amber', 'ice'].map((name) => ({
      id: name,
      group: 'theme',
      label: name,
      icon: Palette,
      current: name === theme,
      run: () => setTheme(name),
    })),
  ]
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        open the palette
      </Button>
      <p className="mt-3 text-data text-muted">
        every word typed must match; the field keeps the focus. picked: {theme}.
      </p>
      <CommandPalette open={open} onClose={() => setOpen(false)} commands={commands} />
    </>
  )
}

/** Every toast variant in place, and a button that sends three into the live stack. */
function ToastSheet() {
  const { toast } = useToast()
  const send = () => {
    toast('saved dwarf-v3 · 142 B')
    toast('link copied', { variant: 'accent' })
    toast('submission failed: the hill is full', {
      variant: 'danger',
      action: { label: 'retry', onClick: () => {} },
    })
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        <Toast onDismiss={() => {}}>saved dwarf-v3 · 142 B</Toast>
        <Toast variant="accent" onDismiss={() => {}}>
          link copied
        </Toast>
        <Toast variant="warn" onDismiss={() => {}}>
          slow frame: 41 ms
        </Toast>
        <Toast variant="danger" action={{ label: 'retry', onClick: () => {} }} onDismiss={() => {}}>
          submission failed
        </Toast>
        <Toast variant="info">queued: 24 of 32 entrants</Toast>
      </div>
      <div className="flex items-center gap-3">
        <Button size="sm" onClick={send}>
          send 3 toasts
        </Button>
        <span className="text-data text-muted">bottom right, newest last, 5 s each.</span>
      </div>
    </div>
  )
}
