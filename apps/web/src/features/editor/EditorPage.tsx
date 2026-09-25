/**
 * `/editor` and `/editor/$botId` (PRODUCT_SPEC §3): the toolbar, the bot library, the CodeMirror
 * editor and the problems panel beside the debugger, and the arena strip under both. The source
 * assembles in the assembler Worker 300 ms after the last keystroke (`useAssembler`); each result
 * shows in the editor (squiggles, gutter marks, the listing gutter), in the panel, and in the
 * debugger, which loads it while its session has not moved (`debug/useDebugger.ts`). Unsaved text
 * is kept as a draft, so a reload loses nothing. A new bot shows the templates over the editor
 * until it has text of its own (`EmptyEditor.tsx`), and the first visit a coach mark under the
 * debugger's run button until it is dismissed or the debugger runs.
 */
import { formatSource } from '@asmbots/asm'
import type { MyBot } from '@asmbots/protocol'
import {
  Chip,
  CoachMark,
  EmptyState,
  hexAddress,
  Kbd,
  Skeleton,
  SplitPane,
  useToast,
} from '@asmbots/ui'
import { isolateHistory, undo } from '@codemirror/commands'
import type { EditorView } from '@codemirror/view'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiRequestError } from '../../api/client'
import { botVersionQuery, useMe, useMyBots } from '../../api/queries'
import { FrameToolbar } from '../../app/Frame'
import { EDITOR_KEYS } from '../../app/keymaps'
import { type KeyCommand, useKeys } from '../../app/keys'
import { useLinkAction } from '../../app/link-action'
import { useRouteStat } from '../../app/slots'
import { addVersion, versionsKey } from '../../store/bot-versions'
import {
  LOCAL_BOTS_KEY,
  type LocalBot,
  useLocalBotActions,
  useLocalBots,
} from '../../store/local-bots'
import { useCoachMark } from '../../store/settings'
import type { ArenaCanvasHandle } from '../arena/ArenaCanvas'
import { type CatalogBot, fightSeed, rosterCatalog } from '../arena/setup/bots'
import { battleConfig, randomSeed } from '../arena/setup/config'
import { searchFromSetup, sharedFragment, shareUrl } from '../arena/setup/url'
import { copyLink } from '../arena/share'
import { ArenaClient, createArenaStore } from '../arena/worker/client'
import { type CloudSave, localCopyOf, saveToCloud } from '../bots/cloud'
import { AsmClient } from './asm/client'
import { resultErrors } from './asm/protocol'
import { useAssembler } from './asm/useAssembler'
import { sourceOf } from './catalog'
import { SNIPPETS } from './cm/complete'
import { lineOfAddress } from './cm/debug'
import { type Problem, showResult } from './cm/diagnostics'
import { ArenaStrip } from './debug/ArenaStrip'
import { Debugger } from './debug/Debugger'
import { inImage } from './debug/image'
import { debugCommands, useDebugKeys } from './debug/keys'
import { DEFAULT_DEBUG_SETUP, type DebugSetup, useDebugger } from './debug/useDebugger'
import { textChanges } from './diff'
import { type DocTarget, docKey, paramOf, pathOf } from './doc'
import { Editor, type EditorCommands } from './Editor'
import { EditorToolbar, type SaveState, type TestState } from './EditorToolbar'
import { EmptyEditor } from './EmptyEditor'
import { Library } from './Library'
import { Problems } from './Problems'
import { useEditorPrefs } from './store'
import { isBlankBot, TEMPLATES, type TemplateId, templateSource } from './templates'
import { TEST_CONFIG, TEST_ROUNDS, tally, testBots, testedId, watchSetup } from './test-vs'
import { type RestoredText, VersionsModal } from './VersionsModal'

export interface EditorPageProps {
  target: DocTarget
  /** Sources a share link carries, by id: a local bot this browser lacks opens from here. */
  shared: ReadonlyMap<string, string>
  /** A template to start the new bot from (`?t=`), put in once the editor is up. */
  template?: TemplateId | null | undefined
  /** The template is in: the route drops it from the URL. */
  onTemplateDone?: (() => void) | undefined
  /** Makes the assembler. Default: an `AsmClient` on its Worker. */
  createAssembler?: (() => AsmClient) | undefined
  /** Makes the arena client `test vs` runs in. Default: an `ArenaClient` on its Worker. */
  createArena?: (() => ArenaClient) | undefined
  /** How long the source rests before it assembles, ms. */
  assembleDelay?: number | undefined
  /** What the debugger loads beside the bot: the arena's `open in debugger` hands its setup over. */
  debug?: DebugSetup | undefined
}

/** A document, open: what the editor starts with, and what it was saved as. */
export interface OpenDoc {
  readonly target: DocTarget
  readonly key: string
  /** The text the editor starts with: the draft, else the saved text. */
  readonly initial: string
  /** The saved text; null for a bot not saved in this browser. */
  readonly saved: string | null
  /** The saved name; the name field starts with the draft's. */
  readonly savedName: string
  readonly name: string
  readonly readOnly: boolean
  /** The local bot, when it is one this browser has. */
  readonly local: LocalBot | null
  /** The roster bot, when it is one. */
  readonly roster: CatalogBot | null
}

/** The document of `target`: loading while the local bots are read, missing when none has it. */
export function openDoc(
  target: DocTarget,
  shared: ReadonlyMap<string, string>,
  local: readonly LocalBot[] | undefined,
): OpenDoc | 'loading' | 'missing' {
  const key = docKey(target)
  const draft = useEditorPrefs.getState().drafts[key]
  const base = { target, key, local: null, roster: null, readOnly: false }
  switch (target.kind) {
    case 'scratch':
      return {
        ...base,
        initial: draft?.source ?? templateSource('blank'),
        saved: null,
        savedName: '',
        name: draft?.name ?? '',
      }
    case 'roster': {
      const bot = rosterCatalog().find((b) => docKey(b.ref) === key)
      if (bot === undefined) return 'missing'
      const source = sourceOf(bot)
      return {
        ...base,
        initial: source,
        saved: source,
        savedName: bot.name,
        name: bot.name,
        readOnly: true,
        roster: bot,
      }
    }
    case 'local': {
      if (local === undefined) return 'loading'
      const bot = local.find((b) => b.id === target.id)
      if (bot !== undefined) {
        return {
          ...base,
          initial: draft?.source ?? bot.source,
          saved: bot.source,
          savedName: bot.name,
          name: draft?.name ?? bot.name,
          local: bot,
        }
      }
      // A bot of someone else's share link: it opens unsaved, and saving keeps its id.
      const source = shared.get(target.id)
      if (source === undefined) return 'missing'
      return {
        ...base,
        initial: draft?.source ?? source,
        saved: null,
        savedName: '',
        name: draft?.name ?? '',
      }
    }
  }
}

/** A selection to carry into the next mount of a document: saving a new bot moves it. */
const carried = new Map<string, { anchor: number; head: number }>()

export function EditorPage({
  target,
  shared,
  template = null,
  onTemplateDone,
  createAssembler = () => new AsmClient(),
  createArena = () => new ArenaClient({ store: createArenaStore() }),
  assembleDelay,
  debug = DEFAULT_DEBUG_SETUP,
}: EditorPageProps) {
  const link = useLinkAction()
  const localBots = useLocalBots()
  const [assembler, setAssembler] = useState<AsmClient | null>(null)
  // One Worker for the page; made in an effect, so a render that is thrown away makes none.
  const makeAssembler = useRef(createAssembler)
  useEffect(() => {
    const client = makeAssembler.current()
    setAssembler(client)
    return () => client.dispose()
  }, [])
  const key = docKey(target)
  // A store that cannot be read (storage off) holds nothing, rather than loading forever.
  const local = localBots.isError ? [] : localBots.data
  const loaded = local !== undefined
  // Opened once per document, by key: the editor owns the text from then on.
  const doc = useMemo(() => openDoc(target, shared, local), [key, loaded])

  if (doc === 'missing') {
    return (
      <div className="p-3">
        <EmptyState action={link('write a new bot', '/editor')}>
          no bot with this id in this browser: it lives in another browser, or it was deleted.
        </EmptyState>
      </div>
    )
  }
  if (doc === 'loading' || assembler === null) {
    return (
      <div className="flex flex-col gap-2 p-3" aria-busy="true">
        <Skeleton rows={12} />
      </div>
    )
  }
  return (
    <Workbench
      key={doc.key}
      doc={doc}
      assembler={assembler}
      createArena={createArena}
      template={template}
      onTemplateDone={onTemplateDone}
      assembleDelay={assembleDelay}
      shared={shared}
      debug={debug}
    />
  )
}

interface WorkbenchProps {
  doc: OpenDoc
  assembler: AsmClient
  createArena: () => ArenaClient
  template: TemplateId | null
  onTemplateDone: (() => void) | undefined
  assembleDelay: number | undefined
  shared: ReadonlyMap<string, string>
  debug: DebugSetup
}

/** How long the text rests before its draft is written, ms. */
const DRAFT_DELAY = 400

/** The editor's first-visit coach mark, by its id in the settings' `coachMarksSeen`. */
const COACH_MARK = 'editor'

/** Where the blank template's name sits: a new bot's first word to write. */
const BLANK_NAME = 'untitled'

function Workbench({
  doc,
  assembler,
  createArena,
  template,
  onTemplateDone,
  assembleDelay,
  shared,
  debug: debugSetup,
}: WorkbenchProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const localBots = useLocalBots()
  const { save: saveBot } = useLocalBotActions()
  const signedIn = Boolean(useMe().data)
  const myBots = useMyBots()
  const listingOn = useEditorPrefs((state) => state.listing)
  const libraryOn = useEditorPrefs((state) => state.library)
  const lintOn = useEditorPrefs((state) => state.lint)
  const recent = useEditorPrefs((state) => state.recent)
  const stripOn = useEditorPrefs((state) => state.strip)
  const { toggleListing, toggleLibrary, setLint, setStrip, visit, setDraft } =
    useEditorPrefs.getState()

  const [view, setView] = useState<EditorView | null>(null)
  const [source, setSource] = useState(doc.initial)
  const [name, setName] = useState(doc.name)
  const [saved, setSaved] = useState({ source: doc.saved, name: doc.savedName })
  const [problems, setProblems] = useState<Problem[]>([])
  const [saving, setSaving] = useState(false)
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [test, setTest] = useState<TestState>({ status: 'idle' })
  const arena = useRef<ArenaClient | null>(null)
  const { result, pending, assembleNow } = useAssembler(source, assembler, assembleDelay)
  const debug = useDebugger({
    view,
    source,
    result,
    setup: debugSetup,
    local: localBots.data,
    shared,
  })
  const stripCanvas = useRef<ArenaCanvasHandle | null>(null)
  const notify = useCallback((message: string) => toast(message), [toast])
  useDebugKeys({
    controller: debug.controller,
    cursorAddress: debug.cursorAddress,
    strip: stripCanvas,
    notify,
  })
  const debugActions = useMemo(
    () => debugCommands(debug.controller, debug.cursorAddress, notify),
    [debug.controller, debug.cursorAddress, notify],
  )
  const lineOf = useCallback(
    (addr: number) => (view === null ? null : (lineOfAddress(view.state, addr)?.lineNo ?? null)),
    [view],
  )
  const localId = doc.local?.id ?? (doc.target.kind === 'local' ? doc.target.id : null)
  // Read from the list, not `doc`: the first cloud save links the bot after the document opened.
  const cloudId = localBots.data?.find((b) => b.id === localId)?.cloudId ?? null
  const [selection] = useState(() => {
    const carry = carried.get(doc.key)
    carried.delete(doc.key)
    return carry
  })

  const saveState: SaveState = doc.readOnly
    ? 'read-only'
    : saved.source === null
      ? 'new'
      : saved.source === source && saved.name === name
        ? 'saved'
        : 'dirty'

  // Each result the editor still has the text of shows there: squiggles, marks, the listing.
  useEffect(() => {
    if (view !== null && result !== null) showResult(view, result, lintOn)
  }, [view, result, lintOn])

  useEffect(() => visit(doc.key), [visit, doc.key])

  // The draft follows the text once it rests, and goes once the text is as saved.
  const writeDraft = useRef<(() => void) | null>(null)
  const draftTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    if (doc.readOnly) return
    const clean =
      saved.source === null
        ? doc.target.kind === 'scratch' && source === templateSource('blank') && name === ''
        : source === saved.source && name === saved.name
    const write = () => {
      writeDraft.current = null
      setDraft(doc.key, clean ? null : { source, name, at: Date.now() })
    }
    writeDraft.current = write
    draftTimer.current = setTimeout(write, DRAFT_DELAY)
    return () => clearTimeout(draftTimer.current)
  }, [doc.readOnly, doc.key, doc.target.kind, source, name, saved, setDraft])
  // Leaving before the text rests still writes it.
  useEffect(() => () => writeDraft.current?.(), [])

  // The Worker `test vs` runs in comes with the first test, and goes with the page.
  useEffect(
    () => () => {
      arena.current?.dispose()
      arena.current = null
    },
    [],
  )

  const replaceText = useCallback((target: EditorView, text: string) => {
    target.dispatch({
      changes: { from: 0, to: target.state.doc.length, insert: text },
      selection: { anchor: 0 },
      scrollIntoView: true,
      userEvent: 'input.replace',
      annotations: isolateHistory.of('full'),
    })
  }, [])

  // A template starts the new bot: in as one edit, which undo takes back.
  const placed = useRef<TemplateId | null>(null)
  useEffect(() => {
    if (template === null) {
      placed.current = null
      return
    }
    if (view === null || placed.current === template || doc.target.kind !== 'scratch') return
    placed.current = template
    replaceText(view, templateSource(template))
    const label = TEMPLATES.find((t) => t.id === template)?.label ?? template
    toast(`a new bot from ${label}.`, {
      variant: 'accent',
      action: { label: 'undo', onClick: () => undo(view) },
    })
    onTemplateDone?.()
  }, [template, view, doc.target.kind, replaceText, toast, onTemplateDone])

  const startFrom = useCallback(
    (id: TemplateId) => void navigate({ to: '/editor', search: { t: id } }),
    [navigate],
  )

  // The new bot's empty state: the templates, until the text is its own or the panel is closed.
  const [emptyClosed, setEmptyClosed] = useState(false)
  const emptyShown =
    doc.target.kind === 'scratch' && template === null && !emptyClosed && isBlankBot(source)
  const closeEmpty = useCallback(() => {
    setEmptyClosed(true)
    view?.focus()
  }, [view])
  const emptyTemplate = useCallback(
    (id: TemplateId) => {
      closeEmpty()
      const blank = templateSource('blank')
      if (id !== 'blank' || view === null || view.state.doc.toString() !== blank) {
        startFrom(id)
        return
      }
      // The blank bot is in already: its name is the first thing to write.
      const at = blank.indexOf(BLANK_NAME)
      view.dispatch({ selection: { anchor: at, head: at + BLANK_NAME.length } })
    },
    [closeEmpty, view, startFrom],
  )

  // The first visit's coach mark goes once the user dismisses it, or once the debugger has run.
  const { open: coachOpen, dismiss: dismissCoach } = useCoachMark(COACH_MARK)
  const debugged = (debug.snapshot.state?.cycle ?? 0) > 0
  useEffect(() => {
    if (coachOpen && debugged) dismissCoach()
  }, [coachOpen, debugged, dismissCoach])

  const go = useCallback(
    (to: DocTarget) => {
      if (to.kind === 'scratch') void navigate({ to: '/editor' })
      else void navigate({ to: '/editor/$botId', params: { botId: paramOf(to) } })
    },
    [navigate],
  )

  const format = useCallback(() => {
    if (view === null || doc.readOnly) return
    const text = view.state.doc.toString()
    const next = formatSource(text)
    if (next === text) {
      toast('already formatted.')
      return
    }
    view.dispatch({
      changes: textChanges(view.state.doc, next),
      userEvent: 'input.format',
      annotations: isolateHistory.of('full'),
    })
  }, [view, doc.readOnly, toast])

  const assemble = useCallback(async () => {
    const done = await assembleNow()
    if (done === null) return
    const errors = resultErrors(done).length
    const warnings = lintOn ? done.warnings.length : 0
    toast(
      errors > 0
        ? `${errors} ${errors === 1 ? 'error' : 'errors'}: no bytes until they are fixed.`
        : `assembled: ${done.size} bytes${warnings > 0 ? `, ${warnings} ${warnings === 1 ? 'warning' : 'warnings'}` : ''}.`,
      { variant: errors > 0 ? 'danger' : 'accent' },
    )
  }, [assembleNow, lintOn, toast])

  const save = useCallback(async () => {
    if (doc.readOnly) {
      toast('a roster bot is read-only: fork it to edit.')
      return
    }
    if (saving) return
    const text = view?.state.doc.toString() ?? source
    const botName = name.trim() || result?.assembled.name || 'untitled'
    setSaving(true)
    try {
      const bot = await saveBot.mutateAsync({
        id: localId ?? undefined,
        name: botName,
        source: text,
      })
      await addVersion(bot.id, { name: botName, source: text })
      await queryClient.invalidateQueries({ queryKey: versionsKey(bot.id) })
      // The text is saved: no draft of it, now or from a write still waiting.
      clearTimeout(draftTimer.current)
      writeDraft.current = null
      setDraft(doc.key, null)
      if (signedIn) {
        let cloud: CloudSave | string
        try {
          cloud = await saveToCloud(bot)
        } catch (error) {
          cloud = error instanceof ApiRequestError ? error.message : String(error)
        }
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: LOCAL_BOTS_KEY }),
          queryClient.invalidateQueries({ queryKey: ['me', 'bots'] }),
          typeof cloud !== 'string' &&
            queryClient.invalidateQueries({ queryKey: ['bots', cloud.bot.id] }),
        ])
        if (typeof cloud === 'string') {
          toast(`saved ${botName} in this browser; your account did not take it: ${cloud}`, {
            variant: 'warn',
          })
        } else {
          toast(
            cloud.created
              ? `saved ${botName}: v${cloud.version.version} in your account.`
              : `saved ${botName}: your account has these bytes as v${cloud.version.version}.`,
            { variant: 'accent' },
          )
        }
      } else {
        toast(`saved ${botName}.`, { variant: 'accent' })
      }
      if (doc.local === null) {
        // A new bot, or someone else's: it lives at its own address from now on.
        const main = view?.state.selection.main
        if (main !== undefined) carried.set(docKey({ kind: 'local', id: bot.id }), main)
        go({ kind: 'local', id: bot.id })
      } else {
        setSaved({ source: text, name: botName })
        setName(botName)
      }
    } catch {
      toast('could not save the bot in this browser.', { variant: 'danger' })
    } finally {
      setSaving(false)
    }
  }, [
    doc,
    saving,
    view,
    source,
    name,
    result,
    localId,
    saveBot,
    signedIn,
    queryClient,
    setDraft,
    toast,
    go,
  ])

  const openCloud = useCallback(
    async (bot: MyBot) => {
      const latest = bot.latest
      if (latest === null) return
      try {
        const copy = await localCopyOf(bot.bot, localBots.data ?? [], async () => {
          const { version } = await queryClient.fetchQuery(
            botVersionQuery(bot.bot.id, latest.version),
          )
          return version.source ?? ''
        })
        await queryClient.invalidateQueries({ queryKey: LOCAL_BOTS_KEY })
        go({ kind: 'local', id: copy.id })
      } catch {
        toast(`could not open ${bot.bot.name}: try again.`, { variant: 'danger' })
      }
    },
    [localBots.data, queryClient, go, toast],
  )

  const fork = useCallback(
    async (bot: CatalogBot) => {
      try {
        const source = sourceOf(bot)
        const copy = await saveBot.mutateAsync({ name: bot.name, source })
        await addVersion(copy.id, { name: bot.name, source })
        toast(`forked ${bot.name} into my bots.`, { variant: 'accent' })
        go({ kind: 'local', id: copy.id })
      } catch {
        toast('could not save the bot in this browser.', { variant: 'danger' })
      }
    },
    [saveBot, toast, go],
  )

  const share = useCallback(() => {
    const origin = window.location.origin
    if (doc.target.kind === 'roster') {
      void copyLink(`${origin}${pathOf(doc.target)}`, toast, 'link copied: it opens this bot.')
      return
    }
    // The link opens this text: a saved bot's id only while the text is as saved.
    const id = testedId(
      source,
      doc.local === null ? null : { id: doc.local.id, source: saved.source ?? '' },
    )
    const fragment = sharedFragment([{ id, source }])
    void copyLink(`${origin}/editor#${fragment}`, toast, 'link copied: the source rides inside.')
  }, [doc.target, doc.local, saved.source, source, toast])

  const runTest = useCallback(
    async (opponent: CatalogBot) => {
      const text = source
      const mine = await assembler.assemble(text).catch(() => null)
      if (mine === null) return
      const errors = resultErrors(mine).length
      if (errors > 0) {
        toast(
          `fix the ${errors === 1 ? 'error' : `${errors} errors`} first: a bot with errors has no bytes.`,
          {
            variant: 'danger',
          },
        )
        return
      }
      const sizes = [mine.assembled.bytes.length, opponent.assembled.bytes.length]
      const seed = fightSeed(sizes, TEST_CONFIG.minSpacing, null, randomSeed, TEST_ROUNDS)
      if (seed === null) {
        toast('the two bots do not fit in the core.', { variant: 'danger' })
        return
      }
      arena.current ??= createArena()
      setTest({ status: 'running', opponent })
      try {
        const match = await arena.current.runMatch(
          testBots(mine.assembled, opponent),
          battleConfig(TEST_CONFIG, seed),
          TEST_ROUNDS,
        )
        const tested = {
          id: testedId(
            text,
            doc.local === null ? null : { id: doc.local.id, source: saved.source ?? '' },
          ),
          source: text,
        }
        setTest({ status: 'done', opponent, tally: tally(match), seed, tested })
      } catch (error) {
        setTest({ status: 'idle' })
        toast(`the test did not run: ${error instanceof Error ? error.message : String(error)}`, {
          variant: 'danger',
        })
      }
    },
    [source, assembler, createArena, doc.local, saved.source, toast],
  )

  const watch = useMemo(() => {
    if (test.status !== 'done' || test.opponent.ref.kind !== 'roster') return null
    return watchSetup(test.tested, test.opponent.ref.slug, test.seed)
  }, [test])

  const restore = useCallback(
    (version: RestoredText) => {
      if (view === null) return
      replaceText(view, version.source)
      setName(version.name)
      toast(`restored ${version.label}.`, {
        action: { label: 'undo', onClick: () => undo(view) },
      })
    },
    [view, replaceText, toast],
  )

  const baseIdiom = useCallback(() => {
    if (view === null || doc.readOnly) return
    const idiom = SNIPPETS[0]
    if (idiom === undefined) return
    const { state } = view
    const line = state.doc.lineAt(state.selection.main.head)
    view.focus()
    if (line.text.trim() !== '') {
      // On a line of its own, after the cursor's line.
      view.dispatch({
        changes: { from: line.to, insert: '\n' },
        selection: { anchor: line.to + 1 },
      })
    }
    const at = view.state.selection.main.head
    if (typeof idiom.apply === 'function') idiom.apply(view, idiom, at, at)
  }, [view, doc.readOnly])

  const { toggleLine } = debug
  const commands = useMemo<EditorCommands>(
    () => ({
      format,
      assemble: () => void assemble(),
      toggleBreakpoint: (lineNo) => {
        const why = toggleLine(lineNo)
        if (why !== null) notify(why)
      },
    }),
    [format, assemble, toggleLine, notify],
  )

  const keys = useMemo<KeyCommand[]>(
    () => [
      { ...EDITOR_KEYS.listing, run: toggleListing },
      { ...EDITOR_KEYS.library, run: toggleLibrary },
    ],
    [toggleListing, toggleLibrary],
  )
  useKeys(keys)

  // Mod-s saves wherever the focus is, instead of the browser's save dialog.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.shiftKey) return
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return
      event.preventDefault()
      void save()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [save])

  const displayName = name.trim() || result?.assembled.name || 'untitled'
  const errorCount = problems.filter((p) => p.severity === 'error').length
  useRouteStat(
    `${displayName} · ${result?.size ?? '—'} B · ${
      errorCount > 0 ? `${errorCount} ${errorCount === 1 ? 'error' : 'errors'}` : 'assembles'
    }`,
  )

  const jump = useCallback(
    (problem: Problem) => {
      if (view === null) return
      view.dispatch({ selection: { anchor: problem.from }, scrollIntoView: true })
      view.focus()
    },
    [view],
  )

  return (
    <>
      <FrameToolbar aria-label="editor">
        <EditorToolbar
          name={name}
          namePlaceholder={result?.assembled.name || 'untitled'}
          onNameChange={setName}
          saveState={saveState}
          result={result}
          pending={pending}
          library={libraryOn}
          onLibrary={toggleLibrary}
          listing={listingOn}
          onListing={toggleListing}
          lint={lintOn}
          onLint={setLint}
          saving={saving}
          onAssemble={() => void assemble()}
          onFormat={format}
          onSave={() => void save()}
          onFork={() => doc.roster !== null && void fork(doc.roster)}
          onVersions={() => setVersionsOpen(true)}
          canVersions={!doc.readOnly || cloudId !== null}
          onShare={share}
          test={test}
          testStale={test.status === 'done' && test.tested.source !== source}
          onTest={(opponent) => void runTest(opponent)}
          watchHref={watch === null ? undefined : shareUrl('', watch.spec, watch.shared)}
          onWatch={() => {
            if (watch === null) return
            void navigate({
              to: '/arena',
              search: searchFromSetup(watch.spec),
              hash: sharedFragment(watch.shared),
            })
          }}
          onTemplate={startFrom}
          onBaseIdiom={baseIdiom}
        />
      </FrameToolbar>
      <SplitPane
        direction="column"
        label="arena strip height"
        defaultRatio={0.76}
        min={0.3}
        max={0.9}
        storageKey="editor-strip"
        collapsed={!stripOn}
        className="h-full p-3"
      >
        <div className="flex h-full min-h-0 gap-3">
          {libraryOn && (
            <Library
              className="w-56 shrink-0"
              current={doc.key}
              local={localBots.data}
              cloud={signedIn ? myBots.data?.bots : undefined}
              cloudRead={myBots}
              onSave={doc.readOnly ? undefined : () => void save()}
              recent={recent}
              onOpen={go}
              onOpenCloud={(bot) => void openCloud(bot)}
              onFork={(bot) => void fork(bot)}
            />
          )}
          <SplitPane
            label="editor width"
            defaultRatio={0.46}
            min={0.25}
            max={0.75}
            storageKey="editor-debugger"
            className="min-w-0 flex-1"
          >
            <div className="flex h-full min-w-0 flex-col gap-3">
              <div className="relative min-h-0 flex-1 overflow-hidden rounded-md border border-border">
                {emptyShown && (
                  <EmptyEditor
                    empty={source.trim() === ''}
                    onTemplate={emptyTemplate}
                    onClose={closeEmpty}
                  />
                )}
                <Editor
                  className="h-full"
                  initial={doc.initial}
                  readOnly={doc.readOnly}
                  listing={listingOn}
                  selection={selection}
                  onChange={setSource}
                  onProblems={setProblems}
                  onView={setView}
                  commands={commands}
                />
                <OutsideChip debug={debug} />
              </div>
              <Problems problems={problems} result={result} pending={pending} onJump={jump} />
            </div>
            <Debugger
              model={debug}
              commands={debugActions}
              lineOf={lineOf}
              cursorAddress={debug.cursorAddress}
              notify={notify}
              coach={
                coachOpen && (
                  <CoachMark placement="inline" onDismiss={dismissCoach}>
                    assemble runs as you type; press <Kbd>F5</Kbd> to debug.
                  </CoachMark>
                )
              }
              className="pr-1"
            />
          </SplitPane>
        </div>
        <ArenaStrip
          session={debug.snapshot.session}
          state={debug.snapshot.state}
          open={stripOn}
          onOpen={setStrip}
          canvas={stripCanvas}
        />
      </SplitPane>
      <VersionsModal
        open={versionsOpen}
        botId={doc.local?.id ?? null}
        cloudId={cloudId}
        current={source}
        onClose={() => setVersionsOpen(false)}
        onRestore={restore}
        onSave={() => void save()}
      />
    </>
  )
}

/**
 * Over the editor, while the followed process runs code that is not the debugged bot's (PRODUCT_SPEC
 * §3): whose bytes it runs, and where. The memory panel shows that code.
 */
function OutsideChip({ debug }: { debug: ReturnType<typeof useDebugger> }) {
  const { image, snapshot, names } = debug
  const { state, session } = snapshot
  if (image === null || state === null || session === null || inImage(image, state.ip)) return null
  const tag = session.battle.core.owner[state.ip] ?? 0
  const whose = tag === 0 ? 'empty core' : `${names[tag - 1] ?? `bot ${tag}`}'s bytes`
  return (
    <Chip
      variant="warn"
      role="status"
      className="absolute top-2 right-3 z-10"
      title={`the followed process runs ${whose} at ${hexAddress(state.ip)}: the memory panel shows it`}
    >
      executing outside this bot
    </Chip>
  )
}
