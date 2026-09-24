/**
 * `/editor` and `/editor/$botId` (PRODUCT_SPEC §3): the toolbar, the bot library, the CodeMirror
 * editor, and the problems panel. The source assembles in the assembler Worker 300 ms after the
 * last keystroke (`useAssembler`); each result shows in the editor (squiggles, gutter marks, the
 * listing gutter) and in the panel. Unsaved text is kept as a draft, so a reload loses nothing.
 */
import { formatSource } from '@asmbots/asm'
import { EmptyState, Skeleton, useToast } from '@asmbots/ui'
import { isolateHistory, undo } from '@codemirror/commands'
import type { EditorView } from '@codemirror/view'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FrameToolbar } from '../../app/Frame'
import { type KeyCommand, useKeys } from '../../app/keys'
import { useRouteStat } from '../../app/slots'
import { addVersion, type BotVersion, useBotVersions, versionsKey } from '../../store/bot-versions'
import { type LocalBot, useLocalBotActions, useLocalBots } from '../../store/local-bots'
import { type CatalogBot, fightSeed, rosterCatalog } from '../arena/setup/bots'
import { battleConfig, randomSeed } from '../arena/setup/config'
import { searchFromSetup, sharedFragment, shareUrl } from '../arena/setup/url'
import { copyLink } from '../arena/share'
import { ArenaClient, createArenaStore } from '../arena/worker/client'
import { AsmClient } from './asm/client'
import { resultErrors } from './asm/protocol'
import { useAssembler } from './asm/useAssembler'
import { SNIPPETS } from './cm/complete'
import { type Problem, showResult } from './cm/diagnostics'
import { textChanges } from './diff'
import { type DocTarget, docKey, paramOf, pathOf } from './doc'
import { Editor, type EditorCommands } from './Editor'
import { EditorToolbar, type SaveState, type TestState } from './EditorToolbar'
import { Library } from './Library'
import { Problems } from './Problems'
import { useEditorPrefs } from './store'
import { TEMPLATES, type TemplateId, templateSource } from './templates'
import { TEST_CONFIG, TEST_ROUNDS, tally, testBots, testedId, watchSetup } from './test-vs'
import { VersionsModal } from './VersionsModal'

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
      return {
        ...base,
        initial: bot.source,
        saved: bot.source,
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
}: EditorPageProps) {
  const navigate = useNavigate()
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
        <EmptyState
          action={{
            label: 'write a new bot',
            href: '/editor',
            onClick: (event) => {
              event.preventDefault()
              void navigate({ to: '/editor' })
            },
          }}
        >
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
}

/** How long the text rests before its draft is written, ms. */
const DRAFT_DELAY = 400

function Workbench({
  doc,
  assembler,
  createArena,
  template,
  onTemplateDone,
  assembleDelay,
}: WorkbenchProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const localBots = useLocalBots()
  const { save: saveBot } = useLocalBotActions()
  const listingOn = useEditorPrefs((state) => state.listing)
  const libraryOn = useEditorPrefs((state) => state.library)
  const lintOn = useEditorPrefs((state) => state.lint)
  const recent = useEditorPrefs((state) => state.recent)
  const { toggleListing, toggleLibrary, setLint, visit, setDraft } = useEditorPrefs.getState()

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
  const localId = doc.local?.id ?? (doc.target.kind === 'local' ? doc.target.id : null)
  const versions = useBotVersions(doc.local === null ? null : doc.local.id)
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
      toast(`saved ${botName}.`, { variant: 'accent' })
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
  }, [doc, saving, view, source, name, result, localId, saveBot, queryClient, setDraft, toast, go])

  const fork = useCallback(
    async (bot: CatalogBot) => {
      try {
        const copy = await saveBot.mutateAsync({ name: bot.name, source: bot.source })
        await addVersion(copy.id, { name: bot.name, source: bot.source })
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
    (version: BotVersion) => {
      if (view === null) return
      replaceText(view, version.source)
      setName(version.name)
      toast(`restored the save of ${new Date(version.at).toLocaleString()}.`, {
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

  const commands = useMemo<EditorCommands>(
    () => ({ format, assemble: () => void assemble() }),
    [format, assemble],
  )

  const keys = useMemo<KeyCommand[]>(
    () => [
      { keys: ['l'], description: 'show or hide the listing', group: 'editor', run: toggleListing },
      {
        keys: ['b'],
        description: 'show or hide the bot library',
        group: 'editor',
        run: toggleLibrary,
      },
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
          canVersions={(versions.data?.length ?? 0) > 0}
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
          onTemplate={(id) => void navigate({ to: '/editor', search: { t: id } })}
          onBaseIdiom={baseIdiom}
        />
      </FrameToolbar>
      <div className="flex h-full min-h-0 gap-3 p-3">
        {libraryOn && (
          <Library
            className="w-56 shrink-0"
            current={doc.key}
            local={localBots.data}
            recent={recent}
            onOpen={go}
            onFork={(bot) => void fork(bot)}
          />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border">
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
          </div>
          <Problems problems={problems} result={result} pending={pending} onJump={jump} />
        </div>
      </div>
      <VersionsModal
        open={versionsOpen}
        botId={doc.local?.id ?? null}
        current={source}
        onClose={() => setVersionsOpen(false)}
        onRestore={restore}
      />
    </>
  )
}
