import { MAX_BOT_BYTES } from '@asmbots/asm'
import { Button, Chip, type ChipVariant, cx, IconButton, Input, Menu, Toggle } from '@asmbots/ui'
import {
  AlignLeft,
  Binary,
  GitFork,
  Hammer,
  History,
  LayoutTemplate,
  Link,
  PanelLeft,
  Save,
  Swords,
} from 'lucide-react'
import type { ChangeEvent, MouseEvent } from 'react'
import { type CatalogBot, rosterCatalog } from '../arena/setup/bots'
import type { SharedBot } from '../arena/setup/url'
import type { AsmResult } from './asm/protocol'
import { TEMPLATES, type TemplateId } from './templates'
import { type Tally, TEST_ROUNDS } from './test-vs'

/** Where `test vs` stands: nothing yet, a match running, or its record. */
export type TestState =
  | { readonly status: 'idle' }
  | { readonly status: 'running'; readonly opponent: CatalogBot }
  | {
      readonly status: 'done'
      readonly opponent: CatalogBot
      readonly tally: Tally
      readonly seed: number
      /** The text that was tested, under the id the arena knows it by. */
      readonly tested: SharedBot
    }

/** A document's save state: never saved, as saved, changed since, or a roster bot. */
export type SaveState = 'new' | 'saved' | 'dirty' | 'read-only'

export interface EditorToolbarProps {
  /** The file name, as typed. */
  name: string
  /** What the empty name field shows: the bot's `%name`. */
  namePlaceholder: string
  onNameChange: (name: string) => void
  saveState: SaveState
  result: AsmResult | null
  pending: boolean
  library: boolean
  onLibrary: () => void
  listing: boolean
  onListing: () => void
  lint: boolean
  onLint: (lint: boolean) => void
  saving: boolean
  onAssemble: () => void
  onFormat: () => void
  onSave: () => void
  onFork: () => void
  onVersions: () => void
  /** Whether the bot has saves to list. */
  canVersions: boolean
  onShare: () => void
  test: TestState
  /** The text changed since the test ran. */
  testStale: boolean
  onTest: (opponent: CatalogBot) => void
  /** The arena, set up as the test was: the link, and what a click does. */
  watchHref: string | undefined
  onWatch: () => void
  onTemplate: (id: TemplateId) => void
  onBaseIdiom: () => void
}

/** The key the platform names Mod by. */
function modKey(): string {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)
    ? '⌘'
    : 'ctrl'
}

/**
 * The editor's toolbar (PRODUCT_SPEC §3): the library switch, the file name and its save state,
 * the `%name` badge, the size against the cap, then assemble, format, lint, save (or fork, for a
 * roster bot), versions, share, `test vs ▾` and its record, and at the right the templates and
 * the listing switch.
 */
export function EditorToolbar(props: EditorToolbarProps) {
  const { result, saveState, test } = props
  const readOnly = saveState === 'read-only'
  const mod = modKey()
  const opponents = rosterCatalog().filter((bot) => bot.roster?.tier !== 'test')
  const showcase = opponents.filter((bot) => bot.roster?.tier === 'showcase')
  const solid = opponents.filter((bot) => bot.roster?.tier !== 'showcase')
  const opponentItem = (bot: CatalogBot) => ({
    label: bot.roster?.slug ?? bot.name.toLowerCase(),
    onSelect: () => props.onTest(bot),
  })
  const botName = result?.assembled.name ?? ''
  return (
    <>
      <IconButton
        icon={PanelLeft}
        label="bot library"
        shortcut="b"
        pressed={props.library}
        onClick={props.onLibrary}
      />
      <Input
        aria-label="file name"
        className="w-36"
        value={props.name}
        placeholder={props.namePlaceholder}
        disabled={readOnly}
        spellCheck={false}
        onChange={(event: ChangeEvent<HTMLInputElement>) =>
          props.onNameChange(event.currentTarget.value)
        }
      />
      <SaveChip state={saveState} />
      <Chip
        variant={result !== null && botName === '' ? 'danger' : 'neutral'}
        title="the bot's %name"
      >
        {result === null ? '%name …' : botName === '' ? 'no %name' : botName}
      </Chip>
      <SizeChip result={result} pending={props.pending} />
      <Divider />
      <IconButton
        icon={Hammer}
        label="assemble"
        shortcut={`${mod} enter`}
        onClick={props.onAssemble}
      />
      <IconButton
        icon={AlignLeft}
        label="format"
        shortcut="shift alt f"
        disabled={readOnly}
        onClick={props.onFormat}
      />
      <Toggle pressed={props.lint} onPressedChange={props.onLint} title="show lint warnings">
        lint
      </Toggle>
      {readOnly ? (
        <Button icon={GitFork} onClick={props.onFork}>
          fork
        </Button>
      ) : (
        <IconButton
          icon={Save}
          label="save"
          shortcut={`${mod} s`}
          disabled={props.saving}
          onClick={props.onSave}
        />
      )}
      <IconButton
        icon={History}
        label="versions"
        disabled={!props.canVersions}
        onClick={props.onVersions}
      />
      <IconButton icon={Link} label="share" onClick={props.onShare} />
      <Divider />
      <Menu
        trigger={
          <Button icon={Swords} loading={test.status === 'running'}>
            test vs ▾
          </Button>
        }
        items={[...showcase.map(opponentItem), 'separator', ...solid.map(opponentItem)]}
      />
      <TestRecord {...props} />
      <div className="ml-auto flex items-center gap-2">
        <Menu
          placement="bottom-end"
          trigger={<Button icon={LayoutTemplate}>templates ▾</Button>}
          items={[
            ...TEMPLATES.map((template) => ({
              label: template.label,
              onSelect: () => props.onTemplate(template.id),
            })),
            'separator',
            { label: 'base idiom', disabled: readOnly, onSelect: props.onBaseIdiom },
          ]}
        />
        <IconButton
          icon={Binary}
          label="listing"
          shortcut="l"
          pressed={props.listing}
          onClick={props.onListing}
        />
      </div>
    </>
  )
}

function Divider() {
  return <span aria-hidden="true" className="h-4 w-px shrink-0 bg-border" />
}

function SaveChip({ state }: { state: SaveState }) {
  switch (state) {
    case 'new':
      return <Chip title="not saved yet">new</Chip>
    case 'dirty':
      return (
        <Chip variant="warn" title="changed since the last save">
          unsaved
        </Chip>
      )
    case 'read-only':
      return (
        <Chip variant="info" title="a roster bot: fork it to edit">
          read-only
        </Chip>
      )
    case 'saved':
      return null
  }
}

/** The size against the cap: `142 / 512 B`, warn from 90% (the linter's), danger past it. */
function SizeChip({ result, pending }: { result: AsmResult | null; pending: boolean }) {
  const cap = MAX_BOT_BYTES
  const size = result?.size ?? null
  const variant: ChipVariant =
    size === null ? 'neutral' : size > cap ? 'danger' : size * 10 >= cap * 9 ? 'warn' : 'neutral'
  const text = `${result === null ? '…' : (size ?? '—')} / ${cap} B`
  const title =
    result === null
      ? 'assembling'
      : size === null
        ? 'the size shows once the errors are fixed'
        : size > cap
          ? `${size - cap} bytes over the cap`
          : `${cap - size} bytes to spare`
  return (
    <Chip
      variant={variant}
      title={title}
      aria-label={`size ${text}`}
      className={cx('tabular-nums', pending && 'opacity-60')}
    >
      {text}
    </Chip>
  )
}

/** The test's record, `W 7 · T 2 · L 1`, and `watch`; dimmed once the text has changed. */
function TestRecord({ test, testStale, watchHref, onWatch }: EditorToolbarProps) {
  if (test.status !== 'done') return null
  const { wins, ties, losses } = test.tally
  const variant: ChipVariant = wins > losses ? 'accent' : losses > wins ? 'danger' : 'neutral'
  const against = test.opponent.name
  return (
    <span className={cx('flex items-center gap-2', testStale && 'opacity-60')}>
      <Chip
        variant={variant}
        role="status"
        aria-label={`vs ${against}: ${wins} won, ${ties} tied, ${losses} lost`}
        title={`${TEST_ROUNDS} rounds vs ${against}, seed ${test.seed}${
          testStale ? '; the source changed since' : ''
        }`}
      >
        W {wins} · T {ties} · L {losses} vs {test.opponent.roster?.slug ?? against}
      </Chip>
      <a
        href={watchHref}
        onClick={(event: MouseEvent<HTMLAnchorElement>) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
          event.preventDefault()
          onWatch()
        }}
        className="rounded-sm text-data text-accent-fg underline-offset-2 hover:underline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-accent"
      >
        watch
      </a>
    </span>
  )
}
