import type { LucideIcon } from 'lucide-react'
import { Check } from 'lucide-react'
import {
  type KeyboardEvent,
  type ReactNode,
  useId,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react'
import { drawIcon } from '../control'
import { cx } from '../style'
import { Input } from './Input'
import { Kbd } from './Kbd'
import { Modal } from './Modal'

export interface PaletteCommand {
  /** Unique in the list: `go:/arena`, `theme:ice`. */
  id: string
  /** What it does, lowercase: `go to arena`, `ice`. */
  label: string
  /** The heading it lists under, lowercase: `go`, `theme`. A search finds it by it too. */
  group?: string | undefined
  /** The lucide icon, 12 px. */
  icon?: LucideIcon | undefined
  /** More words a search finds it by: `color look`. */
  keywords?: string | undefined
  /** The keys that do the same, pressed one after another: `['g', 'a']`. */
  keys?: readonly string[] | undefined
  /** The choice in use (the current theme): a check at the right. */
  current?: boolean | undefined
  run: () => void
}

export interface CommandPaletteProps {
  /** Shows the palette. It opens on an empty search, or `query`, and the first match active. */
  open: boolean
  /** Escape, the overlay, the close button, and a run command ask for this. */
  onClose: () => void
  commands: readonly PaletteCommand[]
  /** The search it opens with: `theme` lists the themes. */
  query?: string | undefined
  /** The dialog's title. */
  title?: ReactNode
}

/**
 * The command palette (`mod+k`): a `Modal` with a search field over the commands, grouped under
 * their headings, the group of the best match first. A search ranks the commands fuzzily
 * (`filterCommands`). Up and Down move the active command (they wrap), the
 * pointer moves it too, and Enter or a click runs it after the palette closes. The field keeps
 * the focus throughout: a combobox whose active option is its `aria-activedescendant`.
 */
export function CommandPalette({ open, ...props }: CommandPaletteProps) {
  return (
    <Modal open={open} onClose={props.onClose} title={props.title ?? 'commands'} size="md">
      <PaletteBody {...props} />
    </Modal>
  )
}

function PaletteBody({
  onClose,
  commands,
  query: initial = '',
}: Omit<CommandPaletteProps, 'open'>) {
  const id = useId()
  const listId = `${id}-list`
  const [query, setQuery] = useState(initial)
  const [active, setActive] = useState(0)
  const groups = useMemo(() => groupsOf(filterCommands(commands, query)), [commands, query])
  // In the order they show, so Up and Down go down the list as drawn.
  const matches = groups.flatMap(([, list]) => list)
  const at = Math.min(active, matches.length - 1)
  const optionId = (index: number) => `${id}-${index}`

  useLayoutEffect(() => {
    if (at < 0) return
    // jsdom has no scrollIntoView.
    document.getElementById(`${id}-${at}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [id, at])

  const run = (command: PaletteCommand | undefined) => {
    if (command === undefined) return
    onClose()
    command.run()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    if (step !== 0) {
      event.preventDefault()
      if (matches.length > 0) setActive((at + step + matches.length) % matches.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      run(matches[at])
    }
  }

  return (
    <>
      <Input
        autoFocus
        role="combobox"
        aria-label="search the commands"
        aria-expanded="true"
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={at < 0 ? undefined : optionId(at)}
        autoComplete="off"
        spellCheck={false}
        placeholder="type a command"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setActive(0)
        }}
        onKeyDown={onKeyDown}
        className="w-full shrink-0"
      />
      <div id={listId} role="listbox" aria-label="commands" className="mt-2 max-h-80 overflow-auto">
        {groups.map(([group, list], place) => {
          const first = groups.slice(0, place).reduce((sum, [, before]) => sum + before.length, 0)
          return (
            // biome-ignore lint/a11y/useSemanticElements: a group of a listbox's options, not a form's fields.
            <div
              key={group}
              role="group"
              aria-labelledby={group === '' ? undefined : `${id}-g${place}`}
            >
              {group !== '' && (
                <div
                  id={`${id}-g${place}`}
                  role="presentation"
                  className="px-2 pt-2 pb-1 text-panel-status text-muted"
                >
                  {group}
                </div>
              )}
              {list.map((command, offset) => {
                const index = first + offset
                return (
                  // biome-ignore lint/a11y/useFocusableInteractive: the field keeps the focus and names the active option (aria-activedescendant).
                  // biome-ignore lint/a11y/useKeyWithClickEvents: the field's Up, Down, and Enter are the keys.
                  <div
                    key={command.id}
                    id={optionId(index)}
                    role="option"
                    aria-selected={index === at}
                    // The field keeps the focus: a press here must not take it.
                    onMouseDown={(event) => event.preventDefault()}
                    onPointerMove={() => index !== at && setActive(index)}
                    onClick={() => run(command)}
                    className={cx(
                      'flex h-6 cursor-pointer items-center gap-2 rounded-sm px-2 text-data whitespace-nowrap',
                      index === at ? 'bg-accent-10 text-accent-fg' : 'text-text',
                    )}
                  >
                    {drawIcon(command.icon, 12)}
                    <span className="min-w-0 flex-1 truncate">
                      {command.label}
                      {command.current === true && <span className="sr-only"> (current)</span>}
                    </span>
                    {command.current === true && drawIcon(Check, 12)}
                    {command.keys?.map((key, step) => (
                      // A key's place in the sequence is its identity: `g g` presses g twice.
                      <Kbd key={step} aria-hidden="true">
                        {key}
                      </Kbd>
                    ))}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
      {matches.length === 0 && (
        <p role="status" className="px-2 py-2 text-data text-muted">
          no command matches
        </p>
      )}
    </>
  )
}

/**
 * The commands that match every word of `query`, the best first; an empty search keeps them all
 * in their order. A word matches strictly as a substring, or as letters that each start a word
 * (`gtar` finds `go to arena`), in the command's label, group, or keywords. Only when no command
 * matches strictly do loose matches count: the letters in order anywhere (`scnl` finds
 * `scanlines`). A match scores more where its letters run together or start words, more again in
 * the label, and most as a whole substring. Equal scores keep the list's order.
 */
export function filterCommands(
  commands: readonly PaletteCommand[],
  query: string,
): PaletteCommand[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...commands]
  const texts = commands.map((command) => ({
    command,
    label: command.label.toLowerCase(),
    rest: `${command.group ?? ''} ${command.keywords ?? ''}`.toLowerCase(),
  }))
  const ranked = (strict: boolean) =>
    texts
      .map(({ command, label, rest }) => ({
        command,
        score: words.reduce(
          (sum, word) =>
            sum +
            Math.max(fuzzyScore(word, label, strict) + LABEL_BONUS, fuzzyScore(word, rest, strict)),
          0,
        ),
      }))
      .filter(({ score }) => score > Number.NEGATIVE_INFINITY)
      .sort((a, b) => b.score - a.score)
      .map(({ command }) => command)
  const strict = ranked(true)
  return strict.length > 0 ? strict : ranked(false)
}

/** A word's score in its command's label, over the same match in its group or keywords. */
const LABEL_BONUS = 4
/** A letter that starts a word of the text. */
const START_BONUS = 8
/** A letter right after the one before it. */
const RUN_BONUS = 6
/** A gap between two letters. */
const GAP_COST = 3

/**
 * How well `word`'s letters, in order, match `text`: the best placement's score, higher for runs,
 * word starts, and a whole substring; minus infinity when they do not all appear in order. When
 * `strict`, a letter that does not follow the one before it must start a word, unless the word is
 * a substring of the text.
 */
export function fuzzyScore(word: string, text: string, strict = false): number {
  if (word.length === 0) return 0
  const substring = text.includes(word)
  const loose = !strict || substring
  // best[j]: the best score with the word's letters so far placed, the last at text[j].
  let best: number[] = []
  for (let i = 0; i < word.length; i++) {
    const next: number[] = new Array(text.length).fill(Number.NEGATIVE_INFINITY)
    /** The best of best[0..j-2]: a letter placed with a gap before this one. */
    let gapped = Number.NEGATIVE_INFINITY
    for (let j = 0; j < text.length; j++) {
      if (i > 0 && j >= 2) gapped = Math.max(gapped, best[j - 2] ?? Number.NEGATIVE_INFINITY)
      if (text[j] !== word[i]) continue
      const start = j === 0 || !/[a-z0-9]/.test(text[j - 1] ?? '')
      const letter = 1 + (start ? START_BONUS : 0)
      const jump = loose || start ? (i === 0 ? 0 : gapped - GAP_COST) : Number.NEGATIVE_INFINITY
      const run =
        i === 0 ? Number.NEGATIVE_INFINITY : (best[j - 1] ?? Number.NEGATIVE_INFINITY) + RUN_BONUS
      next[j] = letter + Math.max(run, jump)
    }
    best = next
  }
  const score = Math.max(Number.NEGATIVE_INFINITY, ...best)
  return substring ? score + 2 * word.length : score
}

/** The commands by group, in the order each group first appears; no group is ''. */
function groupsOf(commands: readonly PaletteCommand[]): [string, PaletteCommand[]][] {
  const groups = new Map<string, PaletteCommand[]>()
  for (const command of commands) {
    const group = command.group ?? ''
    const list = groups.get(group)
    if (list) list.push(command)
    else groups.set(group, [command])
  }
  return [...groups]
}
