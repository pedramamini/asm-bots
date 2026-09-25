import type { MyBot } from '@asmbots/protocol'
import { cx, EmptyState, type EmptyStateAction, IconButton, Panel } from '@asmbots/ui'
import { GitFork, Plus } from 'lucide-react'
import type { ReactNode } from 'react'
import { LoadFailure, type RetryableRead } from '../../app/LoadFailure'
import type { LocalBot } from '../../store/local-bots'
import { type CatalogBot, rosterCatalog } from '../arena/setup/bots'
import { type DocTarget, docKey, parseDocKey, SCRATCH } from './doc'

export interface LibraryProps {
  /** The open document's key. */
  current: string
  /** This browser's bots, or undefined while they are read. */
  local: readonly LocalBot[] | undefined
  /**
   * The signed-in user's bots in the account, or undefined while they are read or nobody is
   * signed in (`cloudRead` says it failed, and reads them again).
   */
  cloud?: readonly MyBot[] | undefined
  /** The read of the account's bots, for its failure and `retry`. */
  cloudRead?: RetryableRead | undefined
  /** The keys of the documents opened lately, the latest first. */
  recent: readonly string[]
  onOpen: (target: DocTarget) => void
  onFork: (bot: CatalogBot) => void
  /** Opens an account bot: in the local bot linked to it, made from its latest version if none. */
  onOpenCloud?: ((bot: MyBot) => void) | undefined
  /** Saves the open bot, when it can be saved: an empty list's way to its first. */
  onSave?: (() => void) | undefined
  className?: string | undefined
}

/**
 * The bot library (PRODUCT_SPEC §3, `b`): my bots, which open to edit; when signed in, my bots in
 * the account (`mine (cloud)`), which open in their local copy; the roster, which opens read-only
 * and forks into my bots; and the documents opened lately.
 */
export function Library({
  current,
  local,
  cloud,
  cloudRead,
  recent,
  onOpen,
  onFork,
  onOpenCloud,
  onSave,
  className,
}: LibraryProps) {
  const cloudError = cloudRead?.error != null
  // An empty list's one way on: save the bot open here, or start one.
  const first: EmptyStateAction =
    onSave === undefined
      ? { label: 'write a new bot', onClick: () => onOpen(SCRATCH) }
      : { label: 'save this bot', onClick: onSave }
  // The account bot a local bot is linked to shows as current while that bot is open.
  const currentCloud = (local ?? []).find(
    (bot) => docKey({ kind: 'local', id: bot.id }) === current,
  )?.cloudId
  const roster = rosterCatalog()
  const names = new Map<string, string>([
    [docKey(SCRATCH), 'new bot'],
    ...(local ?? []).map((bot): [string, string] => [
      docKey({ kind: 'local', id: bot.id }),
      bot.name,
    ]),
    ...roster.map((bot): [string, string] => [docKey(bot.ref), bot.name]),
  ])
  const lately = recent.filter((key) => key !== current && names.has(key)).slice(0, 5)
  return (
    <Panel
      dense
      title="library"
      aria-label="bot library"
      className={cx('min-h-0 overflow-hidden', className)}
    >
      <div className="-mx-2 flex h-full min-h-0 flex-col gap-3 overflow-y-auto px-2">
        {lately.length > 0 && (
          <Section title="recent">
            <Rows>
              {lately.map((key) => {
                const target = parseDocKey(key)
                return target === null ? null : (
                  <Row key={key} current={false} onOpen={() => onOpen(target)}>
                    {names.get(key)}
                  </Row>
                )
              })}
            </Rows>
          </Section>
        )}
        <Section
          title="my bots"
          action={
            <IconButton
              icon={Plus}
              label="new bot"
              size="sm"
              tooltip="right"
              onClick={() => onOpen(SCRATCH)}
            />
          }
        >
          {local === undefined ? (
            <p className="px-1 text-data text-muted">reading…</p>
          ) : local.length === 0 ? (
            <EmptyState dense action={first}>
              none saved in this browser yet.
            </EmptyState>
          ) : (
            <Rows>
              {local.map((bot) => {
                const target: DocTarget = { kind: 'local', id: bot.id }
                return (
                  <Row
                    key={bot.id}
                    current={docKey(target) === current}
                    onOpen={() => onOpen(target)}
                  >
                    {bot.name}
                    {bot.cloudId !== undefined && <span className="text-muted"> · synced</span>}
                  </Row>
                )
              })}
            </Rows>
          )}
        </Section>
        {(cloud !== undefined || cloudError) && onOpenCloud !== undefined && (
          <Section title="mine (cloud)">
            {cloud === undefined ? (
              cloudRead !== undefined && (
                <LoadFailure read={cloudRead} what="your account's bots" dense />
              )
            ) : cloud.length === 0 ? (
              <EmptyState dense action={first}>
                none in your account yet: a save, signed in, keeps it there too.
              </EmptyState>
            ) : (
              <Rows>
                {cloud.map((mine) => (
                  <Row
                    key={mine.bot.id}
                    current={mine.bot.id === currentCloud}
                    onOpen={() => onOpenCloud(mine)}
                  >
                    {mine.bot.name}
                    <span className="text-muted">
                      {mine.latest === null ? '' : ` · v${mine.latest.version}`}
                      {mine.bot.visibility === 'private' ? '' : ` · ${mine.bot.visibility}`}
                    </span>
                  </Row>
                ))}
              </Rows>
            )}
          </Section>
        )}
        <Section title="roster">
          <Rows>
            {roster.map((bot) => (
              <Row
                key={docKey(bot.ref)}
                current={docKey(bot.ref) === current}
                onOpen={() => onOpen(bot.ref)}
                action={
                  <IconButton
                    icon={GitFork}
                    label={`fork ${bot.name}`}
                    size="sm"
                    tooltip="right"
                    onClick={() => onFork(bot)}
                  />
                }
              >
                <span className="text-muted">{bot.roster?.tier === 'test' ? 'test · ' : ''}</span>
                {bot.name}
              </Row>
            ))}
          </Rows>
        </Section>
      </div>
    </Panel>
  )
}

function Section({
  title,
  action,
  children,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section aria-label={title} className="flex flex-col">
      <header className="flex h-5 items-center justify-between px-1">
        <h3 className="text-panel-status text-muted">{title}</h3>
        {action}
      </header>
      {children}
    </section>
  )
}

/** A section's documents, a `Row` each; an empty or failed section says so without a list. */
function Rows({ children }: { children: ReactNode }) {
  return <ul className="flex flex-col">{children}</ul>
}

/** A document in the library: its name, which opens it, and an action at the right. */
function Row({
  current,
  onOpen,
  action,
  children,
}: {
  current: boolean
  onOpen: () => void
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <li className="flex min-w-0 items-center gap-1">
      <button
        type="button"
        aria-current={current ? 'page' : undefined}
        onClick={onOpen}
        className={cx(
          'flex h-6 min-w-0 flex-1 items-center rounded-sm px-1 text-left text-data transition-colors duration-120 ease-out focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-accent',
          current ? 'bg-accent-10 text-accent-fg' : 'text-text hover:bg-panel-2',
        )}
      >
        <span className="truncate">{children}</span>
      </button>
      {action}
    </li>
  )
}
