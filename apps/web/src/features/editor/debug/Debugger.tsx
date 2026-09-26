/**
 * The debugger of the editor page (PRODUCT_SPEC §3): its controls (what it loads: the bot in the
 * editor, the opponents, the seed; the transport; where it stopped) and its panels: Registers,
 * Processes, Memory, Watch, Breakpoints, and Trace. The page's layout places each
 * (`layout/Workspace.tsx`).
 */
import {
  Button,
  Chip,
  cx,
  HueSwatch,
  hexAddress,
  IconButton,
  Input,
  Menu,
  type MenuEntry,
  Panel,
  Slider,
} from '@asmbots/ui'
import {
  ArrowDownToDot,
  ArrowUpFromDot,
  ChevronsRight,
  Dices,
  FastForward,
  Pause,
  Play,
  Plus,
  RedoDot,
  RefreshCw,
  RotateCcw,
  Skull,
  StepBack,
  TextCursorInput,
  X,
} from 'lucide-react'
import { type KeyboardEvent, type ReactNode, useState } from 'react'
import { type CatalogBot, rosterCatalog } from '../../arena/setup/bots'
import { MAX_ARENA_BOTS, randomSeed, SEED } from '../../arena/setup/config'
import type { BotRef } from '../../arena/setup/url'
import { MAX_CYCLES_PER_FRAME } from '../../arena/worker/protocol'
import { useEditorPrefs } from '../store'
import { BreakpointsPanel } from './BreakpointsPanel'
import type { RunGoal } from './controller'
import { labelOf } from './image'
import type { DebugCommands } from './keys'
import { MemoryPanel } from './MemoryPanel'
import { ProcessesPanel } from './ProcessesPanel'
import { RegistersPanel } from './RegistersPanel'
import type { DebugState } from './session'
import { TracePanel } from './TracePanel'
import type { DebuggerModel } from './useDebugger'
import { WatchPanel } from './WatchPanel'

export interface DebugControlsProps {
  model: DebuggerModel
  commands: DebugCommands
  /** `run to cursor`: the address of the editor cursor's line, or why there is none. */
  cursorAddress: () => number | string
  /** Tells the user why a control did nothing. */
  notify: (message: string) => void
  /**
   * A coach mark under the transport, its caret at run: the editor's first visit (PRODUCT_SPEC §9).
   * Inline: over the panels, its button would sit on their fields.
   */
  coach?: ReactNode | undefined
}

const count = (n: number) => n.toLocaleString('en-US')

/**
 * The debugger's controls, top down: where it stands, the transport, the speed and `run N`, and
 * under a hairline what it loads. Each group of controls wraps as one, so a narrow tile breaks the
 * rows between groups, never inside one.
 */
export function DebugControls({
  model,
  commands,
  cursorAddress,
  notify,
  coach,
}: DebugControlsProps) {
  const { snapshot } = model
  return (
    <Panel dense title="debug" aria-label="debug controls">
      <div className="flex min-w-0 flex-col gap-2">
        <StopLine state={snapshot.state} running={snapshot.running} model={model} />
        {snapshot.error !== null && (
          <p role="alert" className="text-data text-danger">
            {snapshot.error}
          </p>
        )}
        <Transport
          model={model}
          commands={commands}
          cursorAddress={cursorAddress}
          notify={notify}
        />
        {coach}
        <RunControls model={model} notify={notify} />
        <LoadBar model={model} />
      </div>
    </Panel>
  )
}

/** A group of controls that wraps as one: `label` names it for a screen reader. */
function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a row of buttons inside the transport's fieldset, not a form's fields.
    <div role="group" aria-label={label} className="flex shrink-0 items-center gap-1">
      {children}
    </div>
  )
}

export interface DebugPanelsProps {
  model: DebuggerModel
  commands: DebugCommands
  /** The editor's line of an address in the debugged bot, or null. */
  lineOf: (addr: number) => number | null
}

/** The debugger's panels, by their id in the page's layout. */
export function debugPanels({
  model,
  commands,
  lineOf,
}: DebugPanelsProps): Record<
  'registers' | 'processes' | 'watch' | 'breakpoints' | 'memory' | 'trace',
  ReactNode
> {
  const { controller, snapshot, image, names } = model
  const { session, state } = snapshot
  const battle = session?.battle ?? null
  return {
    registers: (
      <RegistersPanel
        state={state}
        names={names}
        onEdit={(edit) => controller.setRegisters(edit)}
      />
    ),
    processes: (
      <ProcessesPanel
        state={state}
        battle={battle}
        names={names}
        labels={image?.names}
        onSelect={(bot, row) => controller.select(bot, row)}
      />
    ),
    watch: <WatchPanel state={state} battle={battle} image={image} />,
    breakpoints: (
      <BreakpointsPanel
        state={state}
        battle={battle}
        image={image}
        names={names}
        lineOf={lineOf}
        onSet={(addr, options) => controller.setBreakpoint(addr, options)}
        onRemove={(addr) => controller.removeBreakpoint(addr)}
        onBreakAtCursor={commands.toggleBreakpoint}
      />
    ),
    memory: (
      <MemoryPanel
        state={state}
        battle={battle}
        image={image}
        starts={model.starts}
        onToggleBreakpoint={(addr) => controller.toggleBreakpoint(addr)}
      />
    ),
    trace: <TracePanel state={state} session={session} />,
  }
}

/** The opponents the load bar offers: the roster's fighters, the showcase first. */
function offered(): readonly CatalogBot[] {
  return rosterCatalog().filter((bot) => bot.roster?.tier !== 'test')
}

/**
 * What the debugger loads (PRODUCT_SPEC §3): the bot in the editor alone, or with opponents, and
 * the placement seed. The session loads again when they change; `reload` loads the editor's text
 * once it has changed since the load.
 */
function LoadBar({ model }: { model: DebuggerModel }) {
  const { opponents, seed, stale, canReload } = model
  const [seedText, setSeedText] = useState<string | null>(null)
  const refs = opponents.map((o) => o.ref)
  const add = (ref: BotRef) => model.setOpponents([...refs, ref])
  const full = opponents.length + 1 >= MAX_ARENA_BOTS
  const showcase = offered().filter((bot) => bot.roster?.tier === 'showcase')
  const solid = offered().filter((bot) => bot.roster?.tier !== 'showcase')
  const item = (bot: CatalogBot) => ({
    label: bot.roster?.slug ?? bot.name.toLowerCase(),
    onSelect: () => add(bot.ref),
  })
  const items: MenuEntry[] = [...showcase.map(item), 'separator', ...solid.map(item)]
  const commitSeed = () => {
    if (seedText === null) return
    const n = Number(seedText)
    setSeedText(null)
    if (/^\d+$/.test(seedText.trim()) && n >= SEED.min && n <= SEED.max) model.setSeed(n)
  }
  const onSeedKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commitSeed()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setSeedText(null)
    }
  }
  return (
    <section
      aria-label="debug setup"
      className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-2"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="text-data text-muted">vs</span>
        {opponents.length === 0 && (
          <span className="text-data text-muted">nobody: the bot alone</span>
        )}
        <ul aria-label="opponents" className="flex flex-wrap items-center gap-1">
          {opponents.map((o, i) => (
            <li
              key={`${i}:${o.name}`}
              className="flex h-6 items-center gap-1.5 rounded-sm border border-border pr-0.5 pl-2 text-data"
            >
              <HueSwatch hue={i + 1} size={8} />
              <span
                className={o.state === 'ready' ? 'text-text' : 'text-danger'}
                title={o.state === 'ready' ? undefined : `${o.state}: left out`}
              >
                {o.name}
              </span>
              <IconButton
                icon={X}
                size="sm"
                label={`drop ${o.name}`}
                className="border-transparent"
                onClick={() => model.setOpponents(refs.filter((_, j) => j !== i))}
              />
            </li>
          ))}
        </ul>
        <Menu
          trigger={
            <Button size="sm" icon={Plus} disabled={full}>
              opponent ▾
            </Button>
          }
          items={items}
        />
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1.5 text-data text-muted">
        <span aria-hidden="true">seed</span>
        <Input
          aria-label="placement seed"
          prompt={null}
          inputMode="numeric"
          value={seedText ?? String(seed)}
          onChange={(event) => setSeedText(event.currentTarget.value.replace(/\D/g, ''))}
          onBlur={commitSeed}
          onKeyDown={onSeedKey}
          className="w-20"
        />
        <IconButton icon={Dices} label="a new seed" onClick={() => model.setSeed(randomSeed())} />
        {stale && (
          <Chip variant="warn" title="the editor's text changed since the debugger loaded it">
            source changed
          </Chip>
        )}
        <Button
          size="sm"
          icon={RefreshCw}
          variant={stale ? 'primary' : 'default'}
          disabled={!canReload}
          title={canReload ? "load the editor's text again" : 'fix the errors to load the bot'}
          onClick={model.reload}
        >
          reload
        </Button>
      </div>
    </section>
  )
}

interface TransportProps {
  model: DebuggerModel
  commands: DebugCommands
  cursorAddress: () => number | string
  notify: (message: string) => void
}

/**
 * The debugger's transport (PRODUCT_SPEC §3): run and pause, named; then the steps, step, step
 * over, and step out; the runs to a place, the cursor and a death; and back, step back and reset.
 */
function Transport({ model, commands, cursorAddress, notify }: TransportProps) {
  const { controller, snapshot, names } = model
  const { state, running } = snapshot
  const loaded = state !== null
  const over = state?.over ?? false
  const bot = state?.selectedProc.bot ?? 0
  const botName = names[bot] ?? 'the bot'
  const toCursor = () => {
    const at = cursorAddress()
    if (typeof at === 'string') notify(at)
    else controller.run({ kind: 'cursor', addr: at })
  }
  return (
    <fieldset
      aria-label="debugger transport"
      className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2"
    >
      <Button
        size="sm"
        variant="primary"
        icon={running === null ? Play : Pause}
        aria-keyshortcuts={running === null ? 'F5' : 'F6'}
        title={running === null ? 'run to the next stop · F5' : 'pause · F6'}
        disabled={!loaded || (over && running === null)}
        onClick={running === null ? commands.run : commands.pause}
        className="w-20"
      >
        {running === null ? 'run' : 'pause'}
      </Button>
      <Group label="step">
        <IconButton
          icon={ArrowDownToDot}
          label="step"
          shortcut="F11"
          disabled={!loaded || over}
          onClick={commands.step}
        />
        <IconButton
          icon={RedoDot}
          label="step over"
          shortcut="F10"
          disabled={!loaded || over}
          onClick={commands.stepOver}
        />
        <IconButton
          icon={ArrowUpFromDot}
          label="step out"
          shortcut="shift F11"
          disabled={!loaded || over}
          onClick={commands.stepOut}
        />
      </Group>
      <Group label="run to">
        <IconButton
          icon={TextCursorInput}
          label="run to cursor"
          disabled={!loaded || over}
          onClick={toCursor}
        />
        <IconButton
          icon={Skull}
          label={`run until ${botName} dies`}
          disabled={!loaded || over}
          onClick={() => controller.run({ kind: 'death', bot })}
        />
      </Group>
      <Group label="back">
        <IconButton
          icon={StepBack}
          label="step back"
          shortcut=","
          disabled={!loaded || !(state?.canStepBack ?? false)}
          onClick={commands.stepBack}
        />
        <IconButton
          icon={RotateCcw}
          label="reset"
          disabled={!loaded}
          onClick={() => controller.reset()}
        />
      </Group>
    </fieldset>
  )
}

/** The speed of a run, the max switch beside it, and `run N` cycles. */
function RunControls({
  model,
  notify,
}: {
  model: DebuggerModel
  notify: (message: string) => void
}) {
  const { controller, snapshot } = model
  const { state, speed } = snapshot
  const runCycles = useEditorPrefs((prefs) => prefs.debug.runCycles)
  const setDebugPrefs = useEditorPrefs((prefs) => prefs.setDebug)
  const [cycles, setCycles] = useState(String(runCycles))
  const over = state?.over ?? false
  const [lastCount, setLastCount] = useState(speed === 'max' ? MAX_CYCLES_PER_FRAME : speed)
  const shown = speed === 'max' ? lastCount : speed
  const runN = () => {
    const n = Number(cycles)
    if (!Number.isInteger(n) || n < 1 || state === null) {
      notify('run N takes a count of cycles, 1 or more.')
      return
    }
    setDebugPrefs({ runCycles: n })
    controller.run({ kind: 'cycles', until: state.cycle + n })
  }
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 text-data text-muted">
      <Group label="speed">
        <span aria-hidden="true">speed</span>
        <Slider
          aria-label="run speed"
          min={1}
          max={MAX_CYCLES_PER_FRAME}
          scale="log"
          value={shown}
          onValueChange={(n) => {
            setLastCount(n)
            controller.setSpeed(n)
          }}
          format={(n) => `${count(n)}/f`}
          className={cx('w-24 shrink-0', speed === 'max' && 'opacity-60')}
        />
        <IconButton
          icon={FastForward}
          label={speed === 'max' ? `runs at ${count(lastCount)}/f` : 'runs at max speed'}
          shortcut="]"
          pressed={speed === 'max'}
          onClick={() => controller.setSpeed(speed === 'max' ? lastCount : 'max')}
        />
      </Group>
      <Group label="run N cycles">
        <span aria-hidden="true">run</span>
        <Input
          aria-label="cycles to run"
          prompt={null}
          inputMode="numeric"
          value={cycles}
          onChange={(event) => setCycles(event.currentTarget.value.replace(/\D/g, ''))}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            runN()
          }}
          className="w-16"
        />
        <span aria-hidden="true">cycles</span>
        <IconButton
          icon={ChevronsRight}
          label="run N cycles"
          disabled={state === null || over}
          onClick={runN}
        />
      </Group>
    </div>
  )
}

/** What a run is doing, in words. */
function runText(goal: RunGoal, names: readonly string[]): string {
  switch (goal.kind) {
    case 'run':
      return 'running to the next stop'
    case 'cycles':
      return `running to cycle ${count(goal.until)}`
    case 'cursor':
      return `running to the cursor, ${hexAddress(goal.addr)}`
    case 'death':
      return `running until ${names[goal.bot] ?? `bot ${goal.bot}`} dies`
  }
}

/** Where the session stands, and why it stopped there. */
function stopText(state: DebugState, model: DebuggerModel): string {
  const { names, image } = model
  const name = (bot: number) => names[bot] ?? `bot ${bot}`
  const at = (addr: number) => {
    const label = image === null ? null : labelOf(image, addr)
    return label === null ? hexAddress(addr) : `${hexAddress(addr)} ${label}`
  }
  const { stop } = state
  switch (stop.kind) {
    case 'start':
      return 'ready: nothing has run'
    case 'step':
      return 'stepped'
    case 'cycles':
      return 'paused'
    case 'breakpoint':
      return stop.error === undefined
        ? `breakpoint at ${at(stop.addr)} · ${name(stop.bot)}`
        : `breakpoint at ${at(stop.addr)}: its condition failed, ${stop.error}`
    case 'int3':
      return `int3 at ${at(stop.addr)} · ${name(stop.bot)}: the next move runs it`
    case 'cursor':
      return `at the cursor, ${at(stop.addr)} · ${name(stop.bot)}`
    case 'died':
      return `the process died at ${at(stop.addr)}: ${stop.reason}`
    case 'death':
      return `${name(stop.bot)} is dead`
    case 'over':
      return 'the battle is over'
    case 'back':
      return 'stepped back'
  }
}

function StopLine({
  state,
  running,
  model,
}: {
  state: DebugState | null
  running: RunGoal | null
  model: DebuggerModel
}) {
  if (state === null) {
    return (
      <p className="rounded-sm border border-border bg-panel-2 px-2 py-1 text-data text-muted">
        {model.unassembled ? 'fix the errors to debug the bot.' : 'assembling the bot…'}
      </p>
    )
  }
  const stopped = state.stop.kind
  const alarm = stopped === 'breakpoint' || stopped === 'int3' || stopped === 'died'
  return (
    <p
      aria-live="polite"
      className="flex min-w-0 items-baseline gap-2 rounded-sm border border-border bg-panel-2 px-2 py-1 text-data"
    >
      <span className="shrink-0 text-muted">cycle</span>
      <span className="shrink-0 text-bright tabular-nums">{count(state.cycle)}</span>
      <span className="text-muted">·</span>
      <span
        className={cx(
          'min-w-0 truncate',
          running !== null ? 'text-accent-fg' : alarm ? 'text-warn' : 'text-text',
        )}
      >
        {running !== null ? runText(running, model.names) : stopText(state, model)}
      </span>
    </p>
  )
}
