/**
 * The debugger of the editor page (PRODUCT_SPEC §3): its controller, what it loads, and what the
 * editor shows of it. The debugged bot is the editor's last assemble without errors, then the
 * opponents, placed by the seed. A new assemble loads a new session by itself while the session
 * has not moved; once it has, the source is stale until `reload`, so an edit never throws a
 * debugging session away. Breakpoints go over to the new session (`carryBreakpoints`).
 */
import type { Assembled } from '@asmbots/asm'
import type { EditorView } from '@codemirror/view'
import { EditorView as View } from '@codemirror/view'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { LocalBot } from '../../../store/local-bots'
import type { ArenaConfig } from '../../../store/settings'
import { resolveSelection, type SetupBot } from '../../arena/setup/bots'
import { battleConfig, DEFAULT_ARENA_CONFIG } from '../../arena/setup/config'
import { type BotRef, formatRef } from '../../arena/setup/url'
import { type AsmResult, resultErrors } from '../asm/protocol'
import { ipLine, lineBytes, lineOfAddress, setDebugLines, setDebugMarks } from '../cm/debug'
import { DebugController, type DebugSnapshot } from './controller'
import { type BotImage, botImage, inImage } from './image'
import { carryBreakpoints, debugBots } from './load'

/** What the debugger loads besides the bot in the editor. */
export interface DebugSetup {
  /** The opponents, in order. */
  readonly opponents: readonly BotRef[]
  /** The placement seed (ISA §5.5). */
  readonly seed: number
  /** The battle's cycles, process cap, and spacing: the arena's config. */
  readonly config: ArenaConfig
}

/** A setup with no opponents: the bot alone, seed 1, the arena's duel. */
export const DEFAULT_DEBUG_SETUP: DebugSetup = Object.freeze({
  opponents: [],
  seed: 1,
  config: DEFAULT_ARENA_CONFIG,
})

export interface UseDebuggerOptions {
  readonly view: EditorView | null
  /** The editor's text. */
  readonly source: string
  /** The latest assemble of it, or null before the first. */
  readonly result: AsmResult | null
  /** The setup to start with. */
  readonly setup: DebugSetup
  /** Where local opponents come from: this browser's bots, and a share link's. */
  readonly local: readonly LocalBot[] | undefined
  readonly shared: ReadonlyMap<string, string>
}

/** The debugger, as the page shows it. */
export interface DebuggerModel {
  readonly controller: DebugController
  readonly snapshot: DebugSnapshot
  /** The loaded bot in the core, or null before a load. */
  readonly image: BotImage | null
  /** Where each loaded bot's listing starts a line: the memory panel's sweeps start one there. */
  readonly starts: ReadonlySet<number>
  /** The editor's text differs from the loaded one: `reload` loads the new one. */
  readonly stale: boolean
  /** No session, since the bot has errors (and nothing was loaded before). */
  readonly unassembled: boolean
  /** Whether `reload` can load the editor's text: its last assemble has no errors. */
  readonly canReload: boolean
  /** The battle's bot names, in order. */
  readonly names: readonly string[]
  readonly opponents: readonly SetupBot[]
  readonly seed: number
  readonly config: ArenaConfig
  setOpponents: (refs: readonly BotRef[]) => void
  setSeed: (seed: number) => void
  /** Loads the editor's text, with the setup as it is. */
  reload: () => void
  /** Sets or clears the breakpoint of line `lineNo`. Returns why it cannot, or null. */
  toggleLine: (lineNo: number) => string | null
  /** The address of the cursor's line, or why there is none. */
  cursorAddress: () => number | string
}

/** The loaded text and bot, and the setup it was loaded with. */
interface Loaded {
  readonly source: string
  readonly image: BotImage
  readonly setupKey: string
  readonly names: readonly string[]
  readonly starts: ReadonlySet<number>
}

const NO_STARTS: ReadonlySet<number> = new Set()

/** Where the lines of `assembled`, loaded at `base`, start: the lines with bytes. */
function addStarts(starts: Set<number>, assembled: Assembled, base: number): void {
  for (const line of assembled.listing) {
    if (line.bytes.length > 0) starts.add((base + line.address) & 0xffff)
  }
}

const setupKeyOf = (opponents: readonly BotRef[], seed: number, config: ArenaConfig) =>
  `${opponents.map(formatRef).join(',')}|${seed}|${config.maxCycles}|${config.maxProcesses}|${config.minSpacing}`

export function useDebugger({
  view,
  source,
  result,
  setup,
  local,
  shared,
}: UseDebuggerOptions): DebuggerModel {
  const [controller] = useState(() => new DebugController())
  // Leaving stops a run. The controller holds nothing else to let go, and a dev remount (Strict
  // Mode runs this cleanup once) must find it working.
  useEffect(() => () => controller.pause(), [controller])
  const snapshot = useSyncExternalStore(controller.subscribe, () => controller.snapshot)
  const [opponentRefs, setOpponentRefs] = useState<readonly BotRef[]>(setup.opponents)
  const [seed, setSeed] = useState(setup.seed)
  const config = setup.config
  const [loaded, setLoaded] = useState<Loaded | null>(null)

  const localMap = useMemo(
    () => (local === undefined ? null : new Map(local.map((bot) => [bot.id, bot]))),
    [local],
  )
  const opponents = useMemo(
    () => resolveSelection(opponentRefs, { local: localMap, shared }),
    [opponentRefs, localMap, shared],
  )
  const setupKey = setupKeyOf(opponentRefs, seed, config)

  // Only the editor's own text loads: the lines of an older one are not the editor's lines.
  const errors = result === null ? 0 : resultErrors(result).length
  const current = result !== null && result.source === source && errors === 0

  const load = useCallback(
    (from: AsmResult) => {
      const ready = opponents.flatMap((o) => (o.state === 'ready' && o.bot !== null ? [o.bot] : []))
      const bots = debugBots(from.assembled, ready)
      const old = controller.snapshot.session?.state.breakpoints ?? []
      const session = controller.load(bots, battleConfig(config, seed))
      if (session === null) {
        // The bots do not fit: the snapshot's error says so, and the editor shows no lines.
        view?.dispatch({ effects: setDebugLines.of(null) })
        setLoaded(null)
        return
      }
      const base = session.battle.bots[0]?.base ?? 0
      const image = botImage(from.source, from.assembled, base)
      const starts = new Set<number>()
      addStarts(starts, from.assembled, base)
      for (const [i, bot] of ready.entries()) {
        addStarts(starts, bot.assembled, session.battle.bots[i + 1]?.base ?? 0)
      }
      // The editor still has the old session's lines, mapped through the edits since.
      const editor = view?.state
      const oldImage = loaded?.image ?? null
      const carried =
        editor === undefined
          ? []
          : carryBreakpoints(old, {
              lineOf: (addr) => lineOfAddress(editor, addr),
              inOld: (addr) => oldImage !== null && inImage(oldImage, addr),
              lineBytes: (lineNo) => image.lines.find((l) => l.lineNo === lineNo) ?? null,
            })
      for (const bp of carried) {
        session.setBreakpoint(bp.addr, { condition: bp.condition, enabled: bp.enabled })
      }
      view?.dispatch({ effects: setDebugLines.of(image.lines) })
      setLoaded({ source: from.source, image, setupKey, names: bots.map((b) => b.name), starts })
    },
    [controller, opponents, config, seed, setupKey, view, loaded],
  )

  // A new assemble loads by itself while the session has not moved; a new setup always does,
  // once the editor's text assembles.
  useEffect(() => {
    // The editor takes the loaded lines: wait for it.
    if (!current || result === null || view === null) return
    const setupChanged = loaded === null || loaded.setupKey !== setupKey
    if (!setupChanged && loaded.source === source) return
    const state = controller.snapshot.state
    const untouched = state === null || (state.cycle === 0 && !state.canStepBack)
    if (setupChanged || untouched) load(result)
  }, [current, result, source, setupKey, loaded, controller, load, view])

  // Where the process stands, and the breakpoints, in the editor.
  const state = snapshot.state
  useEffect(() => {
    if (view === null) return
    view.dispatch({
      effects: setDebugMarks.of({
        ip: state?.ip ?? null,
        breakpoints: new Map(state?.breakpoints.map((bp) => [bp.addr, bp.enabled]) ?? []),
      }),
    })
  }, [view, state])

  // A stop shows its line: the editor scrolls to it, unless a run is still going.
  const shownAt = useRef<string>('')
  useEffect(() => {
    if (view === null || state === null || snapshot.running !== null) return
    const at = `${state.cycle}:${state.ip}:${state.selectedProc.bot}:${state.selectedProc.row}`
    if (at === shownAt.current) return
    shownAt.current = at
    const line = ipLine(view.state)
    if (line === null) return
    view.dispatch({
      effects: View.scrollIntoView(view.state.doc.line(line).from, { y: 'nearest', yMargin: 48 }),
    })
  }, [view, state, snapshot.running])

  const toggleLine = useCallback(
    (lineNo: number): string | null => {
      if (view === null || snapshot.session === null) return 'nothing is loaded to debug yet.'
      const bytes = lineBytes(view.state, lineNo)
      if (bytes === null) {
        return loaded !== null && loaded.source !== view.state.doc.toString()
          ? 'this line has no bytes in the loaded bot: reload to break on it.'
          : 'this line has no bytes to break on.'
      }
      controller.toggleBreakpoint(bytes.addr)
      return null
    },
    [view, snapshot.session, loaded, controller],
  )

  const cursorAddress = useCallback((): number | string => {
    if (view === null || snapshot.session === null) return 'nothing is loaded to debug yet.'
    const { state: editor } = view
    const lineNo = editor.doc.lineAt(editor.selection.main.head).number
    return lineBytes(editor, lineNo)?.addr ?? 'the cursor is on a line with no bytes.'
  }, [view, snapshot.session])

  const reload = useCallback(() => {
    if (current && result !== null) load(result)
  }, [current, result, load])

  return {
    controller,
    snapshot,
    image: loaded?.image ?? null,
    starts: loaded?.starts ?? NO_STARTS,
    stale: loaded !== null && loaded.source !== source,
    unassembled: snapshot.session === null && errors > 0,
    canReload: current,
    names: loaded?.names ?? [],
    opponents,
    seed,
    config,
    setOpponents: setOpponentRefs,
    setSeed,
    reload,
    toggleLine,
    cursorAddress,
  }
}
