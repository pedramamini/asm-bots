import { BookOpen, CodeXml, Grid2x2, Mountain, Palette, RefreshCw, Trophy } from 'lucide-react'
import { Button } from '../primitives/Button'
import { Chip } from '../primitives/Chip'
import { Header } from '../primitives/Header'
import { IconButton } from '../primitives/IconButton'
import { Input } from '../primitives/Input'
import { NavButton } from '../primitives/NavButton'
import { Panel } from '../primitives/Panel'
import { PanelGrid } from '../primitives/PanelGrid'
import { Segmented } from '../primitives/Segmented'
import { Select } from '../primitives/Select'
import { SplitPane } from '../primitives/SplitPane'
import { StatusBar } from '../primitives/StatusBar'
import { Ticker } from '../primitives/Ticker'
import { Toggle } from '../primitives/Toggle'
import { Toolbar } from '../primitives/Toolbar'
import type { Theme } from '../themes'
import { ArenaMock } from './ArenaMock'
import { Specimen, State, States, stay } from './specimen'

/** The PanelGrid sheet's rows, as the spans of their cells. The class names stay literal. */
const SPANS = [
  ['col-span-12'],
  ['col-span-8', 'col-span-4'],
  ['col-span-6', 'col-span-6'],
  ['col-span-4', 'col-span-4', 'col-span-4'],
  ['col-span-3', 'col-span-3', 'col-span-3', 'col-span-3'],
  ['col-span-2', 'col-span-2', 'col-span-2', 'col-span-2', 'col-span-2', 'col-span-2'],
] as const

const NAV = [
  { route: 'arena', icon: Grid2x2 },
  { route: 'editor', icon: CodeXml },
  { route: 'tournaments', icon: Trophy },
  { route: 'hills', icon: Mountain },
  { route: 'docs', icon: BookOpen },
] as const

/**
 * Panel, PanelGrid, Ticker, Header, Toolbar, StatusBar, SplitPane: each in each of its states.
 * `theme` draws the arena the status row lies over.
 */
export function LayoutSpecimens({ theme }: { theme: Theme }) {
  return (
    <>
      <Specimen name="Panel" status="5 states" className="col-span-12">
        <PanelGrid>
          <Panel className="col-span-4" title="standings" status="32 entrants">
            <p className="text-data text-muted">title left in accent, status right, muted.</p>
          </Panel>
          <Panel
            className="col-span-8"
            title="traffic of the main hill"
            status="week"
            actions={
              <>
                <Segmented
                  label="range"
                  options={['week', 'month', 'quarter', 'year']}
                  defaultValue="week"
                />
                <Button icon={RefreshCw}>refresh</Button>
              </>
            }
          >
            <p className="text-data text-muted">
              actions overhang the title row, so the hairline stays level with the panels beside.
            </p>
          </Panel>
          <Panel className="col-span-4" title="events" status="dense" dense>
            <p className="text-data text-muted">dense: padding 8, for rails and nested panels.</p>
          </Panel>
          <Panel className="col-span-4" aria-label="untitled panel">
            <p className="text-data text-muted">no title: a plain surface, padding 12.</p>
          </Panel>
          <Panel
            className="col-span-4"
            title="a title far too long for the space it has"
            status="cut"
          >
            <p className="text-data text-muted">a long title ends in an ellipsis.</p>
          </Panel>
        </PanelGrid>
      </Specimen>

      <Specimen name="PanelGrid" status="12 cols · 12 px gutters" className="col-span-6">
        <PanelGrid className="gap-y-2">
          {SPANS.flatMap((row, r) =>
            row.map((span, c) => (
              <div
                // A cell of the sheet is known by its place.
                key={`${r}:${c}`}
                className={`${span} flex h-6 items-center justify-center rounded-sm border border-accent-25 bg-accent-10 text-panel-status text-accent-fg`}
              >
                {span.slice('col-span-'.length)}
              </div>
            )),
          )}
        </PanelGrid>
      </Specimen>

      <Specimen name="Ticker" status="fits · scrolls" className="col-span-6">
        <States>
          <State label="fits">
            <Ticker
              className="w-full border border-border"
              items={[<b key="lead">▍LIVE</b>, 'HILL "MAIN"', 'dwarf-v3 took #1', '12,480 cycles']}
              link={{ href: '#hill', label: 'open the main hill', onClick: stay }}
            />
          </State>
          <State label="scrolls">
            <Ticker
              className="w-full border border-border"
              items={[
                <b key="lead">▍LIVE</b>,
                'HILL "MAIN"',
                'paper-v2 climbed to #3 with 177.2 points',
                'silk-v5 missed the hill by 19 points',
                'next championship in 2d 04:12',
              ]}
              link={{ href: '#hill', label: 'open the main hill', onClick: stay }}
            />
          </State>
          <State label="no link">
            <Ticker className="w-full border border-border" items={['quiet hill', 'no fights']} />
          </State>
        </States>
        <p className="mt-3 text-data text-muted">
          wider than the bar: a marquee, paused under the pointer. reduced motion: still, with an
          ellipsis.
        </p>
      </Specimen>

      <Specimen name="Header" status="all slots · brand and nav" className="col-span-12">
        <div className="flex flex-col gap-3">
          <Header
            className="border border-border"
            brand={
              <>
                ASM BOTS <span className="text-muted">{'// arena'}</span>
              </>
            }
            stat="8 bots · 41 procs · cycle 12,480"
            nav={NAV.map(({ route, icon }) => (
              <NavButton
                key={route}
                href={`#${route}`}
                icon={icon}
                active={route === 'arena'}
                onClick={stay}
              >
                {route}
              </NavButton>
            ))}
            navLabel="specimen"
            right={<IconButton icon={Palette} label="theme" shortcut="t" />}
          />
          <Header
            className="border border-border"
            brand="ASM BOTS"
            nav={
              <NavButton href="#docs" icon={BookOpen} active onClick={stay}>
                docs
              </NavButton>
            }
            navLabel="specimen, brand and nav"
          />
        </div>
      </Specimen>

      <Specimen name="Toolbar" status="← → home end move focus" className="col-span-12">
        <Toolbar aria-label="specimen filters" className="border border-border">
          <Input className="w-72" placeholder="search bots..." aria-label="search bots" />
          <Select aria-label="hill" className="w-36" defaultValue="all hills">
            <option>all hills</option>
            <option>main</option>
          </Select>
          <Select aria-label="size" className="w-32" defaultValue="any size">
            <option>any size</option>
            <option>≤ 512 B</option>
          </Select>
          <Toggle>verified</Toggle>
          <Toggle defaultPressed>mine</Toggle>
          <Button variant="ghost">clear</Button>
        </Toolbar>
      </Specimen>

      <Specimen name="StatusBar" status="a row · over the arena" className="col-span-6">
        <States>
          <State label="row">
            <div className="w-full rounded-sm border border-border bg-bg py-2">
              <StatusBar
                left={<Chip variant="warn">reconnecting</Chip>}
                center={<Chip>made with maestro</Chip>}
                right={
                  <>
                    <Chip>2026.09.23</Chip>
                    <Chip variant="accent">60 fps</Chip>
                  </>
                }
              />
            </div>
          </State>
          <State label="over arena" top>
            <ArenaMock
              theme={theme}
              cell={3}
              origin={0x2800}
              label="the arena under a status row"
              className="h-28 w-full rounded-sm"
            >
              <StatusBar
                className="absolute inset-x-0 bottom-2"
                center={<Chip>made with maestro</Chip>}
                right={<Chip variant="accent">60 fps</Chip>}
              />
            </ArenaMock>
          </State>
        </States>
        <p className="mt-3 text-data text-muted">
          the center chip holds the page's center line; only the chips take the pointer.
        </p>
      </Specimen>

      <Specimen name="SplitPane" status="row · column · focus" className="col-span-6">
        <SplitPane
          label="editor width"
          defaultRatio={0.58}
          className="h-44"
          data-force="focus focus-visible"
          data-force-target="[role=separator]"
        >
          <Pane name="editor" note="58% · focused divider" />
          <SplitPane
            label="registers height"
            direction="column"
            defaultRatio={0.4}
            className="h-full"
          >
            <Pane name="registers" note="40%" />
            <Pane name="memory" note="60%" />
          </SplitPane>
        </SplitPane>
      </Specimen>
    </>
  )
}

/** A pane of the SplitPane sheet: its name and its share. */
function Pane({ name, note }: { name: string; note: string }) {
  return (
    <div className="flex h-full flex-col justify-between rounded-sm bg-panel-2 p-2">
      <span className="text-panel-title text-accent-fg">{name}</span>
      <span className="text-data text-muted">{note}</span>
    </div>
  )
}
